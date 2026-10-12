package httpapi

import (
	"context"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/cover"
)

const (
	maxPlaylists         = 100
	maxPlaylistItems     = 500
	maxPlaylistFavorites = 200
	maxPlaylistName      = 50
	maxPlaylistText      = 500
	playlistPageSize     = 12
)

// Playlist is an ordered list of songs. A system playlist is computed by the
// server: it has no owner and cannot be edited or kept as a favorite.
type Playlist struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Public      bool   `json:"public"`
	System      bool   `json:"system"`
	// The category's genre selects the folder artwork in the game.
	CategoryID    string             `json:"categoryId"`
	Genre         string             `json:"genre"`
	OwnerID       string             `json:"ownerId,omitempty"`
	Owner         *NotificationActor `json:"owner"`
	CoverHash     string             `json:"coverHash,omitempty"`
	ChartCount    int                `json:"chartCount"`
	FavoriteCount int                `json:"favoriteCount"`
	// Favorited is only filled for a signed-in viewer.
	Favorited bool       `json:"favorited"`
	CreatedAt *time.Time `json:"createdAt"`
	UpdatedAt *time.Time `json:"updatedAt"`
	// Only in the viewer's own list when it asks about one song.
	ContainsChart *bool `json:"containsChart,omitempty"`
	// Only in the detail response, in playlist order.
	Charts []Chart `json:"charts,omitempty"`
}

type PlaylistPage struct {
	Items    []Playlist `json:"items"`
	Total    int        `json:"total"`
	Page     int        `json:"page"`
	PageSize int        `json:"pageSize"`
}

type MyPlaylists struct {
	Owned        []Playlist `json:"owned"`
	Favorites    []Playlist `json:"favorites"`
	MaxPlaylists int        `json:"maxPlaylists"`
	MaxItems     int        `json:"maxItems"`
}

type playlistQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// playlistChartCount counts the songs of playlist p that are still public.
const playlistChartCount = `(SELECT count(*) FROM playlist_items i JOIN charts c ON c.id=i.chart_id WHERE i.playlist_id=p.id AND ` + publishedChart + `)`

// $1 is the viewer, empty for a guest.
const playlistSelect = `SELECT p.id,p.owner_id,p.name,p.description,p.is_public,p.category_flag,
 COALESCE((SELECT sha256 FROM chart_resources WHERE id=p.cover_file),''),p.created_at,p.updated_at,` + playlistChartCount + `,
 (SELECT count(*) FROM playlist_favorites f WHERE f.playlist_id=p.id),
 EXISTS(SELECT 1 FROM playlist_favorites f WHERE f.playlist_id=p.id AND f.user_id=$1)
 FROM playlists p `

func categoryByFlag(flag CategoryFlags) Category {
	for _, category := range categoryCatalog {
		if category.Flag == flag {
			return category.Category
		}
	}
	return Category{}
}

func readPlaylist(row pgx.Row) (Playlist, error) {
	var p Playlist
	var flag CategoryFlags
	var created, updated time.Time
	e := row.Scan(&p.ID, &p.OwnerID, &p.Name, &p.Description, &p.Public, &flag, &p.CoverHash, &created, &updated, &p.ChartCount, &p.FavoriteCount, &p.Favorited)
	category := categoryByFlag(flag)
	p.CategoryID, p.Genre, p.CreatedAt, p.UpdatedAt = category.ID, category.Genre, &created, &updated
	return p, e
}

func readPlaylists(ctx context.Context, db playlistQuerier, sql string, args ...any) ([]Playlist, error) {
	rows, e := db.Query(ctx, sql, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []Playlist{}
	for rows.Next() {
		p, e := readPlaylist(rows)
		if e != nil {
			return nil, e
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// playlistOwners fills the owners' public profiles; call it after the database
// work is done, because it contacts SSO.
func (s *Server) playlistOwners(ctx context.Context, lists ...[]Playlist) {
	ids := []string{}
	for _, items := range lists {
		for _, p := range items {
			if p.OwnerID != "" {
				ids = append(ids, p.OwnerID)
			}
		}
	}
	if len(ids) == 0 {
		return
	}
	profiles := s.publicProfiles(ctx, ids)
	for _, items := range lists {
		for i := range items {
			if id := items[i].OwnerID; id != "" {
				items[i].Owner = &NotificationActor{ID: id, Nickname: profiles[id].Nickname, AvatarURL: profiles[id].AvatarURL}
			}
		}
	}
}

func (s *Server) listPlaylists(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	q, owner := strings.TrimSpace(query.Get("q")), query.Get("owner")
	if utf8.RuneCountInString(q) > 100 || (owner != "" && !validSubject(owner)) {
		problem(w, 400, "QUERY_INVALID", "搜索条件无效")
		return
	}
	page := 1
	if raw := query.Get("page"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 10000 {
			problem(w, 400, "QUERY_INVALID", "页码无效")
			return
		}
		page = n
	}
	order := `p.updated_at DESC,p.id`
	switch query.Get("sort") {
	case "", "updated":
	case "newest":
		order = `p.created_at DESC,p.id`
	case "favorites":
		order = `(SELECT count(*) FROM playlist_favorites f WHERE f.playlist_id=p.id) DESC,p.updated_at DESC,p.id`
	default:
		problem(w, 400, "QUERY_INVALID", "顺序必须为 updated / newest / favorites")
		return
	}
	// The plaza leaves out playlists without a public song; a user's own page lists them all.
	const filter = ` WHERE p.is_public AND ($2='' OR position(lower($2) in lower(p.name||' '||p.description))>0)
 AND (CASE WHEN $3='' THEN ` + playlistChartCount + `>0 ELSE p.owner_id=$3 END)`
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	result := PlaylistPage{Page: page, PageSize: playlistPageSize}
	viewer := s.viewer(r)
	// The count shares the filter's parameter numbers, so it names the viewer too.
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM playlists p`+filter+` AND $1::text IS NOT NULL`, viewer, q, owner).Scan(&result.Total); e == nil {
		result.Items, e = readPlaylists(r.Context(), tx, playlistSelect+filter+` ORDER BY `+order+` LIMIT $4 OFFSET $5`, viewer, q, owner, playlistPageSize, (page-1)*playlistPageSize)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.playlistOwners(r.Context(), result.Items)
	respond(w, 200, result)
}

func (s *Server) myPlaylists(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, false)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, e := s.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	result := MyPlaylists{MaxPlaylists: maxPlaylists, MaxItems: maxPlaylistItems}
	result.Owned, e = readPlaylists(ctx, tx, playlistSelect+` WHERE p.owner_id=$1 ORDER BY p.updated_at DESC,p.id`, u.User.ID)
	if e == nil {
		result.Favorites, e = readPlaylists(ctx, tx, playlistSelect+` JOIN playlist_favorites mine ON mine.playlist_id=p.id
 WHERE mine.user_id=$1 AND p.is_public ORDER BY mine.favorited_at DESC,p.id`, u.User.ID)
	}
	if chart := r.URL.Query().Get("chart"); e == nil && chart != "" {
		var rows pgx.Rows
		if rows, e = tx.Query(ctx, `SELECT i.playlist_id FROM playlist_items i JOIN playlists p ON p.id=i.playlist_id WHERE p.owner_id=$1 AND i.chart_id=$2`, u.User.ID, chart); e == nil {
			var containing []string
			if containing, e = pgx.CollectRows(rows, pgx.RowTo[string]); e == nil {
				for i := range result.Owned {
					contains := slices.Contains(containing, result.Owned[i].ID)
					result.Owned[i].ContainsChart = &contains
				}
			}
		}
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	s.playlistOwners(ctx, result.Owned, result.Favorites)
	respond(w, 200, result)
}

// playlistCharts reads public songs in the order of ids.
func (s *Server) playlistCharts(ctx context.Context, ids []string) ([]Chart, error) {
	rows, e := s.DB.Query(ctx, chartSelect+` JOIN unnest($1::text[]) WITH ORDINALITY listed(id,ord) ON listed.id=c.id WHERE `+publishedChart+` ORDER BY listed.ord`, ids)
	if e != nil {
		return nil, e
	}
	charts, e := s.readCharts(rows)
	if e == nil {
		e = s.coverHashes(ctx, charts)
	}
	if e != nil {
		return nil, e
	}
	s.chartNames(ctx, charts)
	return charts, nil
}

func (s *Server) playlistDetail(w http.ResponseWriter, r *http.Request) {
	ctx, id := r.Context(), r.PathValue("id")
	var p Playlist
	var ids []string
	if system := systemPlaylistByID(id); system != nil {
		viewer := s.viewer(r)
		if system.personal && viewer == "" {
			problem(w, 401, "UNAUTHORIZED", "请先登录")
			return
		}
		var e error
		if ids, e = system.chartIDs(ctx, s.DB, viewer); e != nil {
			internal(w, e)
			return
		}
		p = system.playlist(len(ids))
	} else {
		var e error
		p, e = readPlaylist(s.DB.QueryRow(ctx, playlistSelect+` WHERE p.id=$2`, s.viewer(r), id))
		if e == nil && !p.Public {
			// A private playlist needs a verified session, not just the cookie.
			u, ue := s.current(r)
			if ue != nil && !errors.Is(ue, pgx.ErrNoRows) {
				internal(w, ue)
				return
			}
			if ue != nil || u.User.ID != p.OwnerID {
				e = pgx.ErrNoRows
			}
		}
		if errors.Is(e, pgx.ErrNoRows) {
			problem(w, 404, "PLAYLIST_NOT_FOUND", "歌单不存在或未公开")
			return
		}
		if e == nil {
			var rows pgx.Rows
			if rows, e = s.DB.Query(ctx, `SELECT chart_id FROM playlist_items WHERE playlist_id=$1 ORDER BY position,added_at,chart_id`, id); e == nil {
				ids, e = pgx.CollectRows(rows, pgx.RowTo[string])
			}
		}
		if e != nil {
			internal(w, e)
			return
		}
	}
	charts, e := s.playlistCharts(ctx, ids)
	if e != nil {
		internal(w, e)
		return
	}
	p.Charts, p.ChartCount = charts, len(charts)
	items := []Playlist{p}
	s.playlistOwners(ctx, items)
	respond(w, 200, items[0])
}

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
	if !s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		_, e := tx.Exec(r.Context(), `UPDATE playlists SET name=COALESCE($2,name),description=COALESCE($3,description),
 is_public=COALESCE($4,is_public),category_flag=COALESCE($5,category_flag),updated_at=now() WHERE id=$1`,
			r.PathValue("id"), body.Name, body.Description, body.Public, category)
		return true, e
	}) {
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
	if !s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
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
	}) {
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
	if !s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		tag, e := tx.Exec(ctx, `DELETE FROM playlist_items WHERE playlist_id=$1 AND chart_id=$2`, id, r.PathValue("chart"))
		if e == nil && tag.RowsAffected() > 0 {
			_, e = tx.Exec(ctx, `UPDATE playlists SET updated_at=now() WHERE id=$1`, id)
		}
		return true, e
	}) {
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
		if seen[chart] || len(body.ChartIDs) > maxPlaylistItems {
			problem(w, 400, "PLAYLIST_INVALID", "歌曲顺序无效")
			return
		}
		seen[chart] = true
	}
	ctx, id := r.Context(), r.PathValue("id")
	if !s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
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
	}) {
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}

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
	favorited := r.Method == "PUT"
	if favorited {
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
	} else {
		_, e = tx.Exec(ctx, `DELETE FROM playlist_favorites WHERE playlist_id=$1 AND user_id=$2`, id, u.User.ID)
	}
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

func (s *Server) getPlaylistCover(w http.ResponseWriter, r *http.Request) {
	var digest, key string
	// The address of a private playlist's cover is its unguessable ID and hash.
	e := s.DB.QueryRow(r.Context(), `SELECT cv.sha256,cv.storage_key FROM chart_resources cv JOIN playlists p ON p.cover_file=cv.id WHERE p.id=$1`, r.PathValue("id")).Scan(&digest, &key)
	if errors.Is(e, pgx.ErrNoRows) || (e == nil && r.URL.Query().Get("v") != digest) {
		problem(w, 404, "COVER_NOT_FOUND", "封面不存在或已被替换")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if s.redirectResource(w, r, key, "") {
		return
	}
	w.Header().Set("Content-Type", "image/webp")
	w.Header().Set("Content-Disposition", `inline; filename="cover.webp"`)
	w.Header().Set("Cache-Control", "public, no-cache")
	w.Header().Set("ETag", `"`+digest+`"`)
	f, e := s.Config.Objects.Open(r.Context(), key)
	if e != nil {
		internal(w, e)
		return
	}
	defer f.Close()
	http.ServeContent(w, r, "cover.webp", time.Time{}, f)
}

// setPlaylistCover replaces the cover (PUT) or removes it (DELETE).
func (s *Server) setPlaylistCover(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var encoded, game []byte
	if r.Method == "PUT" {
		select {
		case s.uploads <- struct{}{}:
			defer func() { <-s.uploads }()
		default:
			problem(w, 503, "UPLOAD_BUSY", "当前正在处理其他上传，请稍后重试")
			return
		}
		if encoded, ok = receiveCover(w, r); !ok {
			return
		}
		var e error
		if game, e = cover.GameImage(encoded); e != nil {
			internal(w, e)
			return
		}
	}
	// Ownership is checked after encoding, under the playlist's lock.
	if !s.ownPlaylist(w, r, u.User.ID, func(tx pgx.Tx) (bool, error) {
		var file, gameFile *int64
		if encoded != nil {
			id, e := s.storeCover(r.Context(), tx, encoded)
			if e != nil {
				return false, e
			}
			gameID, e := s.storeImage(r.Context(), tx, game, cover.GameExtension, cover.GameMediaType)
			if e != nil {
				return false, e
			}
			file, gameFile = &id, &gameID
		}
		_, e := tx.Exec(r.Context(), `UPDATE playlists SET cover_file=$2,game_cover_file=$3,updated_at=now() WHERE id=$1`, r.PathValue("id"), file, gameFile)
		return true, e
	}) {
		return
	}
	s.cleanupReplacedFiles()
	result := map[string]string{"coverHash": ""}
	if encoded != nil {
		result["coverHash"] = hash(string(encoded))
	}
	respond(w, 200, result)
}
