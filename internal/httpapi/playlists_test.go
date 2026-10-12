package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"ourtaiko.dev/fanmade/api/internal/teststore"
)

const (
	playlistOwner = "d46774d30dd13b92d9e536808da468a4"
	playlistAlice = "9b893bc6d9422c93536ff0df503b81e9"
)

func playlistIDs(charts []Chart) string {
	ids := []string{}
	for _, c := range charts {
		ids = append(ids, c.ID)
	}
	return strings.Join(ids, ",")
}

// The fixture's requests share one address; start a new rate-limit window.
func resetRateLimit(s *Server) {
	s.mu.Lock()
	clear(s.limits)
	s.mu.Unlock()
}

func TestPlaylistLifecycle(t *testing.T) {
	c, s := interactionFixture(t)
	ctx := context.Background()
	for _, body := range []string{`{}`, `{"name":"  "}`, `{"name":"` + strings.Repeat("歌", 51) + `"}`, `{"name":"a","categoryId":"none"}`,
		`{"name":"a","description":"` + strings.Repeat("字", 501) + `"}`, `{"name":"a\u0007"}`} {
		if code := c.do("owner", "POST", "/api/v1/playlists", body, nil); code != 400 {
			t.Fatal("invalid playlist accepted", body, code)
		}
	}
	if code := c.do("", "POST", "/api/v1/playlists", `{"name":"Mine"}`, nil); code != 401 {
		t.Fatal("guest created a playlist", code)
	}
	var p Playlist
	if code := c.do("owner", "POST", "/api/v1/playlists", `{"name":" Mine ","description":"first\r\nline"}`, &p); code != 201 ||
		p.Name != "Mine" || p.Description != "first\nline" || p.Public || p.System || p.CategoryID != "variety" || p.Genre != "VARIETY" ||
		p.OwnerID != playlistOwner || p.Owner == nil || p.ChartCount != 0 || p.CreatedAt == nil {
		t.Fatalf("created %d %+v", code, p)
	}
	path := "/api/v1/playlists/" + p.ID
	// A private playlist exists only for its owner.
	for user, want := range map[string]int{"": 404, "alice": 404, "admin": 404, "owner": 200} {
		if code := c.do(user, "GET", path, "", nil); code != want {
			t.Fatal("private visibility", user, code)
		}
	}
	for _, write := range [][2]string{{"PATCH", path}, {"DELETE", path}, {"PUT", path + "/items/song"}, {"DELETE", path + "/items/song"}, {"PUT", path + "/order"}, {"PUT", path + "/favorite"}} {
		if code := c.do("alice", write[0], write[1], `{}`, nil); code != 404 {
			t.Fatal("private playlist reachable", write, code)
		}
	}

	resetRateLimit(s)
	add := func(user, chart string, want int) {
		t.Helper()
		if code := c.do(user, "PUT", path+"/items/"+chart, `{}`, nil); code != want {
			t.Fatalf("add %s by %s: %d want %d", chart, user, code, want)
		}
	}
	add("owner", "song", 201)
	add("owner", "song", 200)
	add("owner", "missing", 404)
	add("owner", "other", 201)
	detail := func(user string) Playlist {
		t.Helper()
		var v Playlist
		if code := c.do(user, "GET", path, "", &v); code != 200 {
			t.Fatal("detail", code)
		}
		return v
	}
	if v := detail("owner"); playlistIDs(v.Charts) != "song,other" || v.ChartCount != 2 || v.Charts[0].Uploader == "" {
		t.Fatalf("order %s %+v", playlistIDs(v.Charts), v)
	}
	order := func(body string, want int) {
		t.Helper()
		if code := c.do("owner", "PUT", path+"/order", body, nil); code != want {
			t.Fatalf("order %s: %d want %d", body, code, want)
		}
	}
	order(`{"chartIds":["other","other"]}`, 400)
	order(`{"chartIds":["other","gone"]}`, 409)
	order(`{"chartIds":["other","song"]}`, 200)
	if v := detail("owner"); playlistIDs(v.Charts) != "other,song" {
		t.Fatal("reordered", playlistIDs(v.Charts))
	}
	// Songs the request leaves out keep their place behind the listed ones.
	order(`{"chartIds":["song"]}`, 200)
	if v := detail("owner"); playlistIDs(v.Charts) != "song,other" {
		t.Fatal("partial order", playlistIDs(v.Charts))
	}

	var mine MyPlaylists
	if code := c.do("owner", "GET", "/api/v1/me/playlists?chart=other", "", &mine); code != 200 || len(mine.Owned) != 1 || len(mine.Favorites) != 0 ||
		mine.Owned[0].ContainsChart == nil || !*mine.Owned[0].ContainsChart || mine.MaxItems != maxPlaylistItems {
		t.Fatalf("mine %d %+v", code, mine)
	}
	if code := c.do("", "GET", "/api/v1/me/playlists", "", nil); code != 401 {
		t.Fatal("guest library", code)
	}

	resetRateLimit(s)
	// Publishing; an empty description clears it and absent fields are kept.
	if code := c.do("owner", "PATCH", path, `{"public":true,"description":"","categoryId":"game"}`, &p); code != 200 ||
		!p.Public || p.Description != "" || p.Name != "Mine" || p.Genre != "GAME" || p.ChartCount != 2 {
		t.Fatalf("published %d %+v", code, p)
	}
	if code := c.do("alice", "PATCH", path, `{"name":"Stolen"}`, nil); code != 403 {
		t.Fatal("foreign edit", code)
	}
	add("alice", "song", 403)
	if code := c.do("", "GET", path, "", &p); code != 200 || len(p.Charts) != 2 {
		t.Fatal("public detail", code)
	}

	favorite := func(user, method string, want, total int) {
		t.Helper()
		var result struct {
			Favorited     bool
			FavoriteCount int
		}
		if code := c.do(user, method, path+"/favorite", `{}`, &result); code != want || (want == 200 && (result.FavoriteCount != total || result.Favorited != (method == "PUT"))) {
			t.Fatalf("favorite %s %s: %d %+v", user, method, code, result)
		}
	}
	favorite("", "PUT", 401, 0)
	favorite("owner", "PUT", 409, 0)
	favorite("alice", "PUT", 200, 1)
	favorite("alice", "PUT", 200, 1)
	favorite("bob", "PUT", 200, 2)
	favorite("bob", "DELETE", 200, 1)
	if v := detail("alice"); !v.Favorited || v.FavoriteCount != 1 {
		t.Fatalf("favorited detail %+v", v)
	}
	if code := c.do("alice", "GET", "/api/v1/me/playlists", "", &mine); code != 200 || len(mine.Owned) != 0 || len(mine.Favorites) != 1 || mine.Favorites[0].ID != p.ID {
		t.Fatalf("alice library %d %+v", code, mine)
	}

	resetRateLimit(s)
	// Plaza: public playlists with songs; a user's page also lists empty ones.
	var empty Playlist
	if code := c.do("owner", "POST", "/api/v1/playlists", `{"name":"Empty","public":true}`, &empty); code != 201 {
		t.Fatal("empty playlist", code)
	}
	var page PlaylistPage
	list := func(query string, want ...string) {
		t.Helper()
		if code := c.do("alice", "GET", "/api/v1/playlists"+query, "", &page); code != 200 || page.Total != len(want) || len(page.Items) != len(want) {
			t.Fatalf("list %s: %d %+v", query, code, page)
		}
		for i, id := range want {
			if page.Items[i].ID != id {
				t.Fatalf("list %s item %d: %s", query, i, page.Items[i].ID)
			}
		}
	}
	list("", p.ID)
	if !page.Items[0].Favorited || page.Items[0].Owner == nil || page.Items[0].Charts != nil {
		t.Fatalf("plaza item %+v", page.Items[0])
	}
	list("?q=MIN", p.ID)
	list("?q=%25")
	list("?sort=favorites&owner="+playlistOwner, p.ID, empty.ID)
	list("?owner=" + playlistAlice)
	for _, query := range []string{"?sort=random", "?page=0", "?owner=x"} {
		if code := c.do("", "GET", "/api/v1/playlists"+query, "", nil); code != 400 {
			t.Fatal("invalid query", query, code)
		}
	}
	var space UserSpace
	if code := c.do("", "GET", "/api/v1/users/"+playlistOwner, "", &space); code != 200 || space.User.PlaylistCount != 2 {
		t.Fatal("public playlist count", code, space.User.PlaylistCount)
	}

	resetRateLimit(s)
	// A playlist that turns private hides from those who keep it, and returns with it.
	c.do("owner", "PATCH", path, `{"public":false}`, nil)
	if code := c.do("alice", "GET", "/api/v1/me/playlists", "", &mine); code != 200 || len(mine.Favorites) != 0 {
		t.Fatal("private favorite shown", code)
	}
	if code := c.do("alice", "GET", path, "", nil); code != 404 {
		t.Fatal("private favorite readable", code)
	}
	favorite("alice", "DELETE", 200, 0)
	c.do("owner", "PATCH", path, `{"public":true}`, nil)
	favorite("alice", "PUT", 200, 1)

	// The game receives own playlists (private too), favorites and system ones, without empty folders.
	game := func(user string) []GamePlaylist {
		t.Helper()
		tx, e := s.DB.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		var u *User
		if user != "" {
			u = &User{ID: user}
		}
		items, e := gamePlaylists(ctx, tx, u)
		if e != nil {
			t.Fatal(e)
		}
		if e = s.gamePlaylistDetails(ctx, items); e != nil {
			t.Fatal(e)
		}
		return items
	}
	kinds := func(items []GamePlaylist) string {
		out := []string{}
		for _, v := range items {
			out = append(out, v.Kind+":"+v.Title+":"+v.Genre+":"+strings.Join(v.ChartIDs, "+"))
		}
		return strings.Join(out, " ")
	}
	c.do("owner", "PATCH", "/api/v1/playlists/"+empty.ID, `{"public":false}`, nil)
	c.do("owner", "PUT", "/api/v1/playlists/"+empty.ID+"/items/other", `{}`, nil)
	c.do("alice", "PUT", "/api/v1/charts/other/vote", `{"value":1}`, nil)
	if got := kinds(game(playlistOwner)); !strings.HasPrefix(got, "owned:Empty:VARIETY:other owned:Mine:GAME:song+other system:") || strings.Contains(got, "Liked") {
		t.Fatal("owner folders", got)
	}
	alice := game(playlistAlice)
	if got := kinds(alice); !strings.HasPrefix(got, "favorite:Mine:GAME:song+other system:Liked Songs:J-POP:other ") || alice[0].Owner == "" {
		t.Fatal("alice folders", got)
	}
	guest := kinds(game(""))
	if strings.Contains(guest, "Mine") || strings.Contains(guest, "Liked") || !strings.Contains(guest, "system:Daily Challenge:VARIETY:") || !strings.Contains(guest, "system:Recently Acclaimed:CLASSICAL:other") {
		t.Fatal("guest folders", guest)
	}
	r := httptest.NewRequest("GET", "/api/v1/game/bootstrap", nil)
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	var bootstrap struct {
		Playlists       []GamePlaylist
		PlaylistVersion int
	}
	if e := json.Unmarshal(w.Body.Bytes(), &bootstrap); e != nil || w.Code != 200 || bootstrap.PlaylistVersion != 1 || kinds(bootstrap.Playlists) != guest {
		t.Fatal("bootstrap", w.Code, e, kinds(bootstrap.Playlists))
	}

	resetRateLimit(s)
	// System playlists on the website.
	var systems struct{ Items []Playlist }
	if code := c.do("alice", "GET", "/api/v1/playlists/system", "", &systems); code != 200 || len(systems.Items) != 3 || systems.Items[0].ID != "liked" || !systems.Items[0].System || systems.Items[0].Owner != nil {
		t.Fatalf("systems %d %+v", code, systems)
	}
	if code := c.do("", "GET", "/api/v1/playlists/system", "", &systems); code != 200 || len(systems.Items) != 2 || systems.Items[0].ID != "acclaimed" {
		t.Fatalf("guest systems %d %+v", code, systems)
	}
	var liked Playlist
	if code := c.do("alice", "GET", "/api/v1/playlists/liked", "", &liked); code != 200 || playlistIDs(liked.Charts) != "other" || !liked.System || liked.Public {
		t.Fatalf("liked %d %+v", code, liked)
	}
	if code := c.do("", "GET", "/api/v1/playlists/liked", "", nil); code != 401 {
		t.Fatal("guest liked", code)
	}
	if code := c.do("", "GET", "/api/v1/playlists/daily", "", &liked); code != 200 || len(liked.Charts) != 2 {
		t.Fatal("daily", code, len(liked.Charts))
	}
	for _, write := range [][2]string{{"PATCH", ""}, {"DELETE", ""}, {"PUT", "/items/song"}, {"PUT", "/favorite"}} {
		if code := c.do("alice", write[0], "/api/v1/playlists/liked"+write[1], `{}`, nil); code != 404 {
			t.Fatal("system playlist written", write, code)
		}
	}

	resetRateLimit(s)
	// A deleted song leaves the playlist.
	if code := c.do("owner", "DELETE", "/api/v1/charts/song", `{}`, nil); code != 200 {
		t.Fatal("delete song", code)
	}
	if v := detail("alice"); playlistIDs(v.Charts) != "other" || v.ChartCount != 1 {
		t.Fatal("deleted song listed", playlistIDs(v.Charts))
	}
	if code := c.do("owner", "DELETE", path+"/items/other", `{}`, nil); code != 200 {
		t.Fatal("remove", code)
	}
	if v := detail("alice"); len(v.Charts) != 0 {
		t.Fatal("removed song listed")
	}

	// Administrators may delete public playlists only; the owner is told.
	if code := c.do("alice", "DELETE", path, `{}`, nil); code != 403 {
		t.Fatal("foreign delete", code)
	}
	if code := c.do("admin", "DELETE", "/api/v1/playlists/"+empty.ID, `{}`, nil); code != 404 {
		t.Fatal("admin deleted a private playlist", code)
	}
	if code := c.do("admin", "DELETE", path, `{}`, nil); code != 200 {
		t.Fatal("admin delete", code)
	}
	var notices NotificationPage
	if code := c.do("owner", "GET", "/api/v1/me/notifications", "", &notices); code != 200 || len(notices.Items) == 0 ||
		notices.Items[0].Kind != "playlist_removed" || notices.Items[0].Data["name"] != "Mine" || notices.Items[0].Actor != nil {
		t.Fatalf("removal notice %d %+v", code, notices)
	}
	if code := c.do("owner", "DELETE", "/api/v1/playlists/"+empty.ID, `{}`, nil); code != 200 {
		t.Fatal("own delete", code)
	}
	var left int
	if e := s.DB.QueryRow(ctx, `SELECT (SELECT count(*) FROM playlists)+(SELECT count(*) FROM playlist_items)+(SELECT count(*) FROM playlist_favorites)`).Scan(&left); e != nil || left != 0 {
		t.Fatal("rows left", left, e)
	}
}

func TestPlaylistLimits(t *testing.T) {
	c, s := interactionFixture(t)
	ctx := context.Background()
	if _, e := s.DB.Exec(ctx, `INSERT INTO playlists(id,owner_id,name,is_public) SELECT 'p'||n,$1,'List '||n,true FROM generate_series(1,$2) n`, playlistOwner, maxPlaylists-1); e != nil {
		t.Fatal(e)
	}
	// Concurrent creations cannot exceed the limit.
	var wg sync.WaitGroup
	codes := make(chan int, 4)
	for range 4 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- c.do("owner", "POST", "/api/v1/playlists", `{"name":"Last"}`, nil) }()
	}
	wg.Wait()
	close(codes)
	created := 0
	for code := range codes {
		if code == 201 {
			created++
		} else if code != 409 {
			t.Fatal("create at limit", code)
		}
	}
	if created != 1 {
		t.Fatal("created over the limit", created)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO charts(id,owner_ids,title,bpm,duration,tja_file,audio_file,difficulties)
 SELECT 'c'||n,ARRAY[$1::text],'Song '||n,120,10,test_file('song/tja','a.tja',repeat('a',64),14),test_file('song/audio','a.ogg',repeat('a',64),14),'[{"course":"Oni","level":5,"maker":""}]' FROM generate_series(1,$2) n`, playlistOwner, maxPlaylistItems); e != nil {
		t.Fatal(e)
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO playlist_items(playlist_id,chart_id,position) SELECT 'p1','c'||n,n FROM generate_series(1,$1) n`, maxPlaylistItems); e != nil {
		t.Fatal(e)
	}
	if code := c.do("owner", "PUT", "/api/v1/playlists/p1/items/song", `{}`, nil); code != 409 {
		t.Fatal("add to a full playlist", code)
	}
	if code := c.do("owner", "PUT", "/api/v1/playlists/p1/items/c7", `{}`, nil); code != 200 {
		t.Fatal("existing song of a full playlist", code)
	}
	var p Playlist
	if code := c.do("", "GET", "/api/v1/playlists/p1", "", &p); code != 200 || len(p.Charts) != maxPlaylistItems || p.Charts[0].ID != "c1" || p.Charts[maxPlaylistItems-1].ID != fmt.Sprint("c", maxPlaylistItems) {
		t.Fatal("full playlist", code, len(p.Charts))
	}
	var page PlaylistPage
	if code := c.do("", "GET", "/api/v1/playlists?page=2&owner="+playlistOwner, "", &page); code != 200 || page.Total != maxPlaylists-1 || len(page.Items) != playlistPageSize {
		t.Fatal("second page", code, page.Total, len(page.Items))
	}
}

func TestPlaylistCover(t *testing.T) {
	c, s := interactionFixture(t)
	ctx := context.Background()
	var p Playlist
	if code := c.do("owner", "POST", "/api/v1/playlists", `{"name":"Covered","public":true}`, &p); code != 201 {
		t.Fatal(code)
	}
	path := "/api/v1/playlists/" + p.ID + "/cover"
	var picture bytes.Buffer
	if e := png.Encode(&picture, image.NewNRGBA(image.Rect(0, 0, 40, 30))); e != nil {
		t.Fatal(e)
	}
	upload := func(user, name string, data []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		out, _ := form.CreateFormFile("cover", name)
		_, _ = out.Write(data)
		_ = form.Close()
		r := httptest.NewRequest("PUT", path, &body)
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("Content-Type", form.FormDataContentType())
		r.Header.Set("X-CSRF-Token", "csrf")
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: c.tokens[user]})
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, r)
		return w
	}
	if w := upload("alice", "cover.png", picture.Bytes()); w.Code != 403 {
		t.Fatal("foreign cover", w.Code)
	}
	if w := upload("owner", "cover.png", []byte("not an image")); w.Code != 422 {
		t.Fatal("invalid cover", w.Code)
	}
	w := upload("owner", "cover.png", picture.Bytes())
	var result struct{ CoverHash string }
	if e := json.Unmarshal(w.Body.Bytes(), &result); e != nil || w.Code != 200 || len(result.CoverHash) != 64 {
		t.Fatal("cover", w.Code, w.Body.String())
	}
	if code := c.do("", "GET", "/api/v1/playlists/"+p.ID, "", &p); code != 200 || p.CoverHash != result.CoverHash {
		t.Fatal("cover hash", code, p.CoverHash)
	}
	get := func(query string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c.handler.ServeHTTP(w, httptest.NewRequest("GET", path+query, nil))
		return w
	}
	if w := get("?v=" + result.CoverHash); w.Code != 200 || w.Header().Get("Content-Type") != "image/webp" || hash(w.Body.String()) != result.CoverHash {
		t.Fatal("served cover", w.Code)
	}
	if w := get(""); w.Code != 404 {
		t.Fatal("cover without its hash", w.Code)
	}
	// The game gets a small JPEG of the cover, linked only by servers with direct downloads.
	var gameKey, gameHash string
	var gameSize int64
	if e := s.DB.QueryRow(ctx, `SELECT r.storage_key,r.sha256,r.byte_size FROM playlists p JOIN chart_resources r ON r.id=p.game_cover_file WHERE p.id=$1`, p.ID).Scan(&gameKey, &gameHash, &gameSize); e != nil || gameKey != gameHash+".jpg" {
		t.Fatal("game cover", gameKey, e)
	}
	object, e := s.Config.Objects.Open(ctx, gameKey)
	if e != nil {
		t.Fatal(e)
	}
	format, kind, e := image.DecodeConfig(object)
	object.Close()
	if e != nil || kind != "jpeg" || format.Width != 40 || format.Height != 30 {
		t.Fatal("game cover image", kind, format, e)
	}
	c.do("owner", "PUT", "/api/v1/playlists/"+p.ID+"/items/song", `{}`, nil)
	folders := func(app *Server) []GamePlaylist {
		t.Helper()
		tx, e := s.DB.Begin(ctx)
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback(ctx)
		items, e := gamePlaylists(ctx, tx, &User{ID: playlistOwner})
		if e == nil {
			e = app.gamePlaylistDetails(ctx, items)
		}
		if e != nil || len(items) == 0 || items[0].ID != p.ID {
			t.Fatal("game folders", e, items)
		}
		return items
	}
	if folders(s)[0].Cover != nil {
		t.Fatal("cover linked without direct downloads")
	}
	direct := &Server{DB: s.DB, Config: Config{Objects: teststore.New(t), SSO: s.Config.SSO}}
	if link := folders(direct)[0].Cover; link == nil || !strings.Contains(link.URL, gameKey) || link.HeadURL == "" ||
		link.SHA256 != gameHash || link.Size != gameSize || link.ContentType != "image/jpeg" {
		t.Fatalf("cover link %+v", link)
	}
	stored := func() int {
		var n int
		if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM chart_resources WHERE sha256=$1`, result.CoverHash).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	// A song sharing the image keeps the file when the playlist releases it.
	if _, e := s.DB.Exec(ctx, `UPDATE charts SET cover_file=(SELECT id FROM chart_resources WHERE sha256=$1) WHERE id='song'`, result.CoverHash); e != nil {
		t.Fatal(e)
	}
	if code := c.do("owner", "DELETE", path, `{}`, nil); code != 200 || stored() != 1 {
		t.Fatal("shared cover removed", code, stored())
	}
	if w := get("?v=" + result.CoverHash); w.Code != 404 {
		t.Fatal("removed cover served", w.Code)
	}
	if w := upload("owner", "cover.png", picture.Bytes()); w.Code != 200 {
		t.Fatal("cover again", w.Code)
	}
	if _, e := s.DB.Exec(ctx, `UPDATE charts SET cover_file=NULL WHERE id='song'`); e != nil {
		t.Fatal(e)
	}
	s.cleanupReplacedFiles()
	if stored() != 1 {
		t.Fatal("playlist cover deleted while referenced")
	}
	if code := c.do("owner", "DELETE", "/api/v1/playlists/"+p.ID, `{}`, nil); code != 200 || stored() != 0 {
		t.Fatal("cover kept after its playlist", code, stored())
	}
	for _, key := range []string{result.CoverHash + ".webp", gameKey} {
		if _, e := s.Config.Objects.Open(ctx, key); e == nil {
			t.Fatal("cover object kept", key)
		}
	}
	var files int
	if e := s.DB.QueryRow(ctx, `SELECT count(*) FROM chart_resources WHERE extension IN ('webp','jpg')`).Scan(&files); e != nil || files != 0 {
		t.Fatal("cover files kept", files, e)
	}
}
