package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Songs withdrawn for a Tower or Dan course (migrations 012 and 042) keep
// their rows and scores, and no reader exposes them.
func TestWithdrawnChartsAPI(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES('89b6ef3a5cb57b6e04f74711d15a8a5f','tester','unused')`)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{strings.Repeat("1", 32), strings.Repeat("2", 32), strings.Repeat("3", 32)}
	for i, id := range ids {
		status := "hidden"
		if i == 0 {
			status = "published"
		}
		_, err = pool.Exec(ctx, `INSERT INTO charts(id,owner_ids,title,bpm,duration,status,tja_file,audio_file) VALUES($1,ARRAY['89b6ef3a5cb57b6e04f74711d15a8a5f'],'Chart',120,10,$2,test_file('chart.tja','chart.tja',repeat('a',64),1),test_file('music.ogg','music.ogg',repeat('b',64),1))`, id, status)
		if err != nil {
			t.Fatal(err)
		}
		_, err = pool.Exec(ctx, `INSERT INTO scores(id,user_id,difficulty_id,good,ok,bad,score,drumroll,max_combo,payload_digest) VALUES($1,'89b6ef3a5cb57b6e04f74711d15a8a5f',test_slot($2,'Oni'),10,0,0,10000,0,10,repeat('f',64))`, fmt.Sprintf("score%d", i), id)
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, course := range []string{"Tower", "Dan"} {
		if _, err = pool.Exec(ctx, `INSERT INTO chart_difficulties(chart_id,course,side,level) VALUES($1,$2,'single',5)`, ids[0], course); err == nil {
			t.Fatal("database accepted unsupported course", course)
		}
	}
	cookie := strings.Repeat("c", 64)
	token := strings.Repeat("d", 64)
	if _, err = pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,'89b6ef3a5cb57b6e04f74711d15a8a5f','csrf',now()+interval '1 day'),($2,'89b6ef3a5cb57b6e04f74711d15a8a5f','csrf',now()+interval '1 day')`, hash(cookie), hash("game:"+token)); err != nil {
		t.Fatal(err)
	}
	const origin = "http://127.0.0.1:5173"
	handler := testServer(t, pool, Config{Origin: origin}).Handler()
	call := func(method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", "csrf")
		if strings.HasPrefix(path, "/api/v1/game/") {
			r.Header.Set("Authorization", "Bearer "+token)
		} else {
			r.Header.Set("Origin", origin)
			r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s: expected %d, got %d %s", path, status, w.Code, w.Body.String())
		}
		return w
	}
	for _, path := range []string{"/api/v1/charts", "/api/v1/me/charts", "/api/v1/game/search?course=Oni"} {
		var list struct {
			Items []Chart
			Total int
		}
		w := call("GET", path, "", 200)
		if err = json.Unmarshal(w.Body.Bytes(), &list); err != nil || list.Total != 1 || len(list.Items) != 1 || list.Items[0].ID != ids[0] {
			t.Fatal("unsupported chart leaked in list", w.Body.String(), err)
		}
	}
	for _, course := range []string{"Tower", "Dan", "5", "6"} {
		call("GET", "/api/v1/game/search?course="+course, "", 400)
	}
	var withdrawn int64
	if err = pool.QueryRow(ctx, `SELECT test_slot($1,'Oni')`, ids[1]).Scan(&withdrawn); err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(`{"difficultyId":%d,"good":10,"ok":0,"bad":0,"score":10000,"drumroll":0,"max_combo":10}`, withdrawn)
	call("POST", "/api/v1/scores", body, 404)
	call("POST", "/api/v1/game/scores", body, 404)
	for i := 1; i < len(ids); i++ {
		path := "/api/v1/charts/" + ids[i]
		call("GET", path, "", 404)
		call("GET", path+"/leaderboard", "", 404)
		for _, kind := range []string{"tja", "audio", "download"} {
			call("GET", path+"/"+kind, "", 404)
		}
		call("PATCH", path, `{"title":"Rename"}`, 404)
	}
	var snapshot struct {
		Charts []Chart
		Scores []Score
	}
	w := call("GET", "/api/v1/game/bootstrap", "", 200)
	if err = json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil || len(snapshot.Charts) != 1 || snapshot.Charts[0].ID != ids[0] || len(snapshot.Scores) != 1 || snapshot.Scores[0].SongID != ids[0] {
		t.Fatal("withdrawn game data leaked", w.Body.String(), err)
	}
	// Fixtures already have the default Variety bit, including archived charts.
	w = call("GET", "/api/v1/game/categories/variety/charts", "", 200)
	if err = json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil || len(snapshot.Charts) != 1 || snapshot.Charts[0].ID != ids[0] {
		t.Fatal("unsupported chart leaked through category", w.Body.String(), err)
	}

}

func TestUploadRejectsUnsupportedCourses(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	cookie := strings.Repeat("a", 64)
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES('89b6ef3a5cb57b6e04f74711d15a8a5f','tester','unused');`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,'89b6ef3a5cb57b6e04f74711d15a8a5f','csrf',now()+interval '1 day')`, hash(cookie)); err != nil {
		t.Fatal(err)
	}
	storage := t.TempDir()
	handler := testServer(t, pool, Config{Origin: "http://127.0.0.1:5173", Storage: storage}).Handler()
	for _, course := range []string{"Tower", "Dan", "5", "6", "tOwEr", "dAn"} {
		t.Run(course, func(t *testing.T) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			chart, _ := form.CreateFormFile("tja", "chart.tja")
			fmt.Fprintf(chart, "TITLE:Mixed\nBPM:120\nWAVE:music.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\nCOURSE:%s\nLEVEL:5\n#START\n1000,\n#END\n", course)
			audio, _ := form.CreateFormFile("audio", "music.ogg")
			audio.Write([]byte("OggS fixture"))
			form.Close()
			r := httptest.NewRequest("POST", "/api/v1/charts", &body)
			r.Header.Set("Origin", "http://127.0.0.1:5173")
			r.Header.Set("Content-Type", form.FormDataContentType())
			r.Header.Set("X-CSRF-Token", "csrf")
			r.Header.Set("Idempotency-Key", "unsupported-course-"+course)
			r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, r)
			if w.Code != 422 || !strings.Contains(w.Body.String(), "TJA_COURSE_UNSUPPORTED") {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM charts`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("unsupported upload persisted")
	}
}
