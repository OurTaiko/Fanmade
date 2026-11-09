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
	"time"
)

// Co-creators chosen with a new upload are invited when the chart is
// published, also when the uploader did not wait for it.
func TestUploadInvitesCollaborators(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const owner = "89b6ef3a5cb57b6e04f74711d15a8a5f"
	const alice = "9b893bc6d9422c93536ff0df503b81e9"
	const bob = "5f0c4a0b0e7b4d3c9a6f1e2d3c4b5a69"
	cookies := map[string]string{owner: strings.Repeat("a", 64), alice: strings.Repeat("b", 64)}
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,'tester','unused'),($2,'alice','unused'),($3,'bob','unused')`, owner, alice, bob); err != nil {
		t.Fatal(err)
	}
	for user, cookie := range cookies {
		if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'csrf',now()+interval '1 day')`, hash(cookie), user); err != nil {
			t.Fatal(err)
		}
	}
	app := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir()})
	audio, err := os.ReadFile("../../kit/audio/testdata/vorbis.ogg")
	if err != nil {
		t.Fatal(err)
	}
	request := func(user, method, path, contentType string, body *bytes.Buffer, headers map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, body)
		r.Header.Set("Content-Type", contentType)
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("X-CSRF-Token", "csrf")
		for name, value := range headers {
			r.Header.Set(name, value)
		}
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookies[user]})
		w := httptest.NewRecorder()
		app.Handler().ServeHTTP(w, r)
		return w
	}
	// Uploads title with its audio and the given collaboratorIds field, left out when empty.
	upload := func(method, path, key, title, collaborators string, async bool, extra ...string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		out, _ := form.CreateFormFile("tja", "chart.tja")
		_, _ = out.Write([]byte("TITLE:" + title + "\nBPM:120\nWAVE:vorbis.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1000,\n#END\n"))
		if method == "POST" {
			out, _ = form.CreateFormFile("audio", "vorbis.ogg")
			_, _ = out.Write(audio)
		}
		if collaborators != "" {
			_ = form.WriteField("collaboratorIds", collaborators)
		}
		for i := 0; i+1 < len(extra); i += 2 {
			_ = form.WriteField(extra[i], extra[i+1])
		}
		_ = form.Close()
		headers := map[string]string{"Idempotency-Key": key}
		if async {
			headers["Prefer"] = "respond-async"
		}
		return request(owner, method, path, form.FormDataContentType(), &body, headers)
	}
	ids := func(users ...string) string {
		raw, _ := json.Marshal(users)
		return string(raw)
	}
	count := func(sql string, args ...any) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return
	}

	// A selection that cannot be invited rejects the upload at once; nothing is queued.
	for _, c := range []struct {
		field string
		want  int
		code  string
	}{
		{`"` + alice + `"`, 400, "USER_INVALID"},
		{ids("invalid"), 400, "USER_INVALID"},
		{ids(alice, owner), 409, "ALREADY_OWNER"},
		{ids(alice, strings.Repeat("f", 32)), 404, "USER_NOT_FOUND"},
	} {
		if w := upload("POST", "/api/v1/charts", ID(), "Rejected", c.field, true); w.Code != c.want || !strings.Contains(w.Body.String(), c.code) {
			t.Fatal(c.field, w.Code, w.Body.String())
		}
	}
	if count(`SELECT (SELECT count(*) FROM charts)+(SELECT count(*) FROM upload_requests)+(SELECT count(*) FROM chart_collaborations)`) != 0 {
		t.Fatal("rejected selection stored data")
	}

	// The web uploader does not wait: both are invited once the chart is published.
	key := ID()
	if w := upload("POST", "/api/v1/charts", key, "Together", ids(alice, bob, alice), true); w.Code != 202 {
		t.Fatal(w.Code, w.Body.String())
	}
	var chartID string
	for deadline := time.Now().Add(20 * time.Second); chartID == "" && time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		_ = pool.QueryRow(ctx, `SELECT chart_id FROM notifications WHERE recipient_id=$1 AND kind='upload_result' AND dedupe_key=$2`, owner, "upload:"+key).Scan(&chartID)
	}
	if chartID == "" {
		t.Fatal("upload was not published")
	}
	if n := count(`SELECT count(*) FROM chart_collaborations c JOIN notifications n ON n.collaboration_id=c.id AND n.recipient_id=c.recipient_id AND n.actor_id=$2 AND n.chart_id=c.chart_id AND n.kind='chart_collaboration' AND n.read_at IS NULL
 WHERE c.chart_id=$1 AND c.inviter_id=$2 AND c.status='pending' AND c.recipient_id IN ($3,$4)`, chartID, owner, alice, bob); n != 2 {
		t.Fatal("invitations with notices", n)
	}
	// An invitation still grants nothing by itself.
	if published, err := app.chart(ctx, chartID); err != nil || len(published.OwnerIDs) != 1 || published.OwnerIDs[0] != owner {
		t.Fatalf("%+v %v", published.OwnerIDs, err)
	}
	// Sending the finished request again returns the chart and invites nobody twice;
	// another selection under the same key is a different request.
	if w := upload("POST", "/api/v1/charts", key, "Together", ids(bob, alice), true); w.Code != 200 || !strings.Contains(w.Body.String(), chartID) {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := upload("POST", "/api/v1/charts", key, "Together", ids(alice), true); w.Code != 409 || !strings.Contains(w.Body.String(), "IDEMPOTENCY_CONFLICT") {
		t.Fatal(w.Code, w.Body.String())
	}
	if count(`SELECT count(*) FROM chart_collaborations`) != 2 || count(`SELECT count(*) FROM charts`) != 1 {
		t.Fatal("retry repeated the upload")
	}
	// The recipient answers from the notice exactly as for an invitation sent from the chart page.
	var notice string
	if err = pool.QueryRow(ctx, `SELECT id FROM notifications WHERE recipient_id=$1 AND kind='chart_collaboration'`, alice).Scan(&notice); err != nil {
		t.Fatal(err)
	}
	if w := request(alice, "POST", "/api/v1/me/notifications/"+notice+"/respond", "application/json", bytes.NewBufferString(`{"accept":true}`), nil); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if published, err := app.chart(ctx, chartID); err != nil || len(published.OwnerIDs) != 2 || !published.hasOwner(alice) {
		t.Fatalf("%+v %v", published.OwnerIDs, err)
	}

	// A replacement invites nobody: its chart already has the co-creator dialog.
	if w := upload("PUT", "/api/v1/charts/"+chartID+"/files", ID(), "Replaced", ids(bob), false, "confirmReset", "true"); w.Code != 400 || !strings.Contains(w.Body.String(), "UPLOAD_FILES_INVALID") {
		t.Fatal(w.Code, w.Body.String())
	}

	// Invitations sent with an upload count toward the day's limit like any other.
	if _, err = pool.Exec(ctx, `INSERT INTO chart_collaborations(id,chart_id,inviter_id,recipient_id,status,responded_at)
 SELECT md5(g::text),$1,$2,$3,'declined',now() FROM generate_series(1,$4::int) g`, chartID, owner, bob, invitationsPerDay-3); err != nil {
		t.Fatal(err)
	}
	if w := upload("POST", "/api/v1/charts", ID(), "Too many", ids(alice, bob), false); w.Code != 429 || !strings.Contains(w.Body.String(), "RATE_LIMITED") {
		t.Fatal(w.Code, w.Body.String())
	}
	// An uploader who waits gets the chart; the last invitation of the day went out with it.
	w := upload("POST", "/api/v1/charts", ID(), "Last one", ids(bob), false)
	var last Chart
	if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &last) != nil || last.ID == "" {
		t.Fatal(w.Code, w.Body.String())
	}
	if n := count(`SELECT count(*) FROM chart_collaborations WHERE chart_id=$1 AND recipient_id=$2 AND status='pending'`, last.ID, bob); n != 1 {
		t.Fatal("invitation of a waited upload", n)
	}
	if w := request(owner, "POST", "/api/v1/charts/"+last.ID+"/collaborations", "application/json", bytes.NewBufferString(fmt.Sprintf(`{"userId":%q}`, alice)), nil); w.Code != 429 {
		t.Fatal(w.Code, w.Body.String())
	}
	// An upload without the field publishes as before.
	if w := upload("POST", "/api/v1/charts", ID(), "Alone", "", false); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := upload("POST", "/api/v1/charts", ID(), "Nobody", "[]", false); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if count(`SELECT count(*) FROM charts`) != 4 || count(`SELECT count(*) FROM chart_collaborations WHERE status='pending'`) != 2 {
		t.Fatal("unexpected charts or invitations")
	}
}
