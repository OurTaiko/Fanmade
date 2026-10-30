package httpapi

import (
	"context"
	"testing"
	"time"
)

// charts.update_at (R010, as on OurTaiko Database): every real change of the chart or of a
// block, file record, vote or comment of it moves it forward; the derived preview clip and
// writes that change nothing leave it.
func TestChartUpdateAt(t *testing.T) {
	c, s := interactionFixture(t)
	ctx := context.Background()
	last := func() time.Time {
		t.Helper()
		var at time.Time
		if err := s.DB.QueryRow(ctx, `SELECT update_at FROM charts WHERE id='song'`).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	at := last()
	moved := func(step string) {
		t.Helper()
		if next := last(); !next.After(at) {
			t.Fatalf("%s left update_at at %v", step, at)
		} else {
			at = next
		}
	}
	stayed := func(step string) {
		t.Helper()
		if next := last(); !next.Equal(at) {
			t.Fatalf("%s moved update_at %v → %v", step, at, next)
		}
	}
	exec := func(sql string) {
		t.Helper()
		if _, err := s.DB.Exec(ctx, sql); err != nil {
			t.Fatal(sql, err)
		}
	}

	c.do("alice", "PUT", "/api/v1/charts/song/vote", `{"value":1}`, nil)
	moved("vote")
	var comment Comment
	if code := c.do("alice", "POST", "/api/v1/charts/song/comments", `{"body":"hi"}`, &comment); code != 201 {
		t.Fatal("comment", code)
	}
	moved("comment")
	c.do("bob", "PUT", "/api/v1/comments/"+comment.ID+"/vote", `{"value":1}`, nil)
	moved("comment vote")
	exec(`UPDATE charts SET bpm=130 WHERE id='song'`)
	moved("chart column")
	exec(`UPDATE chart_resources SET original_filename='b.tja' WHERE id=(SELECT tja_file FROM charts WHERE id='song')`)
	moved("file record")
	exec(`INSERT INTO chart_difficulties(chart_id,course,side,level) VALUES('song','Oni','single',8)`)
	moved("block")

	exec(`UPDATE charts SET bpm=130 WHERE id='song'`)
	stayed("unchanged write")
	exec(`UPDATE charts SET preview_file=test_file('song/preview','p.ogg',repeat('c',64),14) WHERE id='song'`)
	stayed("preview clip")
	exec(`UPDATE charts SET update_at=now()-interval '1 day' WHERE id='song'`)
	stayed("an older update_at")

	var chart Chart
	if c.do("", "GET", "/api/v1/charts/song?by=id", "", &chart); !chart.UpdateAt.Equal(at) {
		t.Fatal("detail updateAt", chart.UpdateAt, at)
	}
	// "other" is newer, but "song" changed last.
	var list struct{ Items []Chart }
	if code := c.do("", "GET", "/api/v1/charts?order=updated", "", &list); code != 200 || len(list.Items) != 2 || list.Items[0].ID != "song" {
		t.Fatal("order=updated", code, list.Items)
	}
}
