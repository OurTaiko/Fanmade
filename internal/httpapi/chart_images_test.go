package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ourtaiko.dev/fanmade/api/internal/teststore"
	"ourtaiko.dev/sitekit/tja"
)

// The uploaded cover is the image PREIMAGE names and the background image the one BGIMAGE
// names; the stored TJA names the chart's stored images, as its package holds them.
func TestChartImagesFollowTheirHeaders(t *testing.T) {
	if !tja.Available() {
		t.Skip("tjaparser not found: set TJAPARSER_BIN or put it on PATH")
	}
	pool := scoreTestDB(t)
	ctx := context.Background()
	const owner = "5d0f1c3a9b2e4f6a8c7d0e1f2a3b4c5d"
	cookie := strings.Repeat("c", 64)
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,'tester','unused')`, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'csrf',now()+interval '1 day')`, hash(cookie), owner); err != nil {
		t.Fatal(err)
	}
	// Remote storage, as in production: the resource list needs public links.
	app := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir(), Objects: teststore.New(t)})
	handler := app.Handler()
	audio, err := os.ReadFile("../../kit/audio/testdata/vorbis.ogg")
	if err != nil {
		t.Fatal(err)
	}
	picture := func(c color.NRGBA) []byte {
		img := image.NewNRGBA(image.Rect(0, 0, 40, 30))
		for y := 0; y < 30; y++ {
			for x := 0; x < 40; x++ {
				img.SetNRGBA(x, y, c)
			}
		}
		var b bytes.Buffer
		_ = png.Encode(&b, img)
		return b.Bytes()
	}
	red, blue := picture(color.NRGBA{R: 255, A: 255}), picture(color.NRGBA{B: 255, A: 255})
	type part struct {
		field, name string
		data        []byte
	}
	send := func(method, path string, parts ...part) *httptest.ResponseRecorder {
		t.Helper()
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
		r.Header.Set("Idempotency-Key", ID())
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	upload := func(want int, parts ...part) Chart {
		t.Helper()
		w := send("POST", "/api/v1/charts", parts...)
		if w.Code != want {
			t.Fatalf("status %d want %d: %s", w.Code, want, w.Body.String())
		}
		var c Chart
		_ = json.Unmarshal(w.Body.Bytes(), &c)
		return c
	}
	chart := func(title, headers string) part {
		return part{"tja", "chart.tja", []byte("TITLE:" + title + "\nBPM:120\n" + headers + "WAVE:music.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n")}
	}
	sound := part{"audio", "music.ogg", audio}
	stored := func(id string) string {
		t.Helper()
		var key string
		if err := pool.QueryRow(ctx, `SELECT r.storage_key FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, id).Scan(&key); err != nil {
			t.Fatal(err)
		}
		f, err := app.Config.Objects.Open(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		data, _ := io.ReadAll(f)
		return string(data)
	}
	declares := func(id, want string) {
		t.Helper()
		if text := stored(id); !strings.Contains(text, want) {
			t.Fatalf("stored TJA of %s lacks %q:\n%s", id, want, text)
		}
	}

	// PREIMAGE may give a path; the cover is matched by its name and stored as WebP.
	named := upload(201, chart("A", "PREIMAGE:img\\jacket.png\n"), sound, part{"cover", "jacket.png", red})
	if named.CoverHash == "" {
		t.Fatal("cover not saved")
	}
	declares(named.ID, "\nPREIMAGE:"+named.CoverHash+".webp\n")

	w := send("POST", "/api/v1/charts", chart("B", "PREIMAGE:jacket.png\n"), sound, part{"cover", "other.png", red})
	if w.Code != 422 || !strings.Contains(w.Body.String(), `"TJA_PREIMAGE_MISMATCH"`) {
		t.Fatalf("mismatched cover: %d %s", w.Code, w.Body.String())
	}

	// A cover the TJA does not declare is added after WAVE.
	added := upload(201, chart("C", ""), sound, part{"cover", "art.png", blue})
	declares(added.ID, "\nWAVE:"+added.AudioHash+".ogg\nPREIMAGE:"+added.CoverHash+".webp\n")

	// Without a cover the declared image is cleared rather than left pointing at nothing.
	bare := upload(201, chart("D", "PREIMAGE:jacket.png\n"), sound)
	if bare.CoverHash != "" {
		t.Fatal("unexpected cover")
	}
	declares(bare.ID, "\nPREIMAGE:\n")
	plain := upload(201, chart("E", ""), sound)
	if strings.Contains(stored(plain.ID), "PREIMAGE") {
		t.Fatal("a chart without a cover gained PREIMAGE")
	}

	// Changing the cover alone rewrites PREIMAGE, adding it when missing.
	for _, id := range []string{bare.ID, plain.ID} {
		w = send("PUT", "/api/v1/charts/"+id+"/cover", part{"cover", "new.png", blue})
		if w.Code != 200 {
			t.Fatalf("cover change: %d %s", w.Code, w.Body.String())
		}
		var changed struct{ CoverHash string }
		_ = json.Unmarshal(w.Body.Bytes(), &changed)
		declares(id, "PREIMAGE:"+changed.CoverHash+".webp\n")
	}

	// A file replacement without a cover keeps the chart's cover, which PREIMAGE then names.
	w = send("PUT", "/api/v1/charts/"+named.ID+"/files", chart("A2", "PREIMAGE:renamed.jpg\n"), part{"confirmReset", "", []byte("true")})
	if w.Code != 200 {
		t.Fatalf("replacement: %d %s", w.Code, w.Body.String())
	}
	declares(named.ID, "\nPREIMAGE:"+named.CoverHash+".webp\n")
	// ... and one with a cover must name it as PREIMAGE does.
	w = send("PUT", "/api/v1/charts/"+named.ID+"/files", chart("A3", "PREIMAGE:renamed.jpg\n"), part{"confirmReset", "", []byte("true")}, part{"cover", "jacket.png", blue})
	if w.Code != 422 || !strings.Contains(w.Body.String(), `"TJA_PREIMAGE_MISMATCH"`) {
		t.Fatalf("mismatched replacement cover: %d %s", w.Code, w.Body.String())
	}

	// BGIMAGE works as BGMOVIE: its file must be the declared one, stored as WebP.
	w = send("POST", "/api/v1/charts", chart("F", ""), sound, part{"bgimage", "bg.png", red})
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"UPLOAD_FILES_INVALID"`) {
		t.Fatalf("undeclared background: %d %s", w.Code, w.Body.String())
	}
	w = send("POST", "/api/v1/charts", chart("F", "BGIMAGE:bg.png\n"), sound, part{"bgimage", "other.png", red})
	if w.Code != 422 || !strings.Contains(w.Body.String(), `"TJA_BGIMAGE_MISMATCH"`) {
		t.Fatalf("mismatched background: %d %s", w.Code, w.Body.String())
	}
	backdrop := upload(201, chart("F", "BGIMAGE:img/BG.png\n"), sound, part{"bgimage", "BG.png", red}, part{"cover", "art.png", blue})
	if backdrop.BackgroundHash == "" || backdrop.BackgroundHash == backdrop.CoverHash {
		t.Fatalf("background not saved apart from the cover: %+v", backdrop.BackgroundHash)
	}
	declares(backdrop.ID, "\nBGIMAGE:"+backdrop.BackgroundHash+".webp\n")
	get := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	// With public links the route redirects to the stored object.
	if w = get("/api/v1/charts/" + backdrop.ID + "/bgimage"); (w.Code != 200 && w.Code != 302) || (w.Code == 302 && !strings.Contains(w.Header().Get("Location"), backdrop.BackgroundHash+".webp")) {
		t.Fatalf("background route: %d %s", w.Code, w.Header().Get("Location"))
	}
	if w = get("/api/v1/charts/" + backdrop.ID + "/resources"); !strings.Contains(w.Body.String(), `"bgimage"`) {
		t.Fatalf("resources lack the background: %s", w.Body.String())
	}
	// Declared without a file: published without one.
	missing := upload(201, chart("G", "BGIMAGE:bg.png\n"), sound)
	if missing.BackgroundHash != "" {
		t.Fatal("unexpected background")
	}
	declares(missing.ID, "\nBGIMAGE:\n")
	// BGMOVIE likewise: declared without a file, the chart is published without a movie.
	unfilmed := upload(201, chart("H", "BGMOVIE:clip.mp4\nMOVIEOFFSET:1.5\n"), sound)
	if unfilmed.MovieHash != "" {
		t.Fatal("unexpected movie")
	}
	declares(unfilmed.ID, "\nBGMOVIE:\n")
	// A replacement still declaring BGIMAGE keeps the stored image; one without drops it.
	w = send("PUT", "/api/v1/charts/"+backdrop.ID+"/files", chart("F2", "BGIMAGE:elsewhere.jpg\n"), part{"confirmReset", "", []byte("true")})
	if w.Code != 200 {
		t.Fatalf("replacement keeping the background: %d %s", w.Code, w.Body.String())
	}
	declares(backdrop.ID, "\nBGIMAGE:"+backdrop.BackgroundHash+".webp\n")
	w = send("PUT", "/api/v1/charts/"+backdrop.ID+"/files", chart("F3", ""), part{"confirmReset", "", []byte("true")})
	var dropped Chart
	_ = json.Unmarshal(w.Body.Bytes(), &dropped)
	if w.Code != 200 || dropped.BackgroundHash != "" || strings.Contains(stored(backdrop.ID), "BGIMAGE") {
		t.Fatalf("replacement dropping the background: %d %s", w.Code, w.Body.String())
	}
	if w = get("/api/v1/charts/" + backdrop.ID + "/bgimage"); w.Code != 404 {
		t.Fatalf("dropped background still served: %d", w.Code)
	}
}
