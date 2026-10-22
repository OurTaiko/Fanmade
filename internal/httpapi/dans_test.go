package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestDanCourses(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const origin = "http://127.0.0.1:5173"
	const alice, boss, carol = "0000000000000000000000000000a11c", "0000000000000000000000000000b055", "0000000000000000000000000000ca01"
	const songA, songB = "11111111111111111111111111111111", "22222222222222222222222222222222"
	_, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash,nickname,is_admin) VALUES
 ('0000000000000000000000000000a11c','alice','unused','Alice',false),('0000000000000000000000000000b055','boss','unused','Boss',true),('0000000000000000000000000000ca01','carol','unused','Carol',false);
 INSERT INTO charts(id,owner_ids,title,subtitle,bpm,duration,tja_file,audio_file) VALUES
 ('11111111111111111111111111111111',ARRAY['0000000000000000000000000000a11c'],'Alpha','--a',120,10,test_file('tja-a','a.tja',repeat('a',64),1),test_file('ogg-a','a.ogg',repeat('b',64),1)),
 ('22222222222222222222222222222222',ARRAY['0000000000000000000000000000a11c'],'Beta','',120,10,test_file('tja-b','b.tja',repeat('c',64),1),test_file('ogg-b','b.ogg',repeat('d',64),1));
 SELECT test_slot('11111111111111111111111111111111','Oni',9);
 SELECT test_slot('22222222222222222222222222222222','Oni',10);
 SELECT test_slot('22222222222222222222222222222222','Hard',6);`)
	if err != nil {
		t.Fatal(err)
	}
	// A stand-in OurTaikoProfile: its title catalog, and each award request recorded and answered
	// with what it granted.
	var mu sync.Mutex
	asked := []AwardRequest{}
	var down, reject atomic.Bool
	var catalogReads atomic.Int32
	titles := []map[string]any{
		{"id": "ten-dan", "official": false, "ownerId": alice},
		{"id": "ten-dan-gold", "official": true, "ownerId": nil},
		{"id": "shared", "official": false, "ownerId": nil},
		{"id": "carols", "official": false, "ownerId": carol},
	}
	profile := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if down.Load() {
			w.WriteHeader(503)
			return
		}
		if r.Method == "GET" && r.URL.Path == "/api/v1/titles" {
			catalogReads.Add(1)
			mu.Lock()
			defer mu.Unlock()
			respond(w, 200, map[string]any{"titles": titles})
			return
		}
		if r.URL.Path != "/internal/v1/awards" || r.Header.Get("X-Service-ID") != "fanmade" || r.Header.Get("X-Service-Key") != strings.Repeat("k", 64) {
			w.WriteHeader(401)
			return
		}
		if reject.Load() {
			respond(w, 422, map[string]string{"code": "AWARD_INVALID", "message": "奖励请求无效"})
			return
		}
		var request AwardRequest
		json.NewDecoder(r.Body).Decode(&request)
		mu.Lock()
		asked = append(asked, request)
		mu.Unlock()
		respond(w, 200, map[string]any{"granted": map[string]any{"titles": request.Titles, "dan": request.Dan}, "nameplate": map[string]any{"userId": request.UserID}})
	}))
	defer profile.Close()
	client, err := NewProfile(ProfileConfig{URL: profile.URL, ServiceID: "fanmade", ServiceKey: strings.Repeat("k", 64)})
	if err != nil {
		t.Fatal(err)
	}
	s := testServer(t, pool, Config{Origin: origin, Profile: client})
	handler := s.Handler()
	game := map[string]string{}
	for _, user := range []string{carol} {
		token := ID() + ID()
		if _, err = pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'',now()+interval '1 day')`, hash("game:"+token), user); err != nil {
			t.Fatal(err)
		}
		game[user] = token
	}
	web := map[string]string{alice: seedWebSession(t, s, alice), boss: seedWebSession(t, s, boss), carol: seedWebSession(t, s, carol)}
	call := func(method, path, body, user string, key ...string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if strings.HasPrefix(path, "/api/v1/game/") {
			if user != "" {
				r.Header.Set("Authorization", "Bearer "+game[user])
			}
		} else {
			r.Header.Set("Origin", origin)
			if user != "" {
				r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: web[user]})
				r.Header.Set("X-CSRF-Token", "csrf")
			}
		}
		if len(key) > 0 {
			r.Header.Set("Idempotency-Key", key[0])
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	expect := func(w *httptest.ResponseRecorder, status int, out any) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("want %d got %d %s", status, w.Code, w.Body.String())
		}
		if out != nil {
			if err := json.Unmarshal(w.Body.Bytes(), out); err != nil {
				t.Fatal(err)
			}
		}
	}
	course := `{"title":{"ja":"十段","en":" 10th Dan "},"color":3,"songs":[{"chartId":"` + songA + `","course":"Oni"},{"chartId":"` + songB + `","course":"Oni","hidden":true}],
 "exams":[{"type":"gauge","range":"more","value":[100]},{"type":"bad","range":"less","value":[[10,5],null]}],
 "rewards":{"dan":20,"titles":[{"id":"ten-dan","on":"red"},{"id":"ten-dan-gold","on":"gold"}]}}`

	// Anyone signed in publishes; what the game needs is checked.
	expect(call("POST", "/api/v1/dans", course, ""), 401, nil)
	for _, bad := range []string{
		strings.Replace(course, `"type":"gauge","range":"more","value":[100]`, `"type":"gauge","range":"more","value":[[100],null]`, 1),
		strings.Replace(course, `"value":[[10,5],null]`, `"value":[[0],null]`, 1),
		strings.Replace(course, `"value":[[10,5],null]`, `"value":[[10]]`, 1),
		strings.Replace(course, `"type":"bad"`, `"type":"misses"`, 1),
		strings.Replace(course, `"on":"red"`, `"on":"blue"`, 1),
		strings.Replace(course, `"dan":20`, `"dan":25`, 1),
		strings.Replace(course, `"dan":20`, `"dan":5`, 1),
		strings.Replace(course, `"title":{"ja":"十段","en":" 10th Dan "}`, `"title":{"fr":"x"}`, 1),
	} {
		expect(call("POST", "/api/v1/dans", bad, alice), 422, nil)
	}
	expect(call("POST", "/api/v1/dans", strings.Replace(course, `"course":"Oni","hidden"`, `"course":"Edit","hidden"`, 1), alice), 422, nil)

	// Reward titles are on Profile, and official or the maker's own community titles.
	var problemBody struct{ Code string }
	expect(call("POST", "/api/v1/dans", strings.Replace(course, `"ten-dan-gold"`, `"missing"`, 1), alice), 422, &problemBody)
	if problemBody.Code != "DAN_TITLE_NOT_FOUND" {
		t.Fatal(problemBody)
	}
	expect(call("POST", "/api/v1/dans", strings.Replace(course, `"ten-dan-gold"`, `"carols"`, 1), alice), 422, &problemBody)
	if problemBody.Code != "DAN_TITLE_NOT_OWNED" {
		t.Fatal(problemBody)
	}
	reads := catalogReads.Load()
	var withShared DanCourse
	expect(call("POST", "/api/v1/dans", strings.Replace(course, `"ten-dan-gold"`, `"shared"`, 1), alice), 201, &withShared)
	if catalogReads.Load() != reads {
		t.Fatal("the catalog is kept for a minute")
	}
	// A title made a moment ago is found by reading the catalog again.
	mu.Lock()
	titles = append(titles, map[string]any{"id": "brand-new", "official": false, "ownerId": alice})
	mu.Unlock()
	expect(call("PUT", "/api/v1/dans/"+withShared.ID, strings.Replace(course, `"ten-dan-gold"`, `"brand-new"`, 1), alice), 200, nil)
	expect(call("DELETE", "/api/v1/dans/"+withShared.ID, "", alice), 200, nil)
	var created DanCourse
	expect(call("POST", "/api/v1/dans", course, alice), 201, &created)
	if created.Official || created.Owner != "Alice" || created.Title["en"] != "10th Dan" || len(created.Songs) != 2 || !created.Songs[1].Hidden ||
		created.Songs[0].Chart.TjaHash != strings.Repeat("a", 64) || created.Songs[0].Level != 9 || !created.Songs[0].Available || created.Songs[1].Title != "Beta" {
		t.Fatalf("created %+v", created)
	}

	// The game reads every course in the format it plays.
	var list struct {
		Dans       []DanCourse
		DanVersion int
	}
	expect(call("GET", "/api/v1/game/dans", "", ""), 200, &list)
	if list.DanVersion != 1 || len(list.Dans) != 1 || list.Dans[0].Format != 1 || list.Dans[0].ID != created.ID || list.Dans[0].Songs[1].Chart.ID != songB {
		t.Fatalf("game list %+v", list)
	}
	var catalog map[string]any
	expect(call("GET", "/api/v1/game/catalog", "", ""), 200, &catalog)
	if catalog["danVersion"] != float64(1) {
		t.Fatal("the catalog says the server hands out courses")
	}

	attempt := func(key, body string, status int) map[string]json.RawMessage {
		t.Helper()
		var reply map[string]json.RawMessage
		expect(call("POST", "/api/v1/game/dan-attempts", body, carol, key), status, &reply)
		return reply
	}
	expect(call("POST", "/api/v1/game/dan-attempts", `{"courseId":"`+created.ID+`","verdict":5,"songsPlayed":2}`, carol), 400, nil)
	expect(call("POST", "/api/v1/game/dan-attempts", `{"courseId":"`+created.ID+`","verdict":5,"songsPlayed":2}`, "", "attempt-key-0001"), 401, nil)
	attempt("attempt-key-0001", `{"courseId":"`+created.ID+`","verdict":7,"songsPlayed":2}`, 422)
	attempt("attempt-key-0001", `{"courseId":"999","verdict":1,"songsPlayed":2}`, 404)

	// Not official yet: the titles come, no 段位.
	reply := attempt("attempt-key-0001", `{"courseId":"`+created.ID+`","verdict":5,"songsPlayed":2}`, 200)
	if len(asked) != 1 || asked[0].Official || asked[0].Dan != nil || strings.Join(asked[0].Titles, ",") != "ten-dan,ten-dan-gold" || asked[0].CourseTitle != "十段" || asked[0].UserID != carol || asked[0].CourseOwner != alice {
		t.Fatalf("award request %+v", asked)
	}
	if !strings.Contains(string(reply["profile"]), `"granted"`) {
		t.Fatal("the Profile reply goes back to the game", reply)
	}

	// Administrators mark official courses.
	expect(call("PUT", "/api/v1/dans/"+created.ID+"/official", `{"official":true}`, alice), 403, nil)
	expect(call("PUT", "/api/v1/dans/"+created.ID+"/official", `{"official":true}`, boss), 200, nil)
	attempt("attempt-key-0002", `{"courseId":"`+created.ID+`","verdict":2,"songsPlayed":2}`, 200)
	if len(asked) != 2 || !asked[1].Official || asked[1].Dan == nil || *asked[1].Dan != 20 || strings.Join(asked[1].Titles, ",") != "ten-dan" {
		t.Fatalf("official award %+v", asked[1])
	}
	// The same attempt again is answered from what Profile granted; a different body conflicts.
	again := attempt("attempt-key-0002", `{"courseId":"`+created.ID+`","verdict":2,"songsPlayed":2}`, 200)
	if len(asked) != 2 || !strings.Contains(string(again["profile"]), `"granted"`) {
		t.Fatal("a retry does not ask Profile again", len(asked))
	}
	attempt("attempt-key-0002", `{"courseId":"`+created.ID+`","verdict":3,"songsPlayed":2}`, 409)

	// While Profile is down the attempt is kept; its retry asks again.
	down.Store(true)
	failed := attempt("attempt-key-0003", `{"courseId":"`+created.ID+`","verdict":0,"songsPlayed":1}`, 200)
	if string(failed["profile"]) != "null" || len(failed["profileError"]) == 0 {
		t.Fatal("Profile down", failed)
	}
	down.Store(false)
	retried := attempt("attempt-key-0003", `{"courseId":"`+created.ID+`","verdict":0,"songsPlayed":1}`, 200)
	if len(asked) != 3 || asked[2].Verdict != 0 || len(asked[2].Titles) != 0 || string(retried["profile"]) == "null" {
		t.Fatal("retried award", asked, retried)
	}
	// When Profile turns the request down for good, the game is told to stop sending it.
	reject.Store(true)
	refused := attempt("attempt-key-0004", `{"courseId":"`+created.ID+`","verdict":1,"songsPlayed":2}`, 200)
	reject.Store(false)
	if string(refused["profile"]) != "null" || len(refused["profileError"]) != 0 || string(refused["profileRejected"]) != `"AWARD_INVALID"` {
		t.Fatal("rejected", refused)
	}

	// A replaced chart leaves the course listed but unplayable.
	if _, err = pool.Exec(ctx, `UPDATE charts SET tja_file=test_file('tja-a2','a.tja',repeat('e',64),1) WHERE id=$1`, songA); err != nil {
		t.Fatal(err)
	}
	var detail DanCourse
	expect(call("GET", "/api/v1/dans/"+created.ID, "", ""), 200, &detail)
	if detail.Songs[0].Available || detail.Songs[0].Chart.TjaHash != strings.Repeat("a", 64) || !detail.Official {
		t.Fatalf("replaced chart %+v", detail.Songs[0])
	}

	// The owner (or an administrator) changes and removes it; others cannot.
	changed := strings.Replace(course, `"十段"`, `"十段・改"`, 1)
	expect(call("PUT", "/api/v1/dans/"+created.ID, changed, carol), 403, nil)
	expect(call("PUT", "/api/v1/dans/"+created.ID, changed, alice), 200, &detail)
	if detail.Title["ja"] != "十段・改" || !detail.Songs[0].Available {
		t.Fatalf("saving again pins the current chart %+v", detail)
	}
	expect(call("DELETE", "/api/v1/dans/"+created.ID, "", carol), 403, nil)
	expect(call("DELETE", "/api/v1/dans/"+created.ID, "", alice), 200, nil)
	expect(call("GET", "/api/v1/dans/"+created.ID, "", ""), 404, nil)
	var empty struct{ Dans []DanCourse }
	expect(call("GET", "/api/v1/dans", "", ""), 200, &empty)
	if len(empty.Dans) != 0 {
		t.Fatal("deleted course listed")
	}
	if w := call("POST", "/api/v1/dans", course, alice); w.Code != 201 {
		io.WriteString(io.Discard, w.Body.String())
		t.Fatal(w.Code)
	}

	// While Profile does not answer, titles are not checked (Profile skips what it cannot give).
	down.Store(true)
	expect(call("POST", "/api/v1/dans", strings.Replace(course, `"ten-dan-gold"`, `"missing"`, 1), alice), 201, nil)
	down.Store(false)

	// At most ten courses that are not official each; an official one frees its place.
	resetRateLimit(s)
	plain := strings.Replace(course, `,"titles":[{"id":"ten-dan","on":"red"},{"id":"ten-dan-gold","on":"gold"}]`, ``, 1)
	var first DanCourse
	expect(call("POST", "/api/v1/dans", plain, carol), 201, &first)
	for i := 1; i < danCommunityLimit; i++ {
		expect(call("POST", "/api/v1/dans", plain, carol), 201, nil)
	}
	expect(call("POST", "/api/v1/dans", plain, carol), 409, &problemBody)
	if problemBody.Code != "DAN_LIMIT_REACHED" {
		t.Fatal(problemBody)
	}
	expect(call("PUT", "/api/v1/dans/"+first.ID+"/official", `{"official":true}`, boss), 200, nil)
	expect(call("POST", "/api/v1/dans", plain, carol), 201, nil)
	expect(call("POST", "/api/v1/dans", plain, carol), 409, nil)
}
