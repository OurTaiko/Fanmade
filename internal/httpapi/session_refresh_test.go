package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWebSessionRenewal(t *testing.T) {
	pool := scoreTestDB(t)
	app := testServer(t, pool, Config{Origin: "http://localhost"})
	ctx := context.Background()
	id := ID()
	if _, err := pool.Exec(ctx, `INSERT INTO users(id) VALUES($1)`, id); err != nil {
		t.Fatal(err)
	}
	var rotations atomic.Int32
	var mode atomic.Int32
	var issuer string
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			respond(w, 200, map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys"})
		case "/token":
			rotations.Add(1)
			if err := r.ParseForm(); err != nil {
				t.Error(err)
			}
			if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "refresh-old" {
				t.Error("incorrect renewal request")
			}
			if mode.Load() == 1 {
				respond(w, 503, map[string]string{"error": "temporarily_unavailable"})
				return
			}
			if mode.Load() == 2 {
				respond(w, 400, map[string]string{"error": "invalid_grant"})
				return
			}
			respond(w, 200, map[string]any{"access_token": "access-new", "refresh_token": "refresh-new", "expires_in": 3600, "token_type": "Bearer"})
		case "/internal/v1/web/introspect":
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			if mode.Load() == 3 {
				w.WriteHeader(401)
				return
			}
			if in["accessToken"] != "access-new" {
				t.Error("used expired credential")
			}
			respond(w, 200, map[string]any{"user": User{ID: id}})
		case "/internal/v1/web/revoke":
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in["refreshToken"] != "refresh-new" {
				t.Error("logout failed to revoke latest refresh credential")
			}
			respond(w, 200, map[string]bool{"ok": true})
		default:
			w.WriteHeader(404)
		}
	}))
	defer remote.Close()
	issuer = remote.URL
	app.Config.SSO.config.Issuer = issuer
	app.Config.SSO.http = remote.Client()
	h := app.Handler()
	seed := func() string {
		t.Helper()
		cookie := ID() + ID()
		digest := hash(cookie)
		_, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,upstream_token,upstream_refresh_token,upstream_expires_at) VALUES($1,$2,'csrf',now()+interval '7 days',$3,$4,now()-interval '2 days')`, digest, id, app.Config.SSO.seal("access-old", digest), app.Config.SSO.seal("refresh-old", "refresh:"+digest))
		if err != nil {
			t.Fatal(err)
		}
		return cookie
	}
	call := func(cookie, method, path string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(`{}`))
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", "csrf")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	t.Run("parallel tabs renew once after days away", func(t *testing.T) {
		cookie := seed()
		var before, after time.Time
		_ = pool.QueryRow(ctx, `SELECT expires_at FROM sessions WHERE token_hash=$1`, hash(cookie)).Scan(&before)
		var wg sync.WaitGroup
		for range 12 {
			wg.Go(func() {
				w := call(cookie, "GET", "/api/v1/me")
				if w.Code != 200 || !strings.Contains(w.Body.String(), id) {
					t.Errorf("renew failed: %d %s", w.Code, w.Body.String())
				}
			})
		}
		wg.Wait()
		if rotations.Load() != 1 {
			t.Fatal("multiple rotations", rotations.Load())
		}
		var encrypted []byte
		if err := pool.QueryRow(ctx, `SELECT expires_at,upstream_refresh_token FROM sessions WHERE token_hash=$1`, hash(cookie)).Scan(&after, &encrypted); err != nil {
			t.Fatal(err)
		}
		plain, err := app.Config.SSO.unseal(encrypted, "refresh:"+hash(cookie))
		if err != nil || plain != "refresh-new" || !before.Equal(after) {
			t.Fatal("lost rotation or extended absolute deadline")
		}
		if w := call(cookie, "POST", "/api/v1/auth/logout"); w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		if w := call(cookie, "GET", "/api/v1/me"); !strings.Contains(w.Body.String(), `"user":null`) {
			t.Fatal("logout did not invalidate local session")
		}
	})
	t.Run("temporary outage is retryable", func(t *testing.T) {
		cookie := seed()
		mode.Store(1)
		if w := call(cookie, "GET", "/api/v1/me"); w.Code != 503 {
			t.Fatal(w.Code, w.Body.String())
		}
		mode.Store(0)
		if w := call(cookie, "GET", "/api/v1/me"); w.Code != 200 || !strings.Contains(w.Body.String(), id) {
			t.Fatal(w.Code, w.Body.String())
		}
	})
	t.Run("revoked refresh token cannot renew", func(t *testing.T) {
		cookie := seed()
		mode.Store(2)
		defer mode.Store(0)
		if w := call(cookie, "GET", "/api/v1/me"); w.Code != 200 || !strings.Contains(w.Body.String(), `"user":null`) {
			t.Fatal(w.Code, w.Body.String())
		}
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE token_hash=$1`, hash(cookie)).Scan(&n)
		if n != 0 {
			t.Fatal("invalid grant retained")
		}
	})
	t.Run("seven day deadline is enforced", func(t *testing.T) {
		cookie := seed()
		_, err := pool.Exec(ctx, `UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`, hash(cookie))
		if err != nil {
			t.Fatal(err)
		}
		before := rotations.Load()
		if w := call(cookie, "GET", "/api/v1/me"); !strings.Contains(w.Body.String(), `"user":null`) {
			t.Fatal(w.Body.String())
		}
		if rotations.Load() != before {
			t.Fatal("renewed past deadline")
		}
	})
	t.Run("revoked live access token cannot trigger renewal", func(t *testing.T) {
		cookie := seed()
		_, err := pool.Exec(ctx, `UPDATE sessions SET upstream_expires_at=now()+interval '1 hour' WHERE token_hash=$1`, hash(cookie))
		if err != nil {
			t.Fatal(err)
		}
		mode.Store(3)
		defer mode.Store(0)
		before := rotations.Load()
		if w := call(cookie, "GET", "/api/v1/me"); !strings.Contains(w.Body.String(), `"user":null`) {
			t.Fatal(w.Body.String())
		}
		if rotations.Load() != before {
			t.Fatal("revocation bypass")
		}
	})
}
