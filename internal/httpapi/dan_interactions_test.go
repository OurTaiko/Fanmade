package httpapi

import (
	"context"
	"testing"
)

// A 段位 course takes votes and comments like a song: its own tallies, the
// maker's notifications, and the comment showing the course it belongs to.
func TestDanInteractions(t *testing.T) {
	c, s := interactionFixture(t)
	ctx := context.Background()
	dan := ID()
	if _, err := s.DB.Exec(ctx, `INSERT INTO dan_courses(id,owner_id,title,code,exams) VALUES($1,'d46774d30dd13b92d9e536808da468a4','{"ja":"初段","en":"1st Dan"}','SHODAN','[]')`, dan); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/dans/" + dan
	var v VoteResult
	if code := c.do("", "PUT", path+"/vote", `{"value":1}`, nil); code != 401 {
		t.Fatal("guest vote", code)
	}
	if code := c.do("alice", "PUT", "/api/v1/dans/999999/vote", `{"value":1}`, nil); code != 404 {
		t.Fatal("missing course", code)
	}
	if code := c.do("alice", "PUT", "/api/v1/dans/abc/vote", `{"value":1}`, nil); code != 404 {
		t.Fatal("non-numeric course", code)
	}
	c.do("alice", "PUT", path+"/vote", `{"value":1}`, &v)
	c.do("alice", "PUT", path+"/vote", `{"value":1}`, &v)
	c.do("bob", "PUT", path+"/vote", `{"value":-1}`, &v)
	if v.Score != 0 || *v.Upvotes != 1 || *v.Downvotes != 1 || v.MyVote != -1 {
		t.Fatalf("tally: %+v", v)
	}
	c.do("bob", "PUT", path+"/vote", `{"value":0}`, &v)
	if v.Score != 1 || *v.Downvotes != 0 || v.MyVote != 0 {
		t.Fatalf("withdrawn: %+v", v)
	}
	var course DanCourse
	c.do("alice", "GET", path, "", &course)
	if course.Score != 1 || course.Upvotes != 1 || course.MyVote != 1 || course.CommentCount != 0 {
		t.Fatalf("detail: %+v", course)
	}
	c.do("", "GET", path, "", &course)
	if course.MyVote != 0 {
		t.Fatal("guest sees a vote")
	}

	// Comments: a top-level one by alice, bob's reply, and the counts they move.
	var top, reply Comment
	if code := c.do("alice", "POST", path+"/comments", `{"body":"良い段位"}`, &top); code != 201 || top.DanID != dan || top.ChartID != "" || top.Score != 1 {
		t.Fatalf("top comment %d %+v", code, top)
	}
	if code := c.do("bob", "POST", path+"/comments", `{"body":"同感","parentId":"`+top.ID+`"}`, &reply); code != 201 || reply.Depth != 1 {
		t.Fatalf("reply %d %+v", code, reply)
	}
	// A song's comment cannot be replied to from a course, nor the reverse.
	var songTop Comment
	c.do("alice", "POST", "/api/v1/charts/song/comments", `{"body":"song"}`, &songTop)
	if code := c.do("bob", "POST", path+"/comments", `{"body":"x","parentId":"`+songTop.ID+`"}`, nil); code != 404 {
		t.Fatal("cross-subject reply", code)
	}
	if code := c.do("bob", "POST", "/api/v1/charts/song/comments", `{"body":"x","parentId":"`+top.ID+`"}`, nil); code != 404 {
		t.Fatal("cross-subject reply to song", code)
	}
	var page CommentPage
	if code := c.do("", "GET", path+"/comments", "", &page); code != 200 || page.Total != 1 || page.CommentCount != 2 || len(page.Items[0].Replies) != 1 {
		t.Fatalf("page %d %+v", code, page)
	}
	var songPage CommentPage
	c.do("", "GET", "/api/v1/charts/song/comments", "", &songPage)
	if songPage.CommentCount != 1 || songPage.Total != 1 {
		t.Fatalf("song page keeps its own count: %+v", songPage)
	}
	c.do("", "GET", path, "", &course)
	if course.CommentCount != 2 {
		t.Fatal("course comment count", course.CommentCount)
	}
	var thread struct{ Item Comment }
	if code := c.do("", "GET", "/api/v1/comments/"+reply.ID, "", &thread); code != 200 || thread.Item.DanTitle["ja"] != "初段" || thread.Item.DanID != dan {
		t.Fatalf("thread %d %+v", code, thread.Item)
	}
	var history CommentList
	c.do("", "GET", "/api/v1/users/5f0c4a0b0e7b4d3c9a6f1e2d3c4b5a69/comments", "", &history)
	if len(history.Items) != 1 || history.Items[0].DanTitle["en"] != "1st Dan" || history.Items[0].ChartTitle != "" {
		t.Fatalf("history %+v", history.Items)
	}
	// Comment votes work the same on a course's comments.
	c.do("bob", "PUT", "/api/v1/comments/"+top.ID+"/vote", `{"value":1}`, &v)
	if v.Score != 2 {
		t.Fatal("comment vote", v.Score)
	}
	// The maker heard about the comment; the reply went to alice.
	var inbox NotificationPage
	if code := c.do("owner", "GET", "/api/v1/me/notifications", "", &inbox); code != 200 {
		t.Fatal("owner inbox status", code)
	}
	if len(inbox.Items) != 2 || inbox.Items[1].Kind != "dan_comment" || inbox.Items[1].Dan == nil || inbox.Items[1].Dan.Title["ja"] != "初段" || inbox.Items[1].Chart != nil {
		t.Fatalf("owner inbox %+v", inbox.Items)
	}
	c.do("alice", "GET", "/api/v1/me/notifications", "", &inbox)
	if len(inbox.Items) != 1 || inbox.Items[0].Kind != "comment_reply" || inbox.Items[0].Dan == nil {
		t.Fatalf("alice inbox %+v", inbox.Items)
	}
	// Karma counts others' votes on the course; the maker's own songs got none here.
	var space struct{ User PublicUser }
	c.do("", "GET", "/api/v1/users/d46774d30dd13b92d9e536808da468a4", "", &space)
	if space.User.Karma != 1 {
		t.Fatal("karma", space.User.Karma)
	}
	// A deleted course hides its comments, notices and votes.
	if _, err := s.DB.Exec(ctx, `UPDATE dan_courses SET status='deleted' WHERE id=$1`, dan); err != nil {
		t.Fatal(err)
	}
	if code := c.do("", "GET", path+"/comments", "", nil); code != 404 {
		t.Fatal("deleted course comments", code)
	}
	if code := c.do("", "GET", "/api/v1/comments/"+top.ID, "", nil); code != 404 {
		t.Fatal("deleted course thread", code)
	}
	c.do("owner", "GET", "/api/v1/me/notifications", "", &inbox)
	if len(inbox.Items) != 1 || inbox.Items[0].Kind != "chart_comment" {
		t.Fatalf("notices after deletion %+v", inbox.Items)
	}
	c.do("", "GET", "/api/v1/users/5f0c4a0b0e7b4d3c9a6f1e2d3c4b5a69/comments", "", &history)
	if len(history.Items) != 0 {
		t.Fatal("history after deletion", len(history.Items))
	}
}
