package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

type leaderboardEntry struct {
	Score
	Nickname  string `json:"nickname"`
	AvatarURL string `json:"avatarUrl"`
	Rank      int64  `json:"rank"`
}

type leaderboardResponse struct {
	SongID string `json:"songId"`
	// The ranked block; each block of a song has its own leaderboard.
	DifficultyID int64              `json:"difficultyId"`
	Course       string             `json:"course"`
	Side         string             `json:"side"`
	Items        []leaderboardEntry `json:"items"`
	Total        int                `json:"total"`
	Page         int                `json:"page"`
	PageSize     int                `json:"pageSize"`
}

func (s *Server) leaderboard(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	page := 1
	if raw := query.Get("page"); raw != "" {
		var err error
		page, err = strconv.Atoi(raw)
		if err != nil || page < 1 || page > 10000 {
			problem(w, 400, "QUERY_INVALID", "页码需要为 1–10000 的整数")
			return
		}
	}
	var difficulty int64
	if raw := query.Get("difficultyId"); raw != "" {
		var err error
		difficulty, err = strconv.ParseInt(raw, 10, 64)
		if err != nil || difficulty < 1 {
			problem(w, 400, "DIFFICULTY_INVALID", "难度无效")
			return
		}
	}
	// One snapshot keeps the chart, count, ranks and page consistent.
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	result := leaderboardResponse{SongID: r.PathValue("id"), Page: page, PageSize: 20, Items: []leaderboardEntry{}}
	err = tx.QueryRow(r.Context(), `SELECT id FROM charts c WHERE c.id=$1 AND `+publishedChart, result.SongID).Scan(&result.SongID)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "歌曲不存在或已下架")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	// Without a block, the hardest one: Oni, then Edit, down to Easy.
	err = tx.QueryRow(r.Context(), `SELECT d.id,d.course,d.side FROM chart_difficulties d WHERE d.chart_id=$1 AND ($2=0 OR d.id=$2)
	 ORDER BY array_position(ARRAY['Oni','Edit','Hard','Normal','Easy'],d.course),array_position(ARRAY['single','p1','p2'],d.side) LIMIT 1`, result.SongID, difficulty).
		Scan(&result.DifficultyID, &result.Course, &result.Side)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, 404, "DIFFICULTY_NOT_FOUND", "歌曲不存在此难度")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	// Scores of replaced files are kept but no longer ranked.
	err = tx.QueryRow(r.Context(), `SELECT count(DISTINCT user_id) FROM scores WHERE difficulty_id=$1 AND is_latest`, result.DifficultyID).Scan(&result.Total)
	if err != nil {
		internal(w, err)
		return
	}
	rows, err := tx.Query(r.Context(), `WITH best AS (
	 SELECT DISTINCT ON (user_id) * FROM scores
	 WHERE difficulty_id=$1 AND is_latest
	 ORDER BY user_id,score DESC,submitted_at,id
	), ranked AS (
	 SELECT best.*,rank() OVER (ORDER BY score DESC) AS place FROM best
	)
	SELECT `+scoreColumns+`,sc.place
	FROM ranked sc JOIN chart_difficulties d ON d.id=sc.difficulty_id
	ORDER BY sc.score DESC,sc.submitted_at,sc.id LIMIT $2 OFFSET $3`, result.DifficultyID, result.PageSize, (page-1)*result.PageSize)
	if err != nil {
		internal(w, err)
		return
	}
	for rows.Next() {
		var v leaderboardEntry
		if err = rows.Scan(&v.ID, &v.UserID, &v.SongID, &v.DifficultyID, &v.Course, &v.Side, &v.Good, &v.OK, &v.Bad, &v.Score.Score, &v.Drumroll, &v.MaxCombo, &v.ClearStatus, &v.IsLatest, &v.SubmittedAt, &v.Rank); err != nil {
			rows.Close()
			internal(w, err)
			return
		}
		result.Items = append(result.Items, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		internal(w, err)
		return
	}
	ids := []string{}
	for _, entry := range result.Items {
		ids = append(ids, entry.UserID)
	}
	profiles := s.publicProfiles(r.Context(), ids)
	for i := range result.Items {
		p := profiles[result.Items[i].UserID]
		result.Items[i].Nickname, result.Items[i].AvatarURL = p.Nickname, p.AvatarURL
	}
	respond(w, 200, result)
}
