package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
)

func TestChartCollaborations(t *testing.T) {
	c, s := interactionFixture(t)
	const alice = "9b893bc6d9422c93536ff0df503b81e9"
	const bob = "5f0c4a0b0e7b4d3c9a6f1e2d3c4b5a69"
	invite := func(user, chart, recipient string, want int) {
		t.Helper()
		if code := c.do(user, "POST", "/api/v1/charts/"+chart+"/collaborations", fmt.Sprintf(`{"userId":%q}`, recipient), nil); code != want {
			t.Fatalf("invite %s: %d want %d", user, code, want)
		}
	}
	invite("", "song", alice, 401)
	invite("bob", "song", alice, 403)
	invite("admin", "song", alice, 403)
	invite("owner", "missing", alice, 404)
	invite("owner", "song", "invalid", 400)
	invite("owner", "song", strings.Repeat("f", 32), 404)
	invite("owner", "song", "d46774d30dd13b92d9e536808da468a4", 409)
	invite("owner", "song", alice, 201)
	invite("owner", "song", alice, 200)
	var notices NotificationPage
	if code := c.do("alice", "GET", "/api/v1/me/notifications", "", &notices); code != 200 || len(notices.Items) != 1 {
		t.Fatalf("notices %d %+v", code, notices)
	}
	n := notices.Items[0]
	if n.Kind != "chart_collaboration" || n.Data["status"] != "pending" {
		t.Fatalf("notice %+v", n)
	}
	path := "/api/v1/me/notifications/" + n.ID + "/respond"
	if code := c.do("alice", "PATCH", "/api/v1/charts/song", `{"description":"not yet"}`, nil); code != 403 {
		t.Fatal("pending invitation grants edits", code)
	}
	if code := c.do("bob", "POST", path, `{"accept":true}`, nil); code != 404 {
		t.Fatal("other recipient", code)
	}
	if code := c.do("alice", "POST", path, `{}`, nil); code != 400 {
		t.Fatal("missing choice", code)
	}
	r := httptest.NewRequest("POST", path, strings.NewReader(`{"accept":true}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://localhost")
	r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: c.tokens["alice"]})
	w := httptest.NewRecorder()
	c.handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("missing csrf", w.Code)
	}
	if code := c.do("alice", "DELETE", "/api/v1/me/notifications/"+n.ID, `{}`, nil); code != 404 {
		t.Fatal("dismissed actionable invitation", code)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 4)
	for range 4 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- c.do("alice", "POST", path, `{"accept":true}`, nil) }()
	}
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 {
			t.Fatal("concurrent accept", code)
		}
	}
	var chart Chart
	if code := c.do("alice", "GET", "/api/v1/charts/song", "", &chart); code != 200 || len(chart.OwnerIDs) != 2 || !chart.hasOwner(alice) || len(chart.Owners) != 2 {
		t.Fatalf("accepted chart: %d %+v", code, chart)
	}
	if code := c.do("alice", "POST", path, `{"accept":false}`, nil); code != 409 {
		t.Fatal("reversed accepted invitation", code)
	}
	invite("owner", "song", alice, 409)
	var mine struct {
		Items []Chart
		Total int
	}
	if code := c.do("alice", "GET", "/api/v1/me/charts", "", &mine); code != 200 || mine.Total != 1 || len(mine.Items) != 1 || mine.Items[0].ID != "song" {
		t.Fatalf("co-owner library %d %+v", code, mine)
	}
	if code := c.do("", "GET", "/api/v1/charts?owner="+alice, "", &mine); code != 200 || mine.Total != 1 {
		t.Fatal("owner filter", code, mine.Total)
	}
	var space UserSpace
	if code := c.do("", "GET", "/api/v1/users/"+alice, "", &space); code != 200 || space.User.ChartCount != 1 {
		t.Fatal("co-owner chart count", code, space)
	}
	if code := c.do("alice", "PATCH", "/api/v1/charts/song", `{"description":"co-created"}`, nil); code != 200 {
		t.Fatal("co-owner metadata", code)
	}
	invite("alice", "song", bob, 201)
	c.do("bob", "GET", "/api/v1/me/notifications", "", &notices)
	declined := "/api/v1/me/notifications/" + notices.Items[0].ID + "/respond"
	for range 2 {
		if code := c.do("bob", "POST", declined, `{"accept":false}`, nil); code != 200 {
			t.Fatal("decline", code)
		}
	}
	if code := c.do("bob", "POST", declined, `{"accept":true}`, nil); code != 409 {
		t.Fatal("accept declined", code)
	}
	c.do("bob", "GET", "/api/v1/charts/song", "", &chart)
	if chart.hasOwner(bob) {
		t.Fatal("decline granted ownership")
	}
	// All owners receive comments; a co-owner's own action does not notify them.
	if code := c.do("bob", "POST", "/api/v1/charts/song/comments", `{"body":"Both owners should see this"}`, nil); code != 201 {
		t.Fatal("comment", code)
	}
	for _, user := range []string{"owner", "alice"} {
		c.do(user, "GET", "/api/v1/me/notifications", "", &notices)
		found := false
		for _, n := range notices.Items {
			if n.Kind == "chart_comment" {
				found = true
			}
		}
		if !found {
			t.Fatal("missing co-owner notice", user)
		}
	}
	// Pending invitations cannot survive deleting their chart.
	invite("alice", "song", bob, 201)
	c.do("bob", "GET", "/api/v1/me/notifications", "", &notices)
	pending := ""
	for _, n := range notices.Items {
		if n.Kind == "chart_collaboration" && n.Data["status"] == "pending" {
			pending = n.ID
		}
	}
	if pending == "" {
		t.Fatal("missing pending invite")
	}
	if code := c.do("alice", "DELETE", "/api/v1/charts/song", `{}`, nil); code != 200 {
		t.Fatal("co-owner delete", code)
	}
	if code := c.do("bob", "POST", "/api/v1/me/notifications/"+pending+"/respond", `{"accept":true}`, nil); code != 404 {
		t.Fatal("accepted deleted chart", code)
	}
	var count int
	if e := s.DB.QueryRow(context.Background(), `SELECT count(*) FROM chart_collaborations WHERE chart_id='song'`).Scan(&count); e != nil || count != 0 {
		t.Fatal("orphan invitations", count, e)
	}
}

func TestConcurrentCollaboratorInvitations(t *testing.T) {
	c, s := interactionFixture(t)
	const alice = "9b893bc6d9422c93536ff0df503b81e9"
	var wg sync.WaitGroup
	codes := make(chan int, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes <- c.do("owner", "POST", "/api/v1/charts/song/collaborations", `{"userId":"`+alice+`"}`, nil)
		}()
	}
	wg.Wait()
	close(codes)
	created := 0
	for code := range codes {
		if code == 201 {
			created++
		}
		if !slices.Contains([]int{200, 201}, code) {
			t.Fatal(code)
		}
	}
	if created != 1 {
		t.Fatal("duplicate pending invitations", created)
	}
	var count int
	if e := s.DB.QueryRow(context.Background(), `SELECT count(*) FROM notifications WHERE kind='chart_collaboration'`).Scan(&count); e != nil || count != 1 {
		t.Fatal(count, e)
	}
}
