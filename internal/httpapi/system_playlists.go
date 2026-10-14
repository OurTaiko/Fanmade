package httpapi

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
)

// systemPlaylist is a playlist the server computes on request. Its ID is a
// plain word, which no stored playlist ID (32 hex digits) can equal.
type systemPlaylist struct {
	id, name, description string
	category              CategoryFlags
	// personal lists depend on the viewer and do not exist for a guest.
	personal bool
	// query selects song IDs from charts c in playlist order; a personal
	// query takes the viewer as $1.
	query string
}

// Only songs of the game catalog are listed, so the website and the game show
// the same songs.
const systemChart = publishedChart + ` AND c.category_flags<>0`

// Names are English like the category titles; the website translates them by ID.
var systemPlaylists = []systemPlaylist{
	{"liked", "Liked Songs", "Songs you upvoted, newest first.", CategoryPop, true,
		`SELECT c.id FROM chart_votes v JOIN charts c ON c.id=v.chart_id WHERE v.user_id=$1 AND v.value=1 AND ` + systemChart + `
 ORDER BY v.voted_at DESC,c.id LIMIT 500`},
	{"popular", "Popular This Week", "The 20 most played songs of the last 7 days.", CategoryGame, false,
		`SELECT c.id FROM charts c JOIN (SELECT d.chart_id AS song_id,count(*) AS plays FROM scores sc JOIN chart_difficulties d ON d.id=sc.difficulty_id WHERE sc.submitted_at>now()-interval '7 days' GROUP BY d.chart_id) played ON played.song_id=c.id
 WHERE ` + systemChart + ` ORDER BY played.plays DESC,c.created_at DESC,c.id LIMIT 20`},
	{"acclaimed", "Recently Acclaimed", "The 20 best rated songs uploaded in the last 30 days.", CategoryClassic, false,
		`SELECT c.id FROM charts c WHERE ` + systemChart + ` AND c.created_at>now()-interval '30 days' AND ` + chartScoreSQL + `>0
 ORDER BY ` + chartScoreSQL + ` DESC,c.created_at DESC,c.id LIMIT 20`},
	// The date seeds the draw, so everyone gets the same ten songs until midnight in China.
	{"daily", "Daily Challenge", "Ten songs drawn at random every day.", CategoryVariety, false,
		`SELECT c.id FROM charts c WHERE ` + systemChart + `
 ORDER BY md5(c.id||to_char(now() AT TIME ZONE 'Asia/Shanghai','YYYYMMDD')),c.id LIMIT 10`},
}

func systemPlaylistByID(id string) *systemPlaylist {
	for i := range systemPlaylists {
		if systemPlaylists[i].id == id {
			return &systemPlaylists[i]
		}
	}
	return nil
}

func (p *systemPlaylist) chartIDs(ctx context.Context, db playlistQuerier, viewer string) ([]string, error) {
	args := []any{}
	if p.personal {
		args = append(args, viewer)
	}
	rows, e := db.Query(ctx, p.query, args...)
	if e != nil {
		return nil, e
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (p *systemPlaylist) playlist(charts int) Playlist {
	category := categoryByFlag(p.category)
	return Playlist{ID: p.id, Name: p.name, Description: p.description, Public: !p.personal, System: true,
		CategoryID: category.ID, Genre: category.Genre, ChartCount: charts}
}

// listSystemPlaylists returns the system playlists that currently have songs.
func (s *Server) listSystemPlaylists(w http.ResponseWriter, r *http.Request) {
	viewer := s.viewer(r)
	items := []Playlist{}
	for i := range systemPlaylists {
		p := &systemPlaylists[i]
		if p.personal && viewer == "" {
			continue
		}
		ids, e := p.chartIDs(r.Context(), s.DB, viewer)
		if e != nil {
			internal(w, e)
			return
		}
		if len(ids) > 0 {
			items = append(items, p.playlist(len(ids)))
		}
	}
	respond(w, 200, map[string]any{"items": items})
}
