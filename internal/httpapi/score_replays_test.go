package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

const testReplayV2 = `{"version":2,"audio_offset_ms":-20,"visual_offset_ms":10,"inputs":[[-15.5,0],[1234.5,1]],"options":{"speed":25,"inverse":true,"display":false,"random":2,"flipped":[0,3,7]}}`
const testReplay = `{"version":1,"audio_offset_ms":-20,"visual_offset_ms":10,"inputs":[[-15.5,0],[1234.5,1],[1234.5,2],[1200,3]]}`

func TestNormalizeScoreReplay(t *testing.T) {
	for _, raw := range []string{testReplay, strings.Replace(testReplay, `[-15.5,0],[1234.5,1],[1234.5,2],[1200,3]`, "", 1)} {
		if normalized := normalizeScoreReplay(json.RawMessage(raw)); string(normalized) != raw {
			t.Fatalf("lost event order, simultaneous inputs, offsets or empty recording: %s", normalized)
		}
	}
	// Version 2 adds the play options; key order and spacing are canonicalized.
	if normalized := normalizeScoreReplay(json.RawMessage(testReplayV2)); string(normalized) != testReplayV2 {
		t.Fatalf("lost the play options: %s", normalized)
	}
	spaced := strings.Replace(strings.Replace(testReplayV2, `"flipped":[0,3,7]`, `"flipped": [0, 3, 7]`, 1), `"speed":25,"inverse":true`, `"inverse":true,"speed":25`, 1)
	if normalized := normalizeScoreReplay(json.RawMessage(spaced)); string(normalized) != testReplayV2 {
		t.Fatalf("options were not canonicalized: %s", normalized)
	}
	for name, raw := range map[string]string{
		"options on version 1": strings.Replace(testReplayV2, `"version":2`, `"version":1`, 1),
		"version 3":            strings.Replace(testReplayV2, `"version":2`, `"version":3`, 1),
		"speed range":          strings.Replace(testReplayV2, `"speed":25`, `"speed":41`, 1),
		"missing inverse":      strings.Replace(testReplayV2, `"inverse":true,`, "", 1),
		"random range":         strings.Replace(testReplayV2, `"random":2`, `"random":3`, 1),
		"null flipped":         strings.Replace(testReplayV2, `"flipped":[0,3,7]`, `"flipped":null`, 1),
		"unordered flipped":    strings.Replace(testReplayV2, `"flipped":[0,3,7]`, `"flipped":[3,3]`, 1),
		"negative flipped":     strings.Replace(testReplayV2, `"flipped":[0,3,7]`, `"flipped":[-1]`, 1),
		"unknown option":       strings.Replace(testReplayV2, `"random":2`, `"random":2,"neiro":1`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			if normalizeScoreReplay(json.RawMessage(raw)) != nil {
				t.Fatal("invalid recording must normalize to SQL NULL")
			}
		})
	}
	for name, raw := range map[string]string{
		"absent": "", "null": "null", "array": "[]", "string": `"invalid recording"`,
		"malformed": "{", "missing version": `{"inputs":[]}`,
		"future version":    strings.Replace(testReplay, `"version":1`, `"version":2`, 1),
		"missing audio":     strings.Replace(testReplay, `"audio_offset_ms":-20,`, "", 1),
		"null visual":       strings.Replace(testReplay, `"visual_offset_ms":10`, `"visual_offset_ms":null`, 1),
		"fractional offset": strings.Replace(testReplay, `"visual_offset_ms":10`, `"visual_offset_ms":1.5`, 1),
		"overflow offset":   strings.Replace(testReplay, `"visual_offset_ms":10`, `"visual_offset_ms":2147483648`, 1),
		"missing inputs":    `{"version":1,"audio_offset_ms":0,"visual_offset_ms":0}`,
		"null inputs":       `{"version":1,"audio_offset_ms":0,"visual_offset_ms":0,"inputs":null}`,
		"object inputs":     `{"version":1,"audio_offset_ms":0,"visual_offset_ms":0,"inputs":{"100":1}}`,
		"null event":        strings.Replace(testReplay, `[-15.5,0]`, `null`, 1),
		"short event":       strings.Replace(testReplay, `[-15.5,0]`, `[1]`, 1),
		"long event":        strings.Replace(testReplay, `[-15.5,0]`, `[1,2,3]`, 1),
		"null time":         strings.Replace(testReplay, `[-15.5,0]`, `[null,0]`, 1),
		"string time":       strings.Replace(testReplay, `[-15.5,0]`, `["10",0]`, 1),
		"time overflow":     strings.Replace(testReplay, `[-15.5,0]`, `[1e999,0]`, 1),
		"time range":        strings.Replace(testReplay, `[-15.5,0]`, `[86400001,0]`, 1),
		"null key":          strings.Replace(testReplay, `[-15.5,0]`, `[1,null]`, 1),
		"fractional key":    strings.Replace(testReplay, `[-15.5,0]`, `[1,1.5]`, 1),
		"negative key":      strings.Replace(testReplay, `[-15.5,0]`, `[1,-1]`, 1),
		"key range":         strings.Replace(testReplay, `[-15.5,0]`, `[1,4]`, 1),
		"unknown field":     strings.TrimSuffix(testReplay, "}") + `,"unsupported":true}`,
		"too large":         `"` + strings.Repeat("x", maxReplayBytes) + `"`,
		"too many events":   `{"version":1,"audio_offset_ms":0,"visual_offset_ms":0,"inputs":[` + strings.Repeat(`[0,1],`, maxReplayInputs) + `[0,1]]}`,
	} {
		t.Run(name, func(t *testing.T) {
			if normalizeScoreReplay(json.RawMessage(raw)) != nil {
				t.Fatal("invalid recording must normalize to SQL NULL")
			}
		})
	}
}

func TestScoreReplayCompatibility(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const user = "89b6ef3a5cb57b6e04f74711d15a8a5f"
	const song = "11111111111111111111111111111111"
	const token = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
	const origin = "http://localhost:5173"
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,'replaytest','unused');`, user)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO charts(id,owner_ids,title,bpm,duration,tja_file,audio_file) VALUES('11111111111111111111111111111111',ARRAY['89b6ef3a5cb57b6e04f74711d15a8a5f'],'Recording fixture',120,10,test_file('tja','test.tja',repeat('a',64),1),test_file('ogg','test.ogg',repeat('b',64),1));
 INSERT INTO chart_difficulties(chart_id,course,side,level,maker) SELECT chart_id,course,'single',level,maker FROM (VALUES ('11111111111111111111111111111111','Oni',5,'')) v(chart_id,course,level,maker);`)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var slot int64
	if err = pool.QueryRow(ctx, `SELECT test_slot($1,'Oni')`, song).Scan(&slot); err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf(`{"difficultyId":%d,"good":10,"ok":0,"bad":0,"score":10000,"drumroll":0,"max_combo":10}`, slot)
	app := testServer(t, pool, Config{Origin: origin})
	_, err = pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,'',now()+interval '1 day')`, hash("game:"+token), user)
	if err != nil {
		t.Fatal(err)
	}
	cookie := seedWebSession(t, app, user)
	server := httptest.NewServer(app.Handler())
	defer server.Close()
	call := func(path, body, key string, want int) Score {
		t.Helper()
		req, err := http.NewRequest("POST", server.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", key)
		if strings.Contains(path, "/game/") {
			req.Header.Set("Authorization", "Bearer "+token)
		} else {
			req.Header.Set("Origin", origin)
			req.Header.Set("X-CSRF-Token", "csrf")
			req.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		}
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		if response.StatusCode != want {
			t.Fatalf("want %d got %d: %s", want, response.StatusCode, data)
		}
		var score Score
		if want < 300 && (json.Unmarshal(data, &score) != nil || score.ID == "" || score.Score != 10000) {
			t.Fatal("bad score receipt")
		}
		if strings.Contains(string(data), "replay_data") {
			t.Fatal("recording must not inflate score receipts")
		}
		return score
	}
	attach := func(raw string) string { return strings.TrimSuffix(base, "}") + `,"replay_data":` + raw + "}" }
	for index, path := range []string{"/api/v1/game/scores", "/api/v1/scores"} {
		key := fmt.Sprintf("recording-legacy-%04d", index)
		legacy := call(path, base, key, 201)
		var digest string
		var isNull bool
		if err := pool.QueryRow(ctx, `SELECT replay_data IS NULL,payload_digest FROM scores WHERE id=$1`, legacy.ID).Scan(&isNull, &digest); err != nil || !isNull || digest != hash(base) {
			t.Fatalf("legacy payload/digest changed: null=%v err=%v", isNull, err)
		}
		// A retry after upgrading the server must match an old request exactly.
		if retry := call(path, base, key, 200); retry.ID != legacy.ID || retry.ClearStatus != 0 {
			t.Fatal("duplicated legacy score")
		}
		if retry := call(path, strings.TrimSuffix(base, "}")+`,"ClearStatus":0}`, key, 200); retry.ID != legacy.ID || retry.ClearStatus != 0 {
			t.Fatal("explicit zero broke legacy idempotency")
		}
		for _, raw := range []string{"null", `"broken"`, `{}`, strings.Replace(testReplay, `[-15.5,0]`, `[1,9]`, 1)} {
			if retry := call(path, attach(raw), key, 200); retry.ID != legacy.ID {
				t.Fatal("invalid replay broke legacy idempotency")
			}
			bad := call(path, attach(raw), "", 201)
			if err := pool.QueryRow(ctx, `SELECT replay_data IS NULL FROM scores WHERE id=$1`, bad.ID).Scan(&isNull); err != nil || !isNull {
				t.Fatal("invalid replay was not SQL NULL", err)
			}
		}
		validKey := fmt.Sprintf("recording-valid-%04d", index)
		valid := call(path, attach(testReplay), validKey, 201)
		var equal bool
		if err := pool.QueryRow(ctx, `SELECT replay_data=$2::jsonb FROM scores WHERE id=$1`, valid.ID, testReplay).Scan(&equal); err != nil || !equal {
			t.Fatal("recording lost events or delay settings", err)
		}
		if retry := call(path, attach(strings.Replace(testReplay, "1234.5", "1234.500", -1)), validKey, 200); retry.ID != valid.ID {
			t.Fatal("canonical retry duplicated score")
		}
		call(path, attach(strings.Replace(testReplay, `"audio_offset_ms":-20`, `"audio_offset_ms":-21`, 1)), validKey, 409)
		call(path, attach(strings.Replace(testReplay, `[1234.5,2]`, `[1234.5,3]`, 1)), validKey, 409)
	}
	// The recording is read back with its play, by anyone; a play without one has none.
	get := func(path string, want int) map[string]json.RawMessage {
		t.Helper()
		response, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		if response.StatusCode != want {
			t.Fatalf("%s: want %d got %d: %s", path, want, response.StatusCode, data)
		}
		var body map[string]json.RawMessage
		json.Unmarshal(data, &body)
		return body
	}
	withOptions := call("/api/v1/game/scores", attach(testReplayV2), "recording-v2-0001", 201)
	if !withOptions.HasReplay {
		t.Fatal("the receipt must say the recording was kept")
	}
	read := get("/api/v1/scores/"+withOptions.ID+"/replay", 200)
	var readScore Score
	if !sameJSON(read["replay"], []byte(testReplayV2)) || json.Unmarshal(read["score"], &readScore) != nil || readScore.ID != withOptions.ID || !readScore.HasReplay || readScore.Course != "Oni" || len(read["nickname"]) == 0 {
		t.Fatalf("recording read back wrong: %s", read)
	}
	without := call("/api/v1/game/scores", base, "recording-none-0001", 201)
	if without.HasReplay {
		t.Fatal("a score without a recording must say so")
	}
	get("/api/v1/scores/"+without.ID+"/replay", 404)
	get("/api/v1/scores/ffffffffffffffffffffffffffffffff/replay", 404)
	var board struct {
		Items []struct {
			ID        string `json:"id"`
			HasReplay bool   `json:"hasReplay"`
		} `json:"items"`
	}
	if json.Unmarshal(mustJSON(t, get("/api/v1/charts/"+song+"/leaderboard", 200)), &board) != nil || len(board.Items) != 1 {
		t.Fatalf("leaderboard: %+v", board)
	}
	var plays struct {
		Items []struct {
			ID        string `json:"id"`
			HasReplay bool   `json:"hasReplay"`
		} `json:"items"`
	}
	if json.Unmarshal(mustJSON(t, get("/api/v1/users/"+user+"/scores?view=all", 200)), &plays) != nil || len(plays.Items) == 0 {
		t.Fatalf("user scores: %+v", plays)
	}
	kept := map[string]bool{}
	for _, play := range plays.Items {
		kept[play.ID] = play.HasReplay
	}
	if !kept[withOptions.ID] || kept[without.ID] {
		t.Fatalf("the score list must mark the plays with a recording: %v", kept)
	}
	// The public replay list: every kept recording on the chart's current files, newest first,
	// with the song's title and the player's nickname.
	type listing struct {
		Items []struct {
			ID        string `json:"id"`
			SongID    string `json:"songId"`
			Course    string `json:"course"`
			Title     string `json:"title"`
			Level     int    `json:"level"`
			Nickname  string `json:"nickname"`
			HasReplay bool   `json:"hasReplay"`
			IsLatest  bool   `json:"isLatest"`
		} `json:"items"`
		Total    int    `json:"total"`
		Page     int    `json:"page"`
		PageSize int    `json:"pageSize"`
		Sort     string `json:"sort"`
	}
	list := func(path string) listing {
		t.Helper()
		var v listing
		if err := json.Unmarshal(mustJSON(t, get(path, 200)), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	replays := list("/api/v1/replays")
	listed := map[string]bool{}
	for _, item := range replays.Items {
		listed[item.ID] = true
		if !item.HasReplay || !item.IsLatest || item.SongID != song || item.Title != "Recording fixture" || item.Course != "Oni" || item.Level != 5 || item.Nickname == "" {
			t.Fatalf("replay listing: %+v", item)
		}
	}
	if !listed[withOptions.ID] || listed[without.ID] || replays.Total != len(replays.Items) || replays.Sort != "recent" || replays.PageSize != 20 || replays.Items[0].ID != withOptions.ID {
		t.Fatalf("replay list: %+v", replays)
	}
	if v := list("/api/v1/replays?course=Easy"); len(v.Items) != 0 || v.Total != 0 {
		t.Fatalf("course filter: %+v", v)
	}
	if v := list("/api/v1/replays?sort=score&page=99"); len(v.Items) != 0 || v.Total != replays.Total || v.Page != 99 {
		t.Fatalf("past the last page: %+v", v)
	}
	// categoryId narrows to the songs of one category (Game here).
	if _, err := pool.Exec(ctx, `UPDATE charts SET category_flags=$2 WHERE id=$1`, song, int(CategoryGame)); err != nil {
		t.Fatal(err)
	}
	if v := list("/api/v1/replays?categoryId=game"); v.Total != replays.Total || len(v.Items) == 0 || v.Items[0].ID != withOptions.ID {
		t.Fatalf("category filter: %+v", v)
	}
	if v := list("/api/v1/replays?categoryId=pop&course=Oni"); v.Total != 0 || len(v.Items) != 0 {
		t.Fatalf("another category: %+v", v)
	}
	for _, bad := range []string{"?sort=level", "?page=0", "?course=oni", "?categoryId=nope"} {
		get("/api/v1/replays"+bad, 400)
	}
	// A play of replaced files is not listed: it no longer matches the chart.
	if _, err := pool.Exec(ctx, `UPDATE scores SET is_latest=false WHERE id=$1`, withOptions.ID); err != nil {
		t.Fatal(err)
	}
	for _, item := range list("/api/v1/replays").Items {
		if item.ID == withOptions.ID {
			t.Fatal("a play of replaced files must not be listed")
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE scores SET is_latest=true WHERE id=$1`, withOptions.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE charts SET status='hidden' WHERE id=$1`, song); err != nil {
		t.Fatal(err)
	}
	get("/api/v1/scores/"+withOptions.ID+"/replay", 404)
	if v := list("/api/v1/replays"); v.Total != 0 {
		t.Fatalf("a hidden chart's plays must not be listed: %+v", v)
	}
	if _, err := pool.Exec(ctx, `UPDATE charts SET status='published' WHERE id=$1`, song); err != nil {
		t.Fatal(err)
	}
	// Requests larger than the old 8 KB cap are valid. Bound attachment size
	// independently so an oversized recording still saves the basic score.
	large := `{"version":1,"audio_offset_ms":0,"visual_offset_ms":0,"inputs":[` + strings.Repeat(`[1234.5,1],`, 5000) + `[1234.5,2]]}`
	score := call("/api/v1/game/scores", attach(large), "", 201)
	var length int
	if err := pool.QueryRow(ctx, `SELECT jsonb_array_length(replay_data->'inputs') FROM scores WHERE id=$1`, score.ID).Scan(&length); err != nil || length != 5001 {
		t.Fatal("large recording was lost", err)
	}
	oversized := call("/api/v1/game/scores", attach(`"`+strings.Repeat("x", maxReplayBytes)+`"`), "", 201)
	var isNull bool
	if err := pool.QueryRow(ctx, `SELECT replay_data IS NULL FROM scores WHERE id=$1`, oversized.ID).Scan(&isNull); err != nil || !isNull {
		t.Fatal("oversized attachment must become NULL", err)
	}
	call("/api/v1/game/scores", attach(`"`+strings.Repeat("x", maxScoreRequestBytes)+`"`), "", 413)
	call("/api/v1/game/scores", strings.TrimSuffix(base, "}")+`,"replay_data":{`, "", 400)
	for _, path := range []string{"/api/v1/game/catalog", "/api/v1/game/scores"} {
		req, _ := http.NewRequest("GET", server.URL+path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || strings.Contains(string(data), "replay_data") || path == "/api/v1/game/catalog" && !strings.Contains(string(data), `"scoreReplayVersion":1`) {
			t.Fatal("capability/score compatibility failed", path)
		}
	}
}

func mustJSON(t *testing.T, body map[string]json.RawMessage) []byte {
	t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

// jsonb does not keep key order.
func sameJSON(a, b []byte) bool {
	var x, y any
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && reflect.DeepEqual(x, y)
}
