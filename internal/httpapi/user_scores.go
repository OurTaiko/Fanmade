package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// UserScore is one row of a player's public score list: a play, the song's title and the
// block's level. In the best view it also carries the best clear status among the plays it
// stands for and how many there were.
type UserScore struct {
	Score
	Title             string          `json:"title"`
	TitleTranslations json.RawMessage `json:"titleTranslations"`
	Level             int             `json:"level"`
	BestClearStatus   *int            `json:"bestClearStatus,omitempty"`
	PlayCount         *int            `json:"playCount,omitempty"`
}

const userScorePageSize = 50

// The plays of one user on published charts, with the block and title; $1 is the user.
const userPlays = `SELECT sc.id,sc.user_id,d.chart_id,sc.difficulty_id,d.course,d.side,sc.good,sc.ok,sc.bad,sc.score,sc.drumroll,sc.max_combo,sc.clear_status,sc.is_latest,sc.submitted_at,
 c.title,c.title_translations,d.level
 FROM scores sc JOIN chart_difficulties d ON d.id=sc.difficulty_id JOIN charts c ON c.id=d.chart_id
 WHERE sc.user_id=$1 AND ` + publishedChart

var userScoreCourses = map[string]bool{"Easy": true, "Normal": true, "Hard": true, "Oni": true, "Edit": true}

var userScoreOrders = map[string]string{
	"recent": "submitted_at DESC,id",
	"score":  "score DESC,submitted_at DESC,id",
	"level":  "level DESC,score DESC,id",
}

// userScores is GET /api/v1/users/{id}/scores, public like the leaderboards. view=best (the
// default) gives one row per chart block: the highest score among the plays of the song's
// current files, or of replaced files while the block has none of the current ones, with the
// best clear status of those plays and their count. view=all gives every play. sort is
// recent, score or level (default level for best, recent for all); course narrows to one
// course; 50 rows a page.
func (s *Server) userScores(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validSubject(id) {
		problem(w, 404, "USER_NOT_FOUND", "用户不存在")
		return
	}
	query := r.URL.Query()
	view := query.Get("view")
	if view == "" {
		view = "best"
	}
	sort := query.Get("sort")
	if sort == "" {
		sort = map[string]string{"best": "level", "all": "recent"}[view]
	}
	order, sorted := userScoreOrders[sort]
	page := 1
	if raw := query.Get("page"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 10000 {
			problem(w, 400, "QUERY_INVALID", "页码无效")
			return
		}
		page = n
	}
	course := query.Get("course")
	if (view != "best" && view != "all") || !sorted || (course != "" && !userScoreCourses[course]) {
		problem(w, 400, "QUERY_INVALID", "查询参数无效")
		return
	}
	args := []any{id}
	plays := userPlays
	if course != "" {
		args = append(args, course)
		plays += ` AND d.course=$2`
	}
	columns := `id,user_id,chart_id,difficulty_id,course,side,good,ok,bad,score,drumroll,max_combo,clear_status,is_latest,submitted_at,title,title_translations,level`
	var sql string
	if view == "all" {
		sql = `SELECT ` + columns + `,NULL::int,NULL::int,count(*) OVER() FROM (` + plays + `) p`
	} else {
		sql = `WITH plays AS (SELECT p.*,bool_or(p.is_latest) OVER (PARTITION BY p.difficulty_id) AS has_latest FROM (` + plays + `) p),
 considered AS (SELECT * FROM plays WHERE is_latest OR NOT has_latest),
 best AS (SELECT DISTINCT ON (difficulty_id) *,max(clear_status) OVER (PARTITION BY difficulty_id) AS best_clear,count(*) OVER (PARTITION BY difficulty_id) AS play_count
  FROM considered ORDER BY difficulty_id,score DESC,submitted_at,id)
 SELECT ` + columns + `,best_clear::int,play_count::int,count(*) OVER() FROM best`
	}
	sql += ` ORDER BY ` + order + fmt.Sprintf(` LIMIT %d OFFSET %d`, userScorePageSize, (page-1)*userScorePageSize)
	rows, err := s.DB.Query(r.Context(), sql, args...)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []UserScore{}
	total := 0
	for rows.Next() {
		var v UserScore
		var translations []byte
		if err = rows.Scan(&v.ID, &v.UserID, &v.SongID, &v.DifficultyID, &v.Course, &v.Side, &v.Good, &v.OK, &v.Bad, &v.Score.Score, &v.Drumroll, &v.MaxCombo, &v.ClearStatus, &v.IsLatest, &v.SubmittedAt,
			&v.Title, &translations, &v.Level, &v.BestClearStatus, &v.PlayCount, &total); err != nil {
			internal(w, err)
			return
		}
		v.TitleTranslations = translations
		items = append(items, v)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	if len(items) == 0 && page > 1 {
		// Past the last page: the count still says how many there are.
		count := `count(*)`
		if view == "best" {
			count = `count(DISTINCT difficulty_id)`
		}
		if err = s.DB.QueryRow(r.Context(), `SELECT `+count+` FROM (`+plays+`) p`, args...).Scan(&total); err != nil {
			internal(w, err)
			return
		}
	}
	respond(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": userScorePageSize, "view": view, "sort": sort})
}
