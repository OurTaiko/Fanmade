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

	"ourtaiko.dev/sitekit/constants"
)

// Difficulty constants from upload to rating: every route stored on upload, rated by the first
// calibration, not recalibrated by the same data, and refilled by the startup backfill.
func TestDifficultyConstants(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const cookie = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES('89b6ef3a5cb57b6e04f74711d15a8a5f','tester','unused')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,'89b6ef3a5cb57b6e04f74711d15a8a5f','csrf',now()+interval '1 day')`, hash(cookie)); err != nil {
		t.Fatal(err)
	}
	app := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir()})
	audio, err := os.ReadFile("../../kit/audio/testdata/cbr.mp3")
	if err != nil {
		t.Fatal(err)
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	tf, _ := form.CreateFormFile("tja", "chart.tja")
	tf.Write([]byte("TITLE:Backfill\nBPM:120\nWAVE:cbr.mp3\nCOURSE:Hard\nLEVEL:5\n#START\n1020,\n1122,\n#END\n" +
		"COURSE:Oni\nLEVEL:8\n#START\n1000,\n#BRANCHSTART p,80,95\n#N\n1000,\n#E\n2020,\n#M\n3434,\n#BRANCHEND\n1,\n#END\n"))
	af, _ := form.CreateFormFile("audio", "cbr.mp3")
	af.Write(audio)
	form.WriteField("encoding", "utf-8")
	form.Close()
	r := httptest.NewRequest("POST", "/api/v1/charts", &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	r.Header.Set("Origin", "http://localhost")
	r.Header.Set("X-CSRF-Token", "csrf")
	r.Header.Set("Idempotency-Key", ID())
	r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
	w := httptest.NewRecorder()
	app.Handler().ServeHTTP(w, r)
	var chart Chart
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &chart) != nil {
		t.Fatal(w.Code, w.Body.String())
	}

	// Every route of each block, under its content hash, with the eight rating columns last.
	stored := func() map[string][]any {
		t.Helper()
		rows, err := pool.Query(ctx, `SELECT d.course||'/'||k.route,k.constants_version,k.note_count,k.raw_stamina,k.raw_handspeed,k.raw_burst,k.raw_complex,
 k.raw_complex_ratio,k.raw_rhythm,k.raw_rhythm_ratio,k.calibration_version,k.`+strings.ReplaceAll(`sub_constant_1,main_constant,sub_constant_2,stamina,handspeed,burst,complex,rhythm`, ",", ",k.")+`
 FROM chart_difficulties d JOIN difficulty_constants k ON k.content_hash=d.content_hash WHERE d.chart_id=$1`, chart.ID)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		result := map[string][]any{}
		for rows.Next() {
			values, err := rows.Values()
			if err != nil {
				t.Fatal(err)
			}
			result[values[0].(string)] = values[1:]
		}
		return result
	}
	same := func(a, b map[string][]any) bool {
		if len(a) != len(b) {
			return false
		}
		for key, values := range a {
			for i, v := range values {
				if b[key] == nil || b[key][i] != v {
					return false
				}
			}
		}
		return true
	}
	// Uploaded before any calibration: raw values for every route (Oni: 1 common note and 1
	// after the branch, with 1, 2 or 4 on the routes), no rating yet.
	uploaded := stored()
	notes := map[string]int32{"Hard/unbranched": 6, "Oni/normal": 3, "Oni/expert": 4, "Oni/master": 6}
	for key, n := range notes {
		if v := uploaded[key]; v == nil || v[0] != int16(constants.Version) || v[1] != n || v[9] != nil {
			t.Fatalf("upload stored %s: %v", key, v)
		}
	}
	if len(uploaded) != len(notes) {
		t.Fatalf("upload stored %v", uploaded)
	}

	// The first calibration rates every row by rating.py.
	result, err := constants.Recalibrate(ctx, pool)
	if err != nil || !result.New || result.Calibration.Version != 1 || result.Rated != 4 || result.Calibration.Routes != 4 {
		t.Fatalf("first calibration: %+v %v", result, err)
	}
	rated := stored()
	for key, v := range rated {
		raw := constants.Raw{NoteCount: int(v[1].(int32)), Stamina: v[2].(float64), Handspeed: v[3].(float64), Burst: v[4].(float64),
			Complex: v[5].(float64), ComplexRatio: v[6].(float64), Rhythm: v[7].(float64), RhythmRatio: v[8].(float64)}
		if want := constants.Rate(raw, result.Calibration.Params); v[9] != int32(1) || v[11] != want.MainConstant || v[17] != want.Rhythm {
			t.Fatalf("%s rated %v, want %+v", key, v, want)
		}
	}
	// The chart page gets them: every rated route of each block, in route order.
	w = httptest.NewRecorder()
	app.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/charts/"+chart.ID+"?by=id", nil))
	var detail Chart
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &detail) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, d := range detail.Difficulties {
		var routes []string
		for _, c := range d.Constants {
			routes = append(routes, c.Route)
		}
		want := map[string]string{"Hard": "unbranched", "Oni": "normal expert master"}[d.Course]
		if strings.Join(routes, " ") != want || d.Constants[len(d.Constants)-1].MainConstant != rated[d.Course+"/"+routes[len(routes)-1]][11] {
			t.Fatalf("%s: constants %+v", d.Course, d.Constants)
		}
	}
	// Lists go without them.
	w = httptest.NewRecorder()
	app.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/charts", nil))
	if w.Code != 200 || strings.Contains(w.Body.String(), `"constants"`) {
		t.Fatalf("the list carries constants: %d", w.Code)
	}

	// The same data calibrate the same: nothing recorded, nothing rated.
	if again, err := constants.Recalibrate(ctx, pool); err != nil || again.New || again.Rated != 0 || again.Calibration.Version != 1 {
		t.Fatalf("second calibration: %+v %v", again, err)
	}

	// A block stored without its constants (as before migration 048) gets them back from the
	// stored file, rated by the latest calibration; the hashes stay.
	if _, err = pool.Exec(ctx, `DELETE FROM difficulty_constants`); err != nil {
		t.Fatal(err)
	}
	if err = app.backfillContentHashes(ctx, "v1:", constants.Version); err != nil {
		t.Fatal(err)
	}
	if backfilled := stored(); !same(backfilled, rated) {
		t.Fatalf("backfill gave %v, want %v", backfilled, rated)
	}
}
