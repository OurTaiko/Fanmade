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
	"time"
)

// ProfileConfig is how this service asks OurTaikoProfile (profile.ourtaiko.org) for the
// titles and 段位 badges a 段位 attempt earns: its address and this service's key there
// (registered with ourtaiko-profile -register-service).
type ProfileConfig struct {
	URL, ServiceID, ServiceKey string
}

// ProfileClient calls POST /internal/v1/awards.
type ProfileClient struct {
	config ProfileConfig
	http   *http.Client
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
	if res.StatusCode != 200 || !json.Valid(body) {
		return nil, fmt.Errorf("OurTaikoProfile answered HTTP %d", res.StatusCode)
	}
	return body, nil
}
