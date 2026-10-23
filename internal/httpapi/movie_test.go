package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"ourtaiko.dev/fanmade/api/internal/teststore"
)

func TestBackgroundMovie(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " required")
		}
	}
	for _, remote := range []bool{false, true} {
		t.Run(fmt.Sprint("s3=", remote), func(t *testing.T) { testBackgroundMovie(t, remote) })
	}
}
func testBackgroundMovie(t *testing.T, remote bool) {
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
	cfg := Config{Origin: "http://localhost", Storage: t.TempDir()}
	if remote {
		cfg.Objects = teststore.New(t)
	}
	app := testServer(t, pool, cfg)
	handler := app.Handler()
	audio, err := os.ReadFile("../audio/testdata/vorbis.ogg")
	if err != nil {
		t.Fatal(err)
	}
	// Larger than the output limits and with a sound track of its own.
	source := filepath.Join(t.TempDir(), "clip.mp4")
	if out, err := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=2400x1350:rate=120:duration=0.5", "-f", "lavfi", "-i", "sine=duration=0.5",
		"-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", source).CombinedOutput(); err != nil {
		t.Fatal(string(out))
	}
	clip, err := os.ReadFile(source)
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
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	decode := func(w *httptest.ResponseRecorder, code int) Chart {
		t.Helper()
		var c Chart
		if w.Code != code || json.Unmarshal(w.Body.Bytes(), &c) != nil {
			t.Fatalf("want %d got %d: %s", code, w.Code, w.Body.String())
		}
		return c
	}
	rejected := func(w *httptest.ResponseRecorder, status int, code string) {
		t.Helper()
		if w.Code != status || !strings.Contains(w.Body.String(), code) {
			t.Fatalf("want %d %s, got %d: %s", status, code, w.Code, w.Body.String())
		}
	}
	read := func(key string) ([]byte, error) {
		f, err := app.Config.Objects.Open(ctx, key)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(f)
	}
	tja := func(title, headers string) part {
		return part{"tja", "chart.tja", []byte("TITLE:" + title + "\nBPM:120\nWAVE:vorbis.ogg\n" + headers + "COURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n")}
	}
	sound, movie := part{"audio", "vorbis.ogg", audio}, part{"movie", "clip.mp4", clip}
	withMovie := "BGMOVIE:clip.mp4\nMOVIEOFFSET:-0.5\n"

	rejected(send("POST", "/api/v1/charts", ID(), tja("A", withMovie), sound), 422, "TJA_MOVIE_MISSING")
	rejected(send("POST", "/api/v1/charts", ID(), tja("A", withMovie), sound, part{"movie", "other.mp4", clip}), 422, "TJA_MOVIE_MISMATCH")
	rejected(send("POST", "/api/v1/charts", ID(), tja("A", ""), sound, movie), 400, "UPLOAD_FILES_INVALID")
	rejected(send("POST", "/api/v1/charts", ID(), tja("A", "BGMOVIE:clip.avi\n"), sound, part{"movie", "clip.avi", clip}), 400, "UPLOAD_FILES_INVALID")
	app.cleanupReplacedFiles()
	var n int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM charts)+(SELECT count(*) FROM chart_resources)+(SELECT count(*) FROM retired_files)`).Scan(&n); err != nil || n != 0 {
		t.Fatal("rejected uploads left data", n, err)
	}

	// A movie that cannot be decoded is left out; the chart is still published
	// and its stored TJA no longer declares the movie.
	partial := decode(send("POST", "/api/v1/charts", ID(), tja("Partial", withMovie), sound, part{"movie", "clip.mp4", []byte("not a video")}), 201)
	if partial.MovieHash != "" || len(partial.FailedFiles) != 1 || partial.FailedFiles[0] != (fileFailure{"movie", "MOVIE_INVALID"}) {
		t.Fatalf("undecodable movie: %+v", partial)
	}
	var partialKey string
	if err = pool.QueryRow(ctx, `SELECT r.storage_key FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, partial.ID).Scan(&partialKey); err != nil {
		t.Fatal(err)
	}
	if data, err := read(partialKey); err != nil || !strings.Contains(string(data), "\nBGMOVIE:\nMOVIEOFFSET:-0.5\n") {
		t.Fatal("stored TJA still declares the rejected movie", err)
	}
	remove := func(id string) int {
		r := httptest.NewRequest("DELETE", "/api/v1/charts/"+id, strings.NewReader("{}"))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("X-CSRF-Token", "csrf")
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Code
	}
	if code := remove(partial.ID); code != 200 {
		t.Fatal("delete", code)
	}
	app.cleanupReplacedFiles()

	key := ID()
	chart := decode(send("POST", "/api/v1/charts", key, tja("A", withMovie), sound, movie), 201)
	if len(chart.MovieHash) != 64 || chart.MovieSize <= 0 || chart.MovieOffset != -0.5 || chart.MovieHash == hash(string(clip)) {
		t.Fatalf("movie not recorded: %+v", chart)
	}
	if retry := decode(send("POST", "/api/v1/charts", key, tja("A", withMovie), sound, movie), 200); retry.ID != chart.ID || retry.MovieHash != chart.MovieHash {
		t.Fatal("retry did not return the stored chart")
	}
	stored, err := read(chart.MovieHash + ".mp4")
	if err != nil || hash(string(stored)) != chart.MovieHash || int64(len(stored)) != chart.MovieSize {
		t.Fatal("stored movie", err)
	}
	// The stored movie is the silent, bounded re-encoding, not the upload.
	file := filepath.Join(t.TempDir(), "stored.mp4")
	if err = os.WriteFile(file, stored, 0600); err != nil {
		t.Fatal(err)
	}
	probe, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "csv=p=0", file).Output()
	if err != nil || strings.TrimSpace(string(probe)) != "h264,video,1280,720,60/1" {
		t.Fatalf("stored movie format %q %v", probe, err)
	}
	// The API no longer tells the stored TJA's hash; its storage key comes from the database.
	tjaKey := func(id string) string {
		var key string
		if err := pool.QueryRow(ctx, `SELECT r.storage_key FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, id).Scan(&key); err != nil {
			t.Fatal(err)
		}
		return key
	}
	text := get("/api/v1/charts/" + chart.ID + "/tja")
	if remote {
		data, err := read(tjaKey(chart.ID))
		if err != nil {
			t.Fatal(err)
		}
		text.Body = bytes.NewBuffer(data)
	}
	if !strings.Contains(text.Body.String(), "\nBGMOVIE:"+chart.MovieHash+".mp4\nMOVIEOFFSET:-0.5\n") || !strings.Contains(text.Body.String(), "\nWAVE:"+chart.AudioHash+".ogg\n") {
		t.Fatal("stored TJA does not name the stored movie", text.Body.String())
	}
	// The movie alone: redirected to the object host, or served from local storage.
	if w := get("/api/v1/charts/" + chart.ID + "/movie"); !remote && (w.Code != 200 || w.Header().Get("Content-Type") != "video/mp4" || !bytes.Equal(w.Body.Bytes(), stored)) {
		t.Fatal("movie route", w.Code)
	}
	archive := get("/api/v1/charts/" + chart.ID + "/download")
	z, err := zip.NewReader(bytes.NewReader(archive.Body.Bytes()), int64(archive.Body.Len()))
	if err != nil || len(z.File) != 3 || z.File[2].Name != chart.MovieHash+".mp4" || z.File[2].UncompressedSize64 != uint64(chart.MovieSize) {
		t.Fatal("ZIP lacks the movie", err)
	}
	if remote {
		var manifest struct {
			Resources map[string]struct {
				SHA         string `json:"sha256"`
				Size        int64  `json:"size"`
				ContentType string `json:"contentType"`
			}
		}
		w := get("/api/v1/charts/" + chart.ID + "/resources")
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &manifest) != nil {
			t.Fatal(w.Code, w.Body.String())
		}
		if m := manifest.Resources["movie"]; m.SHA != chart.MovieHash || m.Size != chart.MovieSize || m.ContentType != "video/mp4" {
			t.Fatalf("manifest movie %+v", m)
		}
	}

	// A replacement that still declares BGMOVIE keeps the stored movie without a new upload.
	files := "/api/v1/charts/" + chart.ID + "/files"
	confirm := part{"confirmReset", "", []byte("true")}
	originalKey := tjaKey(chart.ID)
	kept := decode(send("PUT", files, ID(), tja("B", "BGMOVIE:renamed.webm\nMOVIEOFFSET:1.25\n"), confirm), 200)
	if kept.MovieHash != chart.MovieHash || kept.MovieOffset != 1.25 || kept.Title != "B" || tjaKey(kept.ID) == originalKey {
		t.Fatalf("movie not kept: %+v", kept)
	}
	if data, err := read(tjaKey(kept.ID)); err != nil || !strings.Contains(string(data), "\nBGMOVIE:"+chart.MovieHash+".mp4\n") {
		t.Fatal("replacement TJA does not name the kept movie", err)
	}
	// Dropping BGMOVIE removes the movie; the offset falls back to zero.
	plain := decode(send("PUT", files, ID(), tja("C", ""), confirm), 200)
	if plain.MovieHash != "" || plain.MovieSize != 0 || plain.MovieOffset != 0 {
		t.Fatalf("movie not removed: %+v", plain)
	}
	app.cleanupReplacedFiles()
	if _, err = read(chart.MovieHash + ".mp4"); !os.IsNotExist(err) {
		t.Fatal("removed movie still stored", err)
	}
	// Adding it back and deleting the chart removes it again.
	again := decode(send("PUT", files, ID(), tja("D", withMovie), confirm, movie), 200)
	if len(again.MovieHash) != 64 {
		t.Fatal("movie not added by replacement")
	}
	code := remove(chart.ID)
	app.cleanupReplacedFiles()
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM charts)+(SELECT count(*) FROM chart_resources)+(SELECT count(*) FROM retired_files)`).Scan(&n); code != 200 || err != nil || n != 0 {
		t.Fatal("delete left data", code, n, err)
	}
	if _, err = read(again.MovieHash + ".mp4"); !os.IsNotExist(err) {
		t.Fatal("deleted chart's movie still stored", err)
	}
}
