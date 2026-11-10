package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
)

// ReplayListing is one recorded play on the public replay list: the score, the song's title and
// the block's level, and who played it. GET /api/v1/scores/{id}/replay gives its recording.
type ReplayListing struct {
	Score
	Title             string          `json:"title"`
	TitleTranslations json.RawMessage `json:"titleTranslations"`
	Subtitle          string          `json:"subtitle"`
	Level             int             `json:"level"`
	Nickname          string          `json:"nickname"`
	AvatarURL         string          `json:"avatarUrl"`
}

const replayListPageSize = 20

var replayListOrders = map[string]string{
	"recent": "sc.submitted_at DESC,sc.id",
	"score":  "sc.score DESC,sc.submitted_at DESC,sc.id",
}

// replayList is GET /api/v1/replays, public like the leaderboards: the plays whose recording is
// kept, on the current files of published charts, so each can be played back over the chart as
// it is now (the game's ghost battle). sort is recent (default) or score; course narrows to one
// course and categoryId to the songs of one category (as the game catalog lists them); 20 a page.
func (s *Server) replayList(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	sort := query.Get("sort")
	if sort == "" {
		sort = "recent"
	}
	order, sorted := replayListOrders[sort]
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
	if !sorted || (course != "" && !userScoreCourses[course]) {
		problem(w, 400, "QUERY_INVALID", "查询参数无效")
		return
	}
	args := []any{}
	where := `sc.replay_data IS NOT NULL AND sc.is_latest AND ` + publishedChart
	if course != "" {
		args = append(args, course)
		where += fmt.Sprintf(` AND d.course=$%d`, len(args))
	}
	if id := query.Get("categoryId"); id != "" {
		flag, ok := categoryFlag(id)
		if !ok {
			problem(w, 400, "QUERY_INVALID", "分类不存在")
			return
		}
		args = append(args, int(flag))
		where += fmt.Sprintf(` AND (c.category_flags & $%d::int)<>0`, len(args))
	}
	sql := `SELECT ` + scoreColumns + `,COALESCE(c.title,''),c.title_translations,COALESCE(c.subtitle,''),d.level,count(*) OVER()
	 FROM scores sc JOIN chart_difficulties d ON d.id=sc.difficulty_id JOIN charts c ON c.id=d.chart_id
	 WHERE ` + where + ` ORDER BY ` + order + fmt.Sprintf(` LIMIT %d OFFSET %d`, replayListPageSize, (page-1)*replayListPageSize)
	rows, err := s.DB.Query(r.Context(), sql, args...)
	if err != nil {
		internal(w, err)
		return
	}
	defer rows.Close()
	items := []ReplayListing{}
	total := 0
	for rows.Next() {
		var v ReplayListing
		var translations []byte
		if err = rows.Scan(&v.ID, &v.UserID, &v.SongID, &v.DifficultyID, &v.Course, &v.Side, &v.Good, &v.OK, &v.Bad, &v.Score.Score, &v.Drumroll, &v.MaxCombo, &v.ClearStatus, &v.IsLatest, &v.SubmittedAt, &v.AdLib, &v.Mines, &v.HasReplay,
			&v.Title, &translations, &v.Subtitle, &v.Level, &total); err != nil {
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
	rows.Close()
	if len(items) == 0 && page > 1 {
		// Past the last page: the count still says how many there are.
		if err = s.DB.QueryRow(r.Context(), `SELECT count(*) FROM scores sc JOIN chart_difficulties d ON d.id=sc.difficulty_id JOIN charts c ON c.id=d.chart_id WHERE `+where, args...).Scan(&total); err != nil {
			internal(w, err)
			return
		}
	}
	ids := []string{}
	for _, item := range items {
		ids = append(ids, item.UserID)
	}
	profiles := s.publicProfiles(r.Context(), ids)
	for i := range items {
		p := profiles[items[i].UserID]
		items[i].Nickname, items[i].AvatarURL = p.Nickname, p.AvatarURL
	}
	respond(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": replayListPageSize, "sort": sort})
}
