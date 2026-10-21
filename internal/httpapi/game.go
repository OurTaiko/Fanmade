package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Native routes use SSO game sessions; browser routes use OIDC access tokens.
// Neither session type grants access to the other.
func isGameRequest(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/api/v1/game/")
}

// gameCatalog is the complete song list for a game client: categories, charts
// and the public playlists. It is the same for everyone and ignores any
// session; an account's scores are GET /api/v1/game/scores and its own
// playlists GET /api/v1/game/playlists.
func (s *Server) gameCatalog(w http.ResponseWriter, r *http.Request) {
	// Read in one snapshot so the counts match the charts.
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
	playlists, err := gamePlaylists(r.Context(), tx, nil)
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
	body := map[string]any{"chartSlotVersion": 1, "categories": counts, "charts": charts, "chartCount": len(charts), "playlists": playlists, "playlistVersion": 1, "scoreReplayVersion": 1, "audioPreviewVersion": 1, "resourceDownloadVersion": func() int {
		if s.remoteStorage() {
			return 1
		}
		return 0
	}()}
	if s.Config.SSO != nil {
		body["sso"] = s.Config.SSO.GameAccounts()
	}
	respond(w, 200, body)
}

// Scores of songs outside the catalog are of no use to a client.
const gameScoresSQL = scoreSelect + ` JOIN charts c ON c.id=d.chart_id WHERE sc.user_id=$1 AND ` + publishedChart + ` ORDER BY sc.submitted_at,sc.id`

// scoreQuerier is a transaction or the pool.
type scoreQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// gameScores lists the scores a game client keeps for an account.
func gameScores(ctx context.Context, q scoreQuerier, userID any) ([]Score, error) {
	scores := []Score{}
	rows, err := q.Query(ctx, gameScoresSQL, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		v, e := readScore(rows)
		if e != nil {
			return nil, e
		}
		scores = append(scores, v)
	}
	return scores, rows.Err()
}

// gameScoreList returns the signed-in account's scores on their own.
func (s *Server) gameScoreList(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, false)
	if !ok {
		return
	}
	scores, err := gameScores(r.Context(), s.DB, u.User.ID)
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, 200, map[string]any{"scores": scores})
}
