package httpapi

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"ourtaiko.dev/sitekit/audio"
	"ourtaiko.dev/sitekit/objectstore"
	"ourtaiko.dev/sitekit/video"
	"time"
)

// resourceLink tells a client where to download one stored file and how to
// verify it.
type resourceLink struct {
	URL         string `json:"url"`
	HeadURL     string `json:"headUrl"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
}

// directLink is the public address of an object, or one signed for 15 minutes
// when the bucket has no public address.
func directLink(ctx context.Context, remote *objectstore.S3, key, name, media, digest string, size int64) (resourceLink, error) {
	public, e := remote.PublicURL(key)
	if e != nil || public != "" {
		return resourceLink{public, public, digest, size, media}, e
	}
	get, e := remote.Sign(ctx, key, "GET", name, media, 15*time.Minute)
	if e != nil {
		return resourceLink{}, e
	}
	head, e := remote.Sign(ctx, key, "HEAD", name, media, 15*time.Minute)
	return resourceLink{get, head, digest, size, media}, e
}

// Resolve current resources before download. Never forward API credentials to the object host.
func (s *Server) resourceLinks(w http.ResponseWriter, r *http.Request) {
	remote, ok := s.Config.Objects.(*objectstore.S3)
	if !ok {
		problem(w, 404, "DIRECT_DOWNLOAD_UNAVAILABLE", "此服务器尚未启用直连下载")
		return
	}
	// Keep every key/hash/size from one committed upload, even if a replacement
	// commits while the manifest is being assembled.
	tx, e := s.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	c, e := s.readChart(tx.QueryRow(r.Context(), chartSelect+` WHERE c.id=$1 AND `+publishedChart, r.PathValue("id")))
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在或已下架")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	resources := map[string]resourceLink{}
	add := func(kind, key, name, media, digest string, size int64) error {
		link, e := directLink(r.Context(), remote, key, name, media, digest, size)
		resources[kind] = link
		return e
	}
	var tjaSize int64
	if e = tx.QueryRow(r.Context(), `SELECT r.byte_size FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, c.ID).Scan(&tjaSize); e != nil {
		internal(w, e)
		return
	}
	if e = add("tja", c.TJAKey, c.TJAName, "application/octet-stream", c.TJAHash, tjaSize); e != nil {
		internal(w, e)
		return
	}
	if e = add("audio", c.AudioKey, c.AudioName, audio.MediaType(c.AudioName), c.AudioHash, c.AudioSize); e != nil {
		internal(w, e)
		return
	}
	var key, digest string
	var size int64
	var coverKey *string
	var coverHash string
	var coverSize *int64
	e = tx.QueryRow(r.Context(), `SELECT r.storage_key,r.sha256,r.byte_size FROM charts c JOIN chart_resources r ON r.id=c.cover_file WHERE c.id=$1`, c.ID).Scan(&coverKey, &coverHash, &coverSize)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		internal(w, e)
		return
	}
	if e == nil && coverKey != nil && coverSize != nil {
		if e = add("cover", *coverKey, "cover.webp", "image/webp", coverHash, *coverSize); e != nil {
			internal(w, e)
			return
		}
	}
	e = tx.QueryRow(r.Context(), `SELECT r.storage_key,r.sha256,r.byte_size FROM charts c JOIN chart_resources r ON r.id=c.preview_file WHERE c.id=$1`, c.ID).Scan(&key, &digest, &size)
	if e != nil && !errors.Is(e, pgx.ErrNoRows) {
		internal(w, e)
		return
	}
	if e == nil {
		if e = add("preview", key, "preview.ogg", "audio/ogg", digest, size); e != nil {
			internal(w, e)
			return
		}
	}

	if c.MovieKey != "" {
		if e = add("movie", c.MovieKey, c.MovieHash+"."+video.Extension, video.MediaType, c.MovieHash, c.MovieSize); e != nil {
			internal(w, e)
			return
		}
	}

	if e = tx.Commit(r.Context()); e != nil {
		internal(w, e)
		return
	}
	public, _ := remote.PublicURL(c.TJAKey)
	respond(w, 200, map[string]any{"urlsExpire": public == "", "chartId": c.ID, "resources": resources})
}
