package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"ourtaiko.dev/fanmade/api/internal/constants"
)

// The startup backfill fills the raw difficulty constants of blocks stored without them
// (before migration 047) from the stored file, and leaves the content hashes alone.
func TestBackfillFillsDifficultyConstants(t *testing.T) {
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
	audio, err := os.ReadFile("../audio/testdata/cbr.mp3")
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

	stored := func() map[string][]any {
		rows, err := pool.Query(ctx, `SELECT course,content_hash,`+constantsColumnNames+` FROM chart_difficulties WHERE chart_id=$1`, chart.ID)
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
	uploaded := stored()
	// Oni stores its master route: 1 common note, 4 on the route, 1 after.
	if len(uploaded) != 2 || uploaded["Hard"][9] != int32(6) || uploaded["Oni"][9] != int32(6) || uploaded["Oni"][1] != int16(constants.Version) {
		t.Fatalf("upload stored %v", uploaded)
	}
	if _, err = pool.Exec(ctx, `UPDATE chart_difficulties SET (`+constantsColumnNames+`)=(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL) WHERE chart_id=$1`, chart.ID); err != nil {
		t.Fatal(err)
	}
	if err = app.backfillContentHashes(ctx, "v1:", constants.Version); err != nil {
		t.Fatal(err)
	}
	backfilled := stored()
	for course, values := range uploaded {
		for i, v := range values {
			if backfilled[course][i] != v {
				t.Fatalf("%s column %d: backfill gave %v, upload %v", course, i, backfilled[course][i], v)
			}
		}
	}
}
