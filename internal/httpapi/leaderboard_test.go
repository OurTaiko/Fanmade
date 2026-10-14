package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLeaderboard(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const song = "11111111111111111111111111111111"
	const old = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for i := 0; i < 23; i++ {
		if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,$2,'unused')`, fmt.Sprintf("%032x", i+1000), fmt.Sprintf("player%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	_, err := pool.Exec(ctx, `BEGIN;
 INSERT INTO charts(id,owner_ids,title,bpm,duration,tja_file,audio_file) VALUES('11111111111111111111111111111111',ARRAY['000000000000000000000000000003e8'],'Current',120,10,test_file('tja','tja',repeat('a',64),1),test_file('audio','audio',repeat('a',64),1)),('22222222222222222222222222222222',ARRAY['000000000000000000000000000003e8'],'Other',120,10,test_file('tja','tja',repeat('a',64),1),test_file('audio','audio',repeat('a',64),1));
	 SELECT test_slot('11111111111111111111111111111111',c) FROM unnest(ARRAY['Oni','Hard','Easy','Edit']) c;
	 SELECT test_slot('22222222222222222222222222222222','Oni');
	 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	add := func(id, user, chart string, points, good int64, date string) {
		t.Helper()
		_, err := pool.Exec(ctx, `INSERT INTO scores(id,user_id,difficulty_id,good,ok,bad,score,drumroll,max_combo,payload_digest,submitted_at) VALUES($1,$2,test_slot($3,'Oni'),$4,2,1,$5,55,$4,repeat('a',64),$6::timestamptz)`, id, user, chart, good, points, date)
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 23; i++ {
		points := int64(800000 - i)
		if i < 2 {
			points = 900000
		}
		add(fmt.Sprintf("score%02d", i), fmt.Sprintf("%032x", i+1000), song, points, 300, "2026-01-01T00:00:00Z")
	}
	add("lower", "000000000000000000000000000003e8", song, 840000, 100, "2025-12-01T00:00:00Z")
	add("later", "000000000000000000000000000003e8", song, 900000, 999, "2026-02-01T00:00:00Z")
	add("9b893bc6d9422c93536ff0df503b81e9", "000000000000000000000000000003e8", "22222222222222222222222222222222", 1300000, 600, "2025-12-01T00:00:00Z")
	handler := testServer(t, pool, Config{}).Handler()
	get := func(path string, status int, code string) leaderboardResponse {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != status || (code != "" && !strings.Contains(w.Body.String(), code)) {
			t.Fatalf("%s: %d %s", path, w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "versionId") {
			t.Fatal("removed field exposed", w.Body.String())
		}
		var v leaderboardResponse
		if status == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(w.Body.String(), "password") || strings.Contains(w.Body.String(), "email") {
				t.Fatal("private user fields exposed")
			}
		}
		return v
	}
	path := "/api/v1/charts/" + song + "/leaderboard"
	slot := func(chart, course string) string {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `SELECT test_slot($1,$2)`, chart, course).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return fmt.Sprintf("?difficultyId=%d", id)
	}
	v := get(path, 200, "")
	if v.Course != "Oni" || v.Side != "single" || !v.Supported || v.Total != 23 || len(v.Items) != 20 {
		t.Fatalf("unexpected summary: %+v", v)
	}
	if v.Items[0].ID != "score00" || v.Items[0].Good != 300 || v.Items[0].MaxCombo != 300 || v.Items[0].Score.Score != 900000 || v.Items[0].Nickname != "player0" || v.Items[0].Rank != 1 || v.Items[1].Rank != 1 || v.Items[2].Rank != 3 {
		t.Fatalf("best score/ties incorrect: %+v", v.Items[:3])
	}
	second := get(path+slot(song, "Oni")+"&page=2", 200, "")
	if len(second.Items) != 3 || second.Items[0].Rank != 21 || second.Total != 23 {
		t.Fatalf("pagination incorrect: %+v", second)
	}
	if v := get(path+"?page=3", 200, ""); v.Total != 23 || len(v.Items) != 0 {
		t.Fatal(v)
	}
	if v := get(path+slot(song, "Hard"), 200, ""); !v.Supported || v.Course != "Hard" || v.Total != 0 || v.Items == nil {
		t.Fatal(v)
	}
	get(path+slot(song, "Easy"), 200, "")
	// A block of another song, or none at all, is not this song's.
	get(path+slot("22222222222222222222222222222222", "Oni"), 404, "DIFFICULTY_NOT_FOUND")
	get(path+"?difficultyId=987654321", 404, "DIFFICULTY_NOT_FOUND")
	get(path+"?difficultyId=Oni", 400, "DIFFICULTY_INVALID")
	// Scores of replaced files stay stored but leave the ranking.
	if _, err := pool.Exec(ctx, `UPDATE scores SET is_latest=false WHERE id IN ('score00','later')`); err != nil {
		t.Fatal(err)
	}
	if v := get(path, 200, ""); v.Total != 23 || v.Items[0].ID != "score01" || v.Items[0].Rank != 1 || v.Items[1].Rank != 2 {
		t.Fatalf("retired scores ranked: %+v", v.Items[:2])
	}
	if _, err := pool.Exec(ctx, `UPDATE scores SET is_latest=true`); err != nil {
		t.Fatal(err)
	}
	for _, page := range []string{"0", "-1", "10001", "invalid", "1.5"} {
		get(path+"?page="+page, 400, "QUERY_INVALID")
	}
	get("/api/v1/charts/missing/leaderboard", 404, "CHART_NOT_FOUND")
	if _, err := pool.Exec(ctx, `UPDATE charts SET title_translations=jsonb_build_object('en','Renamed') WHERE id=$1`, song); err != nil {
		t.Fatal(err)
	}
	if v := get(path, 200, ""); v.Items[0].ID != "score00" || v.Total != 23 {
		t.Fatal("metadata edit changed leaderboard")
	}
	if _, err := pool.Exec(ctx, `UPDATE charts SET status='deleted' WHERE id=$1`, song); err != nil {
		t.Fatal(err)
	}
	get(path, 404, "CHART_NOT_FOUND")
}
