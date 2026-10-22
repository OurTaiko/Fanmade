package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ProfileConfig is how this service asks OurTaikoProfile (profile.ourtaiko.org) for the
// titles and 段位 badges a 段位 attempt earns: its address and this service's key there
// (registered with ourtaiko-profile -register-service).
type ProfileConfig struct {
	URL, ServiceID, ServiceKey string
}

// ProfileClient calls POST /internal/v1/awards and reads the title catalog.
type ProfileClient struct {
	config ProfileConfig
	http   *http.Client

	mu       sync.Mutex
	titles   map[string]ProfileTitle
	titlesAt time.Time
}

func NewProfile(cfg ProfileConfig) (*ProfileClient, error) {
	u, err := url.Parse(cfg.URL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))) {
		return nil, errors.New("PROFILE_URL must use HTTPS (HTTP is allowed on loopback only)")
	}
	if !validServiceCredential(cfg.ServiceID, 1, 40) || !validServiceCredential(cfg.ServiceKey, 32, 1024) {
		return nil, errors.New("PROFILE_SERVICE_ID and PROFILE_SERVICE_KEY are required with PROFILE_URL")
	}
	cfg.URL = strings.TrimRight(cfg.URL, "/")
	return &ProfileClient{config: cfg, http: &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

// AwardRequest is one 段位 attempt as Profile records it.
type AwardRequest struct {
	Key         string   `json:"key"`
	UserID      string   `json:"userId"`
	CourseID    string   `json:"courseId"`
	CourseTitle string   `json:"courseTitle"`
	CourseOwner string   `json:"courseOwnerId"`
	Official    bool     `json:"official"`
	Verdict     int      `json:"verdict"`
	Dan         *int     `json:"dan"`
	Titles      []string `json:"titles"`
}

// Award asks Profile for what an attempt earns: its reply (granted and the new nameplate).
func (c *ProfileClient) Award(ctx context.Context, request AwardRequest) (json.RawMessage, error) {
	data, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.config.URL+"/internal/v1/awards", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-ID", c.config.ServiceID)
	req.Header.Set("X-Service-Key", c.config.ServiceKey)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, errors.New("OurTaikoProfile unreachable")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode == 400 || res.StatusCode == 409 || res.StatusCode == 422 {
		var problem struct {
			Code string `json:"code"`
		}
		json.Unmarshal(body, &problem)
		return nil, &ProfileRejection{Status: res.StatusCode, Code: problem.Code}
	}
	if res.StatusCode != 200 || !json.Valid(body) {
		return nil, fmt.Errorf("OurTaikoProfile answered HTTP %d", res.StatusCode)
	}
	return body, nil
}

// ProfileRejection is Profile turning an award down for good because the request itself is
// wrong, unlike Profile being unreachable or failing for a while: asking again cannot help.
type ProfileRejection struct {
	Status int
	Code   string
}

func (e *ProfileRejection) Error() string {
	return fmt.Sprintf("OurTaikoProfile rejected the award: HTTP %d %s", e.Status, e.Code)
}

// ProfileTitle is what a course needs to know of a title of Profile's catalog: whether it is
// official, and the player who made it (none for the titles Profile's administrators keep).
type ProfileTitle struct {
	ID       string  `json:"id"`
	Official bool    `json:"official"`
	OwnerID  *string `json:"ownerId"`
}

// Titles is Profile's title catalog (GET /api/v1/titles) by id, kept for a minute; fresh reads
// it again.
func (c *ProfileClient) Titles(ctx context.Context, fresh bool) (map[string]ProfileTitle, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !fresh && c.titles != nil && time.Since(c.titlesAt) < time.Minute {
		return c.titles, nil
	}
	req, err := http.NewRequestWithContext(ctx, "GET", c.config.URL+"/api/v1/titles", nil)
	if err != nil {
		return nil, err
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, errors.New("OurTaikoProfile unreachable")
	}
	defer res.Body.Close()
	var catalog struct {
		Titles []ProfileTitle `json:"titles"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&catalog) != nil {
		return nil, fmt.Errorf("OurTaikoProfile answered HTTP %d", res.StatusCode)
	}
	titles := make(map[string]ProfileTitle, len(catalog.Titles))
	for _, title := range catalog.Titles {
		titles[title.ID] = title
	}
	c.titles, c.titlesAt = titles, time.Now()
	return titles, nil
}
