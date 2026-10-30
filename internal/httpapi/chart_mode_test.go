package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestChartSlotsUploadScoresAndSearch(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	token := strings.Repeat("c", 64)
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','doubletest','unused');`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','csrf',now()+interval '1 day'),($2,'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','',now()+interval '1 day')`, hash(token), hash("game:"+token)); err != nil {
		t.Fatal(err)
	}
	handler := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir()}).Handler()
	audio, err := os.ReadFile("../../kit/audio/testdata/cbr.mp3")
	if err != nil {
		t.Fatal(err)
	}
	header := "TITLE:Double\nBPM:120\nWAVE:cbr.mp3\nCOURSE:Oni\nLEVEL:8\n"
	single := "#START\n3000,\n#END\n"
	p1 := "#START P1\n1000,\n#END\n"
	p2 := "#START P2\n2000,\n#END\n"
	upload := func(source string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		tf, _ := form.CreateFormFile("tja", "double.tja")
		tf.Write([]byte(source))
		af, _ := form.CreateFormFile("audio", "cbr.mp3")
		af.Write(audio)
		form.WriteField("difficultyMakers", `[{"course":"Oni","side":"single","maker":"S"},{"course":"Oni","side":"p1","maker":"A"},{"course":"Oni","side":"p2","maker":"B"}]`)
		form.Close()
		r := httptest.NewRequest("POST", "/api/v1/charts", &body)
		r.Header.Set("Content-Type", form.FormDataContentType())
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("X-CSRF-Token", "csrf")
		r.Header.Set("Idempotency-Key", ID())
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: token})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, body := range []string{header + p1 + p1, header + "STYLE:Double\n#START\n1000,\n#END", header + single + p1 + single} {
		if w := upload(body); w.Code != 422 {
			t.Fatal("invalid chart accepted", w.Code, w.Body.String())
		}
	}
	// Single and double blocks share a file; each is a slot of its own.
	w := upload(header + p2 + single + p1)
	var c Chart
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &c) != nil || len(c.Difficulties) != 3 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, key := range []string{"blockIndex", "cloudScoreEligible", "\"style\"", "\"player\"", "isSingle", "_1p"} {
		if strings.Contains(w.Body.String(), key) {
			t.Fatal("obsolete field exposed", key)
		}
	}
	for i, want := range []string{"single S", "p1 A", "p2 B"} {
		d := c.Difficulties[i]
		if d.ID == 0 || d.Course != "Oni" || d.Side+" "+d.Maker != want {
			t.Fatal(c.Difficulties)
		}
	}
	call := func(method, path, body, key string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		r.Header.Set("Content-Type", "application/json")
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	score := func(difficulty int64, points int) string {
		data, _ := json.Marshal(map[string]any{"difficultyId": difficulty, "good": 10, "ok": 0, "bad": 0, "score": points, "drumroll": 0, "max_combo": 10, "ClearStatus": 2})
		return string(data)
	}
	for i, d := range c.Difficulties {
		key := ID()
		body := score(d.ID, 1000+i)
		var v Score
		if w := call("POST", "/api/v1/game/scores", body, key); w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &v) != nil ||
			v.SongID != c.ID || v.DifficultyID != d.ID || v.Course != "Oni" || v.Side != d.Side || !v.IsLatest {
			t.Fatal(w.Code, w.Body.String())
		}
		if w := call("POST", "/api/v1/game/scores", body, key); w.Code != 200 {
			t.Fatal("retry", w.Code, w.Body.String())
		}
	}
	if w := call("POST", "/api/v1/game/scores", score(c.Difficulties[2].ID+1000, 2000), ID()); w.Code != 404 {
		t.Fatal("nonexistent block accepted", w.Code, w.Body.String())
	}
	if w := call("POST", "/api/v1/game/scores", score(0, 2000), ID()); w.Code != 422 {
		t.Fatal("missing block accepted", w.Code, w.Body.String())
	}
	if w := call("POST", "/api/v1/game/scores", `{"songId":"`+c.ID+`","difficulty":"Oni","good":1,"ok":0,"bad":0,"score":1,"drumroll":0,"max_combo":1}`, ID()); w.Code != 400 {
		t.Fatal("retired score form accepted", w.Code, w.Body.String())
	}
	// Every block has its own leaderboard; the default is the first of the hardest course.
	for i, d := range c.Difficulties {
		w := call("GET", fmt.Sprintf("/api/v1/charts/%s/leaderboard?difficultyId=%d", c.ID, d.ID), "", "")
		var v leaderboardResponse
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &v) != nil || v.Total != 1 || len(v.Items) != 1 || v.DifficultyID != d.ID || v.Side != d.Side || v.Items[0].Side != d.Side || v.Items[0].Score.Score != int64(1000+i) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	var v leaderboardResponse
	if w := call("GET", "/api/v1/charts/"+c.ID+"/leaderboard", "", ""); w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &v) != nil || v.Course != "Oni" || v.Side != "single" {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("GET", "/api/v1/game/catalog", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"chartSlotVersion":1`) || !strings.Contains(w.Body.String(), `"side":"p2"`) || strings.Contains(w.Body.String(), "isSingle") {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("GET", "/api/v1/game/scores", "", "")
	if w.Code != 200 || strings.Count(w.Body.String(), `"difficultyId"`) != 3 || !strings.Contains(w.Body.String(), `"side":"p2"`) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = call("GET", "/api/v1/game/search?course=Oni", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), c.ID) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w = call("GET", "/api/v1/game/search?course=Oni_1p", "", ""); w.Code != 400 {
		t.Fatal("side-suffixed course accepted", w.Code, w.Body.String())
	}
}
