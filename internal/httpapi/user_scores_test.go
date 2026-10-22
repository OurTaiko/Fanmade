package httpapi

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestUserScores(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const player = "0000000000000000000000000000abcd"
	const other = "0000000000000000000000000000beef"
	_, err := pool.Exec(ctx, `BEGIN;
 INSERT INTO users(id,username,password_hash) VALUES('0000000000000000000000000000abcd','player','unused'),('0000000000000000000000000000beef','other','unused');
 INSERT INTO charts(id,owner_ids,title,title_translations,bpm,duration,tja_file,audio_file,status) VALUES
  ('11111111111111111111111111111111',ARRAY['0000000000000000000000000000abcd'],'Alpha','{"ja":"アルファ"}',120,10,test_file('tja','tja',repeat('a',64),1),test_file('audio','audio',repeat('a',64),1),'published'),
  ('22222222222222222222222222222222',ARRAY['0000000000000000000000000000abcd'],'Beta','{}',120,10,test_file('tja','tja',repeat('a',64),1),test_file('audio','audio',repeat('a',64),1),'published'),
  ('33333333333333333333333333333333',ARRAY['0000000000000000000000000000abcd'],'Hidden','{}',120,10,test_file('tja','tja',repeat('a',64),1),test_file('audio','audio',repeat('a',64),1),'hidden');
 SELECT test_slot('11111111111111111111111111111111',c) FROM unnest(ARRAY['Oni','Hard']) c;
 SELECT test_slot('22222222222222222222222222222222','Oni');
 SELECT test_slot('33333333333333333333333333333333','Oni');
 UPDATE chart_difficulties SET level=CASE WHEN chart_id LIKE '2%' THEN 9 WHEN course='Oni' THEN 8 ELSE 5 END;
 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	add := func(id, user, chart, course string, points int64, clear int, latest bool, date string) {
		t.Helper()
		_, err := pool.Exec(ctx, `INSERT INTO scores(id,user_id,difficulty_id,good,ok,bad,score,drumroll,max_combo,payload_digest,clear_status,is_latest,submitted_at)
 VALUES($1,$2,test_slot($3,$4),10,0,0,$5,0,10,repeat('a',64),$6,$7,$8::timestamptz)`, id, user, chart, course, points, clear, latest, date)
		if err != nil {
			t.Fatal(err)
		}
	}
	const alpha, beta, hidden = "11111111111111111111111111111111", "22222222222222222222222222222222", "33333333333333333333333333333333"
	add("a1", player, alpha, "Oni", 900000, 1, true, "2026-01-01T00:00:00Z")
	add("a2", player, alpha, "Oni", 950000, 0, true, "2026-01-02T00:00:00Z")
	add("a3", player, alpha, "Oni", 990000, 3, false, "2025-12-01T00:00:00Z")
	add("h1", player, alpha, "Hard", 500000, 0, false, "2025-11-01T00:00:00Z")
	add("b1", player, beta, "Oni", 700000, 2, true, "2026-01-03T00:00:00Z")
	add("x1", player, hidden, "Oni", 999999, 3, true, "2026-01-04T00:00:00Z")
	add("o1", other, alpha, "Oni", 100000, 0, true, "2026-01-05T00:00:00Z")
	handler := testServer(t, pool, Config{}).Handler()
	type page struct {
		Items    []UserScore
		Total    int
		Page     int
		PageSize int
		View     string
		Sort     string
	}
	get := func(query string, status int) page {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/users/"+player+"/scores"+query, nil))
		if w.Code != status {
			t.Fatalf("%s: %d %s", query, w.Code, w.Body.String())
		}
		var v page
		if status == 200 {
			if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
				t.Fatal(err)
			}
		}
		return v
	}
	ids := func(p page) []string {
		out := []string{}
		for _, item := range p.Items {
			out = append(out, item.ID)
		}
		return out
	}
	same := func(got, want []string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	// Best per block, highest level first: a replaced file's play counts only while the block
	// has no current one; the clear status is the best of the same plays.
	best := get("", 200)
	if best.View != "best" || best.Sort != "level" || best.Total != 3 || best.PageSize != 50 || !same(ids(best), []string{"b1", "a2", "h1"}) {
		t.Fatalf("best view %+v", best)
	}
	alphaOni := best.Items[1]
	if alphaOni.Score.Score != 950000 || *alphaOni.BestClearStatus != 1 || *alphaOni.PlayCount != 2 || alphaOni.Title != "Alpha" || alphaOni.Level != 8 || string(alphaOni.TitleTranslations) != `{"ja":"アルファ"}` {
		t.Fatalf("best Alpha Oni %+v %s", alphaOni, alphaOni.TitleTranslations)
	}
	if hard := best.Items[2]; hard.IsLatest || *hard.PlayCount != 1 || hard.Course != "Hard" || hard.SongID != alpha {
		t.Fatalf("an old play stands while the block has no current one %+v", hard)
	}
	if !same(ids(get("?sort=score", 200)), []string{"a2", "b1", "h1"}) {
		t.Fatal("best by score")
	}
	if !same(ids(get("?course=Hard", 200)), []string{"h1"}) {
		t.Fatal("one course")
	}

	// Every play, newest first; hidden charts and other players are left out.
	all := get("?view=all", 200)
	if all.Sort != "recent" || all.Total != 5 || !same(ids(all), []string{"b1", "a2", "a1", "a3", "h1"}) || all.Items[0].BestClearStatus != nil || all.Items[0].PlayCount != nil {
		t.Fatalf("all view %+v", all)
	}
	if late := get("?page=2", 200); len(late.Items) != 0 || late.Total != 3 || late.Page != 2 {
		t.Fatalf("past the last page %+v", late)
	}
	for _, query := range []string{"?view=x", "?sort=x", "?course=Ura", "?page=0", "?page=x"} {
		get(query, 400)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/users/NOT-AN-ID/scores", nil))
	if w.Code != 404 {
		t.Fatal("invalid id", w.Code)
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/users/0000000000000000000000000000ffff/scores", nil))
	if w.Code != 200 || w.Body.String() == "" {
		t.Fatal("a player without scores has an empty list", w.Code)
	}
}
