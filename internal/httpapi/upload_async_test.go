package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

// An uploader who does not wait gets 202 and learns the outcome from a notice.
func TestAsyncUploadReportsByNotification(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const owner = "89b6ef3a5cb57b6e04f74711d15a8a5f"
	cookie := strings.Repeat("a", 64)
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,'tester','unused')`, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'csrf',now()+interval '1 day')`, hash(cookie), owner); err != nil {
		t.Fatal(err)
	}
	app := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir()})
	audio, err := os.ReadFile("../audio/testdata/vorbis.ogg")
	if err != nil {
		t.Fatal(err)
	}
	type part struct {
		field, name string
		data        []byte
	}
	send := func(method, path, key string, parts ...part) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		for _, p := range parts {
			if p.name == "" {
				_ = form.WriteField(p.field, string(p.data))
				continue
			}
			out, _ := form.CreateFormFile(p.field, p.name)
			_, _ = out.Write(p.data)
		}
		_ = form.Close()
		r := httptest.NewRequest(method, path, &body)
		r.Header.Set("Content-Type", form.FormDataContentType())
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("X-CSRF-Token", "csrf")
		r.Header.Set("Idempotency-Key", key)
		r.Header.Set("Prefer", "respond-async")
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		return w
	}
	type notice struct {
		Chart *string
		Data  struct {
			Status, Title, Code string
			FailedFiles         []fileFailure
		}
	}
	// Waits for the notice of the upload sent with key.
	outcome := func(key string) notice {
		t.Helper()
		for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
			var n notice
			var raw []byte
			err := pool.QueryRow(ctx, `SELECT chart_id,data FROM notifications WHERE recipient_id=$1 AND kind='upload_result' AND dedupe_key=$2`, owner, "upload:"+key).Scan(&n.Chart, &raw)
			if err == nil {
				if json.Unmarshal(raw, &n.Data) != nil {
					t.Fatal(string(raw))
				}
				return n
			}
		}
		t.Fatal("no upload notice")
		return notice{}
	}
	count := func(sql string) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return
	}
	accepted := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if w.Code != 202 || !strings.Contains(w.Body.String(), `"processing"`) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	chart := func(title, headers string) part {
		return part{"tja", "chart.tja", []byte("TITLE:" + title + "\nBPM:120\nWAVE:vorbis.ogg\n" + headers + "COURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n")}
	}
	sound := part{"audio", "vorbis.ogg", audio}

	// Fast checks still answer at once, without a notice.
	if w := send("POST", "/api/v1/charts", ID(), part{"tja", "chart.tja", []byte("broken")}, sound); w.Code != 422 {
		t.Fatal(w.Code, w.Body.String())
	}
	// Audio that does not decode rejects the whole upload: nothing is stored.
	key := ID()
	accepted(send("POST", "/api/v1/charts", key, chart("Bad audio", ""), part{"audio", "vorbis.ogg", audio[:len(audio)-11]}))
	if n := outcome(key); n.Data.Status != "failed" || n.Data.Code != "AUDIO_INVALID" || n.Data.Title != "Bad audio" || n.Chart != nil {
		t.Fatalf("%+v", n)
	}
	if count(`SELECT (SELECT count(*) FROM charts)+(SELECT count(*) FROM chart_resources)+(SELECT count(*) FROM pending_objects)+(SELECT count(*) FROM upload_requests)`) != 0 {
		t.Fatal("rejected upload stored data")
	}
	entries, err := os.ReadDir(app.Config.Storage)
	if err != nil || len(entries) != 0 {
		t.Fatal("rejected upload left files", entries, err)
	}
	// The released receipt lets the same request be sent again.
	accepted(send("POST", "/api/v1/charts", key, chart("Bad audio", ""), part{"audio", "vorbis.ogg", audio[:len(audio)-11]}))

	// A bad cover and a bad movie are left out; the chart is published and both are named.
	key = ID()
	accepted(send("POST", "/api/v1/charts", key, chart("Partial", "BGMOVIE:clip.mp4\n"), sound,
		part{"cover", "cover.png", []byte("not an image")}, part{"movie", "clip.mp4", []byte("not a video")}))
	n := outcome(key)
	if n.Data.Status != "published" || n.Chart == nil || len(n.Data.FailedFiles) != 2 ||
		n.Data.FailedFiles[0] != (fileFailure{"cover", "COVER_INVALID"}) || n.Data.FailedFiles[1] != (fileFailure{"movie", "MOVIE_INVALID"}) {
		t.Fatalf("%+v", n)
	}
	published, err := app.chart(ctx, *n.Chart)
	if err != nil || published.Title != "Partial" || published.CoverHash != "" || published.MovieHash != "" {
		t.Fatalf("%+v %v", published, err)
	}
	// Sending the finished request again returns its chart instead of a second job.
	retry := send("POST", "/api/v1/charts", key, chart("Partial", "BGMOVIE:clip.mp4\n"), sound,
		part{"cover", "cover.png", []byte("not an image")}, part{"movie", "clip.mp4", []byte("not a video")})
	if retry.Code != 200 || !strings.Contains(retry.Body.String(), published.ID) || count(`SELECT count(*) FROM charts`) != 1 {
		t.Fatal(retry.Code, retry.Body.String())
	}

	// A replacement is reported the same way and links to the chart.
	key = ID()
	accepted(send("PUT", "/api/v1/charts/"+published.ID+"/files", key, chart("Replaced", ""), part{"confirmReset", "", []byte("true")}))
	if n = outcome(key); n.Data.Status != "updated" || n.Chart == nil || *n.Chart != published.ID || len(n.Data.FailedFiles) != 0 {
		t.Fatalf("%+v", n)
	}
	if current, err := app.chart(ctx, published.ID); err != nil || current.Title != "Replaced" {
		t.Fatal(current.Title, err)
	}

	// Uploads still being processed when the server stopped are reported at startup.
	if _, err = pool.Exec(ctx, `INSERT INTO upload_requests(user_id,idempotency_key,payload_digest,status,title) VALUES($1,'interrupted-upload-key',repeat('a',64),'processing','Lost')`, owner); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = app.FailInterruptedUploads(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if n = outcome("interrupted-upload-key"); n.Data.Status != "failed" || n.Data.Code != "UPLOAD_INTERRUPTED" || n.Data.Title != "Lost" {
		t.Fatalf("%+v", n)
	}
	if count(`SELECT count(*) FROM upload_requests WHERE status='processing'`) != 0 || count(`SELECT count(*) FROM notifications WHERE dedupe_key='upload:interrupted-upload-key'`) != 1 {
		t.Fatal("interrupted upload not settled once")
	}
	// The outcome cannot be muted and is not offered in the settings.
	r := httptest.NewRequest("GET", "/api/v1/me/notification-settings", nil)
	r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, r)
	if w.Code != 200 || strings.Contains(w.Body.String(), "upload_result") {
		t.Fatal(w.Code, w.Body.String())
	}
}
