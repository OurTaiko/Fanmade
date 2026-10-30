package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

const chartScoreSQL = `COALESCE((SELECT upvotes-downvotes FROM chart_stats WHERE chart_id=c.id),0)`

// keywordFilter matches a published chart whose title, subtitle, any
// translation or any difficulty's maker contains the keyword in $1. An empty
// keyword matches every published chart. Uploader nicknames are not searched.
const keywordFilter = ` WHERE ` + publishedChart + ` AND ($1='' OR c.title ILIKE '%'||$1||'%' OR c.subtitle ILIKE '%'||$1||'%'
 OR EXISTS(SELECT 1 FROM chart_difficulties dm WHERE dm.chart_id=c.id AND dm.maker ILIKE '%'||$1||'%')
 OR EXISTS(SELECT 1 FROM jsonb_each_text(c.title_translations) t WHERE t.value ILIKE '%'||$1||'%')
 OR EXISTS(SELECT 1 FROM jsonb_each_text(c.subtitle_translations) t WHERE t.value ILIKE '%'||$1||'%'))`

func searchKeyword(w http.ResponseWriter, r *http.Request) (string, bool) {
	q := r.URL.Query().Get("q")
	if len(q) > 200 {
		problem(w, 400, "QUERY_INVALID", "搜索内容过长")
		return "", false
	}
	return q, true
}

// gameSearch is the game's song picker: keyword, difficulty and star level,
// optionally putting songs the player has not yet full-combo'd (unfc) or
// all-perfected (unperfect) first. It returns every match in one snapshot,
// without pagination or web-only enrichment.
func (s *Server) gameSearch(w http.ResponseWriter, r *http.Request) {
	q, ok := searchKeyword(w, r)
	if !ok {
		return
	}
	course := r.URL.Query().Get("course")
	canonical, validCourse := normalizeCourse(course)
	if course != "" && (!validCourse || canonical != course) {
		problem(w, 400, "DIFFICULTY_INVALID", "仅支持五种规范难度")
		return
	}
	level := -1
	if raw := r.URL.Query().Get("level"); raw != "" {
		var err error
		level, err = strconv.Atoi(raw)
		if err != nil || level < 1 || level > 10 {
			problem(w, 400, "QUERY_INVALID", "星数必须在 1 到 10 之间")
			return
		}
	}
	order := r.URL.Query().Get("order")
	switch order {
	case "", "default", "unfc", "unperfect":
	default:
		problem(w, 400, "QUERY_INVALID", "顺序必须为 default / unfc / unperfect")
		return
	}
	// Only a game Bearer session personalizes the order; guests keep the default.
	userID := ""
	if order == "unfc" || order == "unperfect" {
		u, err := s.current(r)
		if err == nil {
			userID = u.User.ID
		} else if !errors.Is(err, pgx.ErrNoRows) {
			internal(w, err)
			return
		}
	}
	// course and level must hold for the same block; a course covers all its sides.
	const matching = `SELECT 1 FROM chart_difficulties d WHERE d.chart_id=c.id AND ($2='' OR d.course=$2) AND ($3::int=-1 OR d.level=$3)`
	// Prioritize a chart when any matching block has no qualifying score for
	// this user. Scores of replaced files count only where none is current.
	rows, e := s.DB.Query(r.Context(), chartSelect+keywordFilter+` AND EXISTS(`+matching+`)
	 ORDER BY ($4::text<>'' AND EXISTS(`+matching+`
	 AND NOT EXISTS(SELECT 1 FROM scores sc WHERE sc.user_id=$4 AND sc.difficulty_id=d.id
	 AND (sc.is_latest OR NOT EXISTS(SELECT 1 FROM scores cur WHERE cur.user_id=$4 AND cur.difficulty_id=d.id AND cur.is_latest))
	 AND sc.bad=0 AND (sc.good>0 OR sc.ok>0)
	 AND ($5::text='unfc' OR sc.ok=0)))) DESC, c.created_at DESC,c.id DESC`, q, course, level, userID, order)
	if e != nil {
		internal(w, e)
		return
	}
	items, e := s.readCharts(rows)
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 200, map[string]any{"items": items, "total": len(items)})
}

// webSearch pages the website's song list: keyword, an optional uploader, a category, a
// course and star level that must hold for the same block (any side), and newest, hot,
// top-voted, most-discussed or recently updated order. The filters are OurTaiko Database's.
func (s *Server) webSearch(w http.ResponseWriter, r *http.Request, owner string) {
	q, ok := searchKeyword(w, r)
	if !ok {
		return
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		problem(w, 400, "QUERY_INVALID", "页码超出范围")
		return
	}
	query := r.URL.Query()
	var flag CategoryFlags
	if id := query.Get("category"); id != "" {
		var ok bool
		if flag, ok = categoryFlag(id); !ok {
			problem(w, 400, "QUERY_INVALID", "分类不存在")
			return
		}
	}
	course := query.Get("course")
	switch course {
	case "", "Easy", "Normal", "Hard", "Oni", "Edit":
	default:
		problem(w, 400, "QUERY_INVALID", "难度必须为 Easy / Normal / Hard / Oni / Edit")
		return
	}
	level := 0
	if raw := query.Get("level"); raw != "" {
		var e error
		if level, e = strconv.Atoi(raw); e != nil || level < 1 || level > 10 {
			problem(w, 400, "QUERY_INVALID", "星数必须在 1 到 10 之间")
			return
		}
	}
	ordering := ` ORDER BY c.created_at DESC,c.id DESC`
	switch r.URL.Query().Get("order") {
	case "", "default":
	// Reddit's "hot": the vote score counts logarithmically against age, so
	// every tenfold score keeps a song ranked as high as one 12.5 hours newer.
	case "hot":
		ordering = ` ORDER BY sign(` + chartScoreSQL + `)*log(greatest(abs(` + chartScoreSQL + `),1))+extract(epoch FROM c.created_at)/45000 DESC, c.created_at DESC,c.id DESC`
	case "top":
		ordering = ` ORDER BY ` + chartScoreSQL + ` DESC, c.created_at DESC,c.id DESC`
	case "comments":
		ordering = ` ORDER BY COALESCE((SELECT comment_count FROM chart_stats WHERE chart_id=c.id),0) DESC, c.created_at DESC,c.id DESC`
	case "updated":
		ordering = ` ORDER BY c.update_at DESC,c.id DESC`
	default:
		problem(w, 400, "QUERY_INVALID", "顺序必须为 default / hot / top / comments / updated")
		return
	}
	where := keywordFilter + ` AND ($2='' OR c.owner_ids @> ARRAY[$2::text])
 AND ($3::int=0 OR (c.category_flags & $3::int)<>0)
 AND (($4='' AND $5::int=0) OR EXISTS(SELECT 1 FROM chart_difficulties d
   WHERE d.chart_id=c.id AND ($4='' OR d.course=$4) AND ($5::int=0 OR d.level=$5)))`
	args := []any{q, owner, int(flag), course, level}
	var total int
	if e := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM charts c`+where, args...).Scan(&total); e != nil {
		internal(w, e)
		return
	}
	rows, e := s.DB.Query(r.Context(), chartSelect+where+ordering+` LIMIT 12 OFFSET $6`, append(args, (page-1)*12)...)
	if e != nil {
		internal(w, e)
		return
	}
	items, e := s.readCharts(rows)
	if e == nil {
		e = s.coverHashes(r.Context(), items)
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.chartNames(r.Context(), items)
	respond(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": 12})
}

func (s *Server) readCharts(rows pgx.Rows) ([]Chart, error) {
	defer rows.Close()
	items := []Chart{}
	for rows.Next() {
		c, e := s.readChart(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, c)
	}
	return items, rows.Err()
}
