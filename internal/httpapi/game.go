package httpapi

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Native routes use SSO game sessions; browser routes use OIDC access tokens.
// Neither session type grants access to the other.
func isGameRequest(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/api/v1/game/")
}

func (s *Server) gameBootstrap(w http.ResponseWriter, r *http.Request) {
	// Catalog access is public. Only a native bearer session can opt into
	// personal scores; browser cookies never turn a guest into a game user.
	var user *User
	if r.Header.Get("Authorization") != "" {
		u, ok := s.required(w, r, false)
		if !ok {
			return
		}
		user = &u.User
	}
	tx, err := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), chartSelect+` WHERE `+publishedChart+` AND c.category_flags <> 0 ORDER BY c.created_at DESC,c.id DESC`)
	if err != nil {
		internal(w, err)
		return
	}
	charts, err := s.readCharts(rows)
	if err != nil {
		internal(w, err)
		return
	}
	categories := categoryCatalog
	// Read each chart once, newest uploads first as in the category list. Counts
	// come from this same snapshot; multi-category charts travel only once.
	memberships := make(map[string]int)
	for _, chart := range charts {
		for _, id := range chart.CategoryIDs {
			memberships[id]++
		}
	}
	type gameCategoryInfo struct {
		Category
		ChartCount int `json:"chartCount"`
	}
	counts := make([]gameCategoryInfo, 0, len(categories))
	for _, category := range categories {
		counts = append(counts, gameCategoryInfo{category.Category, memberships[category.ID]})
	}
	scores := []Score{}
	if user != nil {
		rows, err := tx.Query(r.Context(), `SELECT `+scoreColumns+` FROM scores WHERE user_id=$1 AND difficulty IN `+supportedCoursesSQL+` AND NOT EXISTS (SELECT 1 FROM charts c CROSS JOIN LATERAL jsonb_array_elements(c.difficulties) excluded WHERE c.id=scores.song_id AND excluded->>'course' NOT IN `+supportedCoursesSQL+`) ORDER BY submitted_at,id`, user.ID)
		if err != nil {
			internal(w, err)
			return
		}
		for rows.Next() {
			v, e := readScore(rows)
			if e != nil {
				rows.Close()
				internal(w, e)
				return
			}
			scores = append(scores, v)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			internal(w, err)
			return
		}
	}
	playlists, err := gamePlaylists(r.Context(), tx, user)
	if err != nil {
		internal(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		internal(w, err)
		return
	}
	s.chartNames(r.Context(), charts)
	if err = s.gamePlaylistDetails(r.Context(), playlists); err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"user": user, "courseKeyedDifficulties": true, "categories": counts, "charts": charts, "chartCount": len(charts), "scores": scores, "playlists": playlists, "playlistVersion": 1, "scoreReplayVersion": 1, "audioPreviewVersion": 1, "resourceDownloadVersion": func() int {
		if s.remoteStorage() {
			return 1
		}
		return 0
	}()})
}
