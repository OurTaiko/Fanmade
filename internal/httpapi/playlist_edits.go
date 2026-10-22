package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type playlistRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Public      *bool   `json:"public"`
	CategoryID  *string `json:"categoryId"`
}

// normalize trims and validates the fields that are present.
func (body *playlistRequest) normalize(w http.ResponseWriter) (CategoryFlags, bool) {
	clean := func(text string, limit int, multiline bool) (string, bool) {
		text = strings.TrimSpace(strings.ReplaceAll(text, "\r\n", "\n"))
		for _, c := range text {
			if unicode.IsControl(c) && !(multiline && c == '\n') {
				return "", false
			}
		}
		return text, utf8.RuneCountInString(text) <= limit
	}
	if body.Name != nil {
		name, ok := clean(*body.Name, maxPlaylistName, false)
		if !ok || name == "" {
			problem(w, 400, "PLAYLIST_INVALID", "歌单名称需为 1–50 个字符")
			return 0, false
		}
		body.Name = &name
	}
	if body.Description != nil {
		text, ok := clean(*body.Description, maxPlaylistText, true)
		if !ok {
			problem(w, 400, "PLAYLIST_INVALID", "歌单简介不能超过 500 个字符")
			return 0, false
		}
		body.Description = &text
	}
	flag := CategoryVariety
	if body.CategoryID != nil {
		var ok bool
		if flag, ok = categoryFlag(*body.CategoryID); !ok {
			problem(w, 400, "CATEGORY_INVALID", "分类无效")
			return 0, false
		}
	}
	return flag, true
}

func (s *Server) respondPlaylist(w http.ResponseWriter, r *http.Request, status int, viewer, id string) {
	p, e := readPlaylist(s.DB.QueryRow(r.Context(), playlistSelect+` WHERE p.id=$2`, viewer, id))
	if e != nil {
		internal(w, e)
		return
	}
	items := []Playlist{p}
	s.playlistOwners(r.Context(), items)
	respond(w, status, items[0])
}

func (s *Server) createPlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var body playlistRequest
	if !decode(w, r, &body) {
		return
	}
	if body.Name == nil {
		problem(w, 400, "PLAYLIST_INVALID", "歌单名称需为 1–50 个字符")
		return
	}
	flag, ok := body.normalize(w)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	// Serialize one user's creations so the limit holds.
	var count int
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "playlists:"+u.User.ID); e == nil {
		e = tx.QueryRow(ctx, `SELECT count(*) FROM playlists WHERE owner_id=$1`, u.User.ID).Scan(&count)
	}
	if e != nil {
		internal(w, e)
		return
	}
	if count >= maxPlaylists {
		problem(w, 409, "PLAYLIST_LIMIT", "每位用户最多创建 100 个歌单")
		return
	}
	id, description := ID(), ""
	if body.Description != nil {
		description = *body.Description
	}
	if _, e = tx.Exec(ctx, `INSERT INTO playlists(id,owner_id,name,description,is_public,category_flag) VALUES($1,$2,$3,$4,$5,$6)`,
		id, u.User.ID, *body.Name, description, body.Public != nil && *body.Public, flag); e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.respondPlaylist(w, r, 201, u.User.ID, id)
}

// lockOwnPlaylist locks a playlist for the rest of tx and reports whether the
// user owns it. Others see a private playlist as missing.
func lockOwnPlaylist(w http.ResponseWriter, ctx context.Context, tx pgx.Tx, id, user string) bool {
	var owner string
	var public bool
	e := tx.QueryRow(ctx, `SELECT owner_id,is_public FROM playlists WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &public)
	switch {
	case e != nil && !errors.Is(e, pgx.ErrNoRows):
		internal(w, e)
	case e != nil || (owner != user && !public):
		problem(w, 404, "PLAYLIST_NOT_FOUND", "歌单不存在或未公开")
	case owner != user:
		problem(w, 403, "FORBIDDEN", "只能修改自己的歌单")
	default:
		return true
	}
	return false
}

// ownPlaylist runs change in a transaction holding the user's playlist. change
// reports false after it has written its own error response.
func (s *Server) ownPlaylist(w http.ResponseWriter, r *http.Request, user string, change func(tx pgx.Tx) (bool, error)) bool {
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return false
	}
	defer tx.Rollback(ctx)
	if !lockOwnPlaylist(w, ctx, tx, r.PathValue("id"), user) {
		return false
	}
	ok, e := change(tx)
	if e == nil && ok {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return false
	}
	return ok
}

func (s *Server) editPlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var body playlistRequest
	if !decode(w, r, &body) {
		return
	}
	flag, ok := body.normalize(w)
	if !ok {
		return
	}
	var category *CategoryFlags
	if body.CategoryID != nil {
		category = &flag
	}
	// An empty description clears it; only an absent field keeps the old value.
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		_, e := tx.Exec(r.Context(), `UPDATE playlists SET name=COALESCE($2,name),description=COALESCE($3,description),
 is_public=COALESCE($4,is_public),category_flag=COALESCE($5,category_flag),updated_at=now() WHERE id=$1`,
			r.PathValue("id"), body.Name, body.Description, body.Public, category)
		return true, e
	})
	if !ok {
		return
	}
	s.respondPlaylist(w, r, 200, u.User.ID, r.PathValue("id"))
}

// deletePlaylist lets the owner delete a playlist, and an administrator a
// public one; the owner is then told which playlist was removed.
func (s *Server) deletePlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var owner, name string
	var public, cover bool
	e = tx.QueryRow(ctx, `SELECT owner_id,name,is_public,cover_file IS NOT NULL FROM playlists WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &name, &public, &cover)
	if errors.Is(e, pgx.ErrNoRows) || (e == nil && owner != u.User.ID && !public) {
		problem(w, 404, "PLAYLIST_NOT_FOUND", "歌单不存在或未公开")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if owner != u.User.ID && !u.User.IsAdmin {
		problem(w, 403, "FORBIDDEN", "只能删除自己的歌单")
		return
	}
	if _, e = tx.Exec(ctx, `DELETE FROM playlists WHERE id=$1`, id); e == nil && owner != u.User.ID {
		// The owner learns of a removal, but not which administrator removed it.
		e = notify(ctx, tx, Notice{Recipient: owner, Kind: "playlist_removed", Data: map[string]any{"name": name}})
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	if cover {
		s.cleanupReplacedFiles()
	}
	respond(w, 200, map[string]bool{"ok": true})
}

func (s *Server) addPlaylistItem(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	added, count := false, 0
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		// Holding the song row FOR SHARE serializes the addition with a deletion.
		var chart string
		e := tx.QueryRow(ctx, `SELECT c.id FROM charts c WHERE c.id=$1 AND `+publishedChart+` FOR SHARE`, r.PathValue("chart")).Scan(&chart)
		if errors.Is(e, pgx.ErrNoRows) {
			problem(w, 404, "CHART_NOT_FOUND", "作品不存在或已删除")
			return false, nil
		}
		var exists bool
		var last *int
		if e == nil {
			e = tx.QueryRow(ctx, `SELECT count(*),max(position),COALESCE(bool_or(chart_id=$2),false) FROM playlist_items WHERE playlist_id=$1`, id, chart).Scan(&count, &last, &exists)
		}
		if e != nil || exists {
			return true, e
		}
		if count >= maxPlaylistItems {
			problem(w, 409, "PLAYLIST_FULL", "每个歌单最多收录 500 首歌曲")
			return false, nil
		}
		position := 0
		if last != nil {
			position = *last + 1
		}
		if _, e = tx.Exec(ctx, `INSERT INTO playlist_items(playlist_id,chart_id,position) VALUES($1,$2,$3)`, id, chart, position); e == nil {
			_, e = tx.Exec(ctx, `UPDATE playlists SET updated_at=now() WHERE id=$1`, id)
		}
		added, count = true, count+1
		return true, e
	})
	if !ok {
		return
	}
	status := 200
	if added {
		status = 201
	}
	respond(w, status, map[string]any{"added": added, "itemCount": count})
}

func (s *Server) removePlaylistItem(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		tag, e := tx.Exec(ctx, `DELETE FROM playlist_items WHERE playlist_id=$1 AND chart_id=$2`, id, r.PathValue("chart"))
		if e == nil && tag.RowsAffected() > 0 {
			_, e = tx.Exec(ctx, `UPDATE playlists SET updated_at=now() WHERE id=$1`, id)
		}
		return true, e
	})
	if !ok {
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

// orderPlaylist moves the listed songs to the front in the given order. Songs
// the request leaves out, such as ones hidden from the editor, keep their
// relative order behind them.
func (s *Server) orderPlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var body struct {
		ChartIDs []string `json:"chartIds"`
	}
	if !decodeLimit(w, r, &body, 64*1024) {
		return
	}
	seen := map[string]bool{}
	for _, chart := range body.ChartIDs {
		seen[chart] = true
	}
	if len(body.ChartIDs) > maxPlaylistItems || len(seen) != len(body.ChartIDs) {
		problem(w, 400, "PLAYLIST_INVALID", "歌曲顺序无效")
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	ok = s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		rows, e := tx.Query(ctx, `SELECT chart_id FROM playlist_items WHERE playlist_id=$1 ORDER BY position,added_at,chart_id`, id)
		if e != nil {
			return false, e
		}
		current, e := pgx.CollectRows(rows, pgx.RowTo[string])
		if e != nil {
			return false, e
		}
		order := slices.Clone(body.ChartIDs)
		for _, chart := range current {
			if !seen[chart] {
				order = append(order, chart)
			}
		}
		if len(order) != len(current) {
			problem(w, 409, "PLAYLIST_CHANGED", "歌单内容已变化，请刷新后重试")
			return false, nil
		}
		_, e = tx.Exec(ctx, `UPDATE playlist_items i SET position=listed.ord-1 FROM unnest($2::text[]) WITH ORDINALITY listed(chart_id,ord)
 WHERE i.playlist_id=$1 AND i.chart_id=listed.chart_id`, id, order)
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE playlists SET updated_at=now() WHERE id=$1`, id)
		}
		return true, e
	})
	if !ok {
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

// favoritePlaylist keeps a public playlist of another user as a favorite.
func (s *Server) favoritePlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	// Holding the playlist FOR SHARE serializes the favorite with a deletion.
	var owner string
	e = tx.QueryRow(ctx, `SELECT owner_id FROM playlists WHERE id=$1 AND is_public FOR SHARE`, id).Scan(&owner)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "PLAYLIST_NOT_FOUND", "歌单不存在或未公开")
		return
	}
	if e == nil && owner == u.User.ID {
		problem(w, 409, "OWN_PLAYLIST", "不能收藏自己的歌单")
		return
	}
	// Serialize one user's favorites so the limit holds.
	var count int
	var exists bool
	if e == nil {
		_, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "playlist-favorites:"+u.User.ID)
	}
	if e == nil {
		e = tx.QueryRow(ctx, `SELECT count(*),COALESCE(bool_or(playlist_id=$2),false) FROM playlist_favorites WHERE user_id=$1`, u.User.ID, id).Scan(&count, &exists)
	}
	if e == nil && !exists {
		if count >= maxPlaylistFavorites {
			problem(w, 409, "FAVORITE_LIMIT", "最多收藏 200 个歌单")
			return
		}
		_, e = tx.Exec(ctx, `INSERT INTO playlist_favorites(playlist_id,user_id) VALUES($1,$2)`, id, u.User.ID)
	}
	respondFavorite(w, ctx, tx, id, true, e)
}

// unfavoritePlaylist also works on a playlist that has turned private.
func (s *Server) unfavoritePlaylist(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx, id := r.Context(), r.PathValue("id")
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `DELETE FROM playlist_favorites WHERE playlist_id=$1 AND user_id=$2`, id, u.User.ID)
	respondFavorite(w, ctx, tx, id, false, e)
}

// respondFavorite commits a favorite change, unless e reports that it failed,
// and replies with the playlist's new count.
func respondFavorite(w http.ResponseWriter, ctx context.Context, tx pgx.Tx, id string, favorited bool, e error) {
	var total int
	if e == nil {
		e = tx.QueryRow(ctx, `SELECT count(*) FROM playlist_favorites WHERE playlist_id=$1`, id).Scan(&total)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 200, map[string]any{"favorited": favorited, "favoriteCount": total})
}
