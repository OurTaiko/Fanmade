package httpapi

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/cover"
	"ourtaiko.dev/fanmade/api/internal/objectstore"
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
		`SELECT c.id FROM charts c JOIN (SELECT song_id,count(*) AS plays FROM scores WHERE submitted_at>now()-interval '7 days' GROUP BY song_id) played ON played.song_id=c.id
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

// GamePlaylist is a folder of the game's song select: the user's own and
// favorite playlists and the system ones, as IDs of songs in the catalog.
type GamePlaylist struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Genre string `json:"genre"`
	// "owned", "favorite" or "system".
	Kind    string `json:"kind"`
	OwnerID string `json:"ownerId,omitempty"`
	Owner   string `json:"owner"`
	// Cover is the JPEG for the folder; only servers with direct downloads
	// (resourceDownloadVersion 1) provide it.
	Cover    *resourceLink `json:"cover,omitempty"`
	ChartIDs []string      `json:"chartIds"`
	// The stored game cover, resolved to Cover after the snapshot.
	coverKey, coverHash string
	coverSize           int64
}

// gamePlaylists reads the folders for user (nil for a guest) from the
// bootstrap snapshot. Empty playlists are left out; owner names and cover
// links are filled later by gamePlaylistDetails.
func gamePlaylists(ctx context.Context, tx pgx.Tx, user *User) ([]GamePlaylist, error) {
	items := []GamePlaylist{}
	viewer := ""
	if user != nil {
		viewer = user.ID
		rows, e := tx.Query(ctx, `SELECT p.id,p.name,p.category_flag,p.owner_id,p.owner_id=$1,COALESCE(gc.storage_key,''),COALESCE(gc.sha256,''),COALESCE(gc.byte_size,0),
 ARRAY(SELECT i.chart_id FROM playlist_items i JOIN charts c ON c.id=i.chart_id WHERE i.playlist_id=p.id AND `+systemChart+` ORDER BY i.position,i.added_at,i.chart_id)
 FROM playlists p LEFT JOIN playlist_favorites mine ON mine.playlist_id=p.id AND mine.user_id=$1
 LEFT JOIN chart_resources gc ON gc.id=p.game_cover_file
 WHERE p.owner_id=$1 OR (mine.user_id IS NOT NULL AND p.is_public)
 ORDER BY p.owner_id<>$1,CASE WHEN p.owner_id=$1 THEN p.updated_at ELSE mine.favorited_at END DESC,p.id`, viewer)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			p := GamePlaylist{Kind: "favorite"}
			var flag CategoryFlags
			var own bool
			if e = rows.Scan(&p.ID, &p.Title, &flag, &p.OwnerID, &own, &p.coverKey, &p.coverHash, &p.coverSize, &p.ChartIDs); e != nil {
				rows.Close()
				return nil, e
			}
			if own {
				p.Kind = "owned"
			}
			p.Genre = categoryByFlag(flag).Genre
			if len(p.ChartIDs) > 0 {
				items = append(items, p)
			}
		}
		rows.Close()
		if e = rows.Err(); e != nil {
			return nil, e
		}
	}
	for i := range systemPlaylists {
		p := &systemPlaylists[i]
		if p.personal && user == nil {
			continue
		}
		ids, e := p.chartIDs(ctx, tx, viewer)
		if e != nil {
			return nil, e
		}
		if len(ids) > 0 {
			items = append(items, GamePlaylist{ID: p.id, Title: p.name, Genre: categoryByFlag(p.category).Genre, Kind: "system", ChartIDs: ids})
		}
	}
	return items, nil
}

func (s *Server) gamePlaylistDetails(ctx context.Context, items []GamePlaylist) error {
	ids := []string{}
	remote, _ := s.Config.Objects.(*objectstore.S3)
	for i, p := range items {
		if p.OwnerID != "" {
			ids = append(ids, p.OwnerID)
		}
		if remote != nil && p.coverKey != "" {
			link, e := directLink(ctx, remote, p.coverKey, "cover."+cover.GameExtension, cover.GameMediaType, p.coverHash, p.coverSize)
			if e != nil {
				return e
			}
			items[i].Cover = &link
		}
	}
	if len(ids) == 0 {
		return nil
	}
	profiles := s.publicProfiles(ctx, ids)
	for i := range items {
		if items[i].OwnerID != "" {
			items[i].Owner = profiles[items[i].OwnerID].Nickname
		}
	}
	return nil
}
