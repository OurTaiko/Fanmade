package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// Pointers distinguish required zero-valued counts from missing/null fields.
type scoreSubmission struct {
	// The chart_difficulties row of the block that was really played.
	DifficultyID int64           `json:"difficultyId"`
	Good         *int64          `json:"good"`
	OK           *int64          `json:"ok"`
	Bad          *int64          `json:"bad"`
	Score        *int64          `json:"score"`
	Drumroll     *int64          `json:"drumroll"`
	MaxCombo     *int64          `json:"max_combo"`
	ReplayData   json.RawMessage `json:"replay_data,omitempty"`
	// Omit zero from the digest to preserve retries of pre-ClearStatus requests.
	ClearStatus int `json:"ClearStatus,omitempty"`
}

type Score struct {
	ID     string `json:"id"`
	UserID string `json:"userId"`
	SongID string `json:"songId"`
	// The block that was played; Course and Side describe it.
	DifficultyID int64  `json:"difficultyId"`
	Course       string `json:"course"`
	Side         string `json:"side"`
	Good         int64  `json:"good"`
	OK           int64  `json:"ok"`
	Bad          int64  `json:"bad"`
	Score        int64  `json:"score"`
	Drumroll     int64  `json:"drumroll"`
	MaxCombo     int64  `json:"max_combo"`
	ClearStatus  int    `json:"ClearStatus"`
	// False once the song's TJA or audio was replaced after this play.
	IsLatest    bool      `json:"isLatest"`
	SubmittedAt time.Time `json:"submittedAt"`
}

func (v *scoreSubmission) valid() bool {
	if v.DifficultyID <= 0 {
		return false
	}
	for _, count := range []*int64{v.Good, v.OK, v.Bad, v.Drumroll, v.MaxCombo} {
		if count == nil || *count < 0 || *count > 2147483647 {
			return false
		}
	}
	return v.Score != nil && *v.Score >= 0 && *v.Score <= 9007199254740991 && v.ClearStatus >= 0 && v.ClearStatus <= 3
}

// scoreSelect reads scores, aliased sc, with the block each was played on.
const scoreColumns = `sc.id,sc.user_id,d.chart_id,sc.difficulty_id,d.course,d.side,sc.good,sc.ok,sc.bad,sc.score,sc.drumroll,sc.max_combo,sc.clear_status,sc.is_latest,sc.submitted_at`
const scoreSelect = `SELECT ` + scoreColumns + ` FROM scores sc JOIN chart_difficulties d ON d.id=sc.difficulty_id`

func readScore(row pgx.Row) (Score, error) {
	var v Score
	err := row.Scan(&v.ID, &v.UserID, &v.SongID, &v.DifficultyID, &v.Course, &v.Side, &v.Good, &v.OK, &v.Bad, &v.Score, &v.Drumroll, &v.MaxCombo, &v.ClearStatus, &v.IsLatest, &v.SubmittedAt)
	return v, err
}

func (s *Server) submitScore(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		problem(w, 415, "CONTENT_TYPE_INVALID", "请使用 JSON 请求")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxScoreRequestBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var input scoreSubmission
	if err = decoder.Decode(&input); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			problem(w, 413, "REQUEST_TOO_LARGE", "成绩请求超过大小限制")
			return
		}
		problem(w, 400, "REQUEST_INVALID", "成绩需要完整的 JSON 对象，计数与分数必须为整数")
		return
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		problem(w, 400, "REQUEST_INVALID", "请求只能包含一个 JSON 对象")
		return
	}
	if !input.valid() {
		problem(w, 422, "SCORE_INVALID", "需要有效的谱面块 ID 和全部六项非负整数；计数（含最大连击）上限 2147483647，分数上限 9007199254740991；ClearStatus 必须为 0–3")
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key != "" && !keyPattern.MatchString(key) {
		problem(w, 400, "IDEMPOTENCY_KEY_INVALID", "成绩请求标识需要 16–80 位字母、数字或短横线")
		return
	}
	input.ReplayData = normalizeScoreReplay(input.ReplayData)
	payload, _ := json.Marshal(input)
	digest := hash(string(payload))
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize submissions against resource replacement on the same song.
	// A replacement may have removed the block together with this very score.
	var published bool
	err = tx.QueryRow(r.Context(), `SELECT `+publishedChart+` FROM chart_difficulties d JOIN charts c ON c.id=d.chart_id WHERE d.id=$1 FOR SHARE OF c`, input.DifficultyID).Scan(&published)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		internal(w, err)
		return
	}
	if key != "" {
		if _, err = tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "score:"+u.User.ID+":"+key); err != nil {
			internal(w, err)
			return
		}
		var retired bool
		if err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM retired_score_requests WHERE user_id=$1 AND idempotency_key=$2)`, u.User.ID, key).Scan(&retired); err != nil {
			internal(w, err)
			return
		}
		if retired {
			problem(w, 409, "SCORE_REMOVED", "歌曲文件已替换，此成绩已清除")
			return
		}
		var oldDigest string
		err = tx.QueryRow(r.Context(), `SELECT payload_digest FROM scores WHERE user_id=$1 AND idempotency_key=$2`, u.User.ID, key).Scan(&oldDigest)
		if err == nil {
			if oldDigest != digest {
				var same bool
				err = tx.QueryRow(r.Context(), `SELECT jsonb_strip_nulls(jsonb_build_object('difficultyId',difficulty_id,'good',good,'ok',ok,'bad',bad,'score',score,'drumroll',drumroll,'max_combo',max_combo,'replay_data',replay_data,'ClearStatus',NULLIF(clear_status,0)))=$3::jsonb FROM scores WHERE user_id=$1 AND idempotency_key=$2`, u.User.ID, key, string(payload)).Scan(&same)
				if err != nil {
					internal(w, err)
					return
				}
				if !same {
					problem(w, 409, "IDEMPOTENCY_CONFLICT", "此请求标识已用于不同成绩")
					return
				}
			}
			result, err := readScore(tx.QueryRow(r.Context(), scoreSelect+` WHERE sc.user_id=$1 AND sc.idempotency_key=$2`, u.User.ID, key))
			if err != nil {
				internal(w, err)
				return
			}
			respond(w, 200, result)
			return
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			internal(w, err)
			return
		}
	}
	if !found {
		problem(w, 404, "DIFFICULTY_NOT_FOUND", "谱面块不存在")
		return
	}
	if !published {
		problem(w, 404, "CHART_NOT_FOUND", "歌曲不存在或已下架")
		return
	}
	result, err := readScore(tx.QueryRow(r.Context(), `WITH sc AS (INSERT INTO scores
	 (id,user_id,difficulty_id,good,ok,bad,score,drumroll,max_combo,idempotency_key,payload_digest,replay_data,clear_status)
	 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10,''),$11,$12,$13) RETURNING *)
	 SELECT `+scoreColumns+` FROM sc JOIN chart_difficulties d ON d.id=sc.difficulty_id`,
		ID(), u.User.ID, input.DifficultyID, *input.Good, *input.OK, *input.Bad, *input.Score, *input.Drumroll, *input.MaxCombo, key, digest, input.ReplayData, input.ClearStatus))
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		internal(w, err)
		return
	}
	respond(w, 201, result)
}
