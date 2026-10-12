package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/objectstore"
)

// Matches a chart_resources row r that some chart or playlist still refers to.
const referencedFile = `(EXISTS(SELECT 1 FROM charts c WHERE c.tja_file=r.id OR c.audio_file=r.id OR c.cover_file=r.id OR c.preview_file=r.id OR c.movie_file=r.id)
 OR EXISTS(SELECT 1 FROM playlists p WHERE p.cover_file=r.id OR p.game_cover_file=r.id))`

func (s *Server) remoteStorage() bool { _, ok := s.Config.Objects.(*objectstore.S3); return ok }

// fileExtension is the stored form: lowercase, without the dot.
func fileExtension(name string) string {
	return strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
}

// Identical files share one object, so writers and the cleaner serialize on
// its key until tx ends. Without this the cleaner could delete an object that
// an uncommitted upload is about to reference.
func lockObject(ctx context.Context, tx pgx.Tx, key string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "object:"+key)
	return e
}

// storeFile stores path as {sha256}.{extension} and returns its file ID,
// reusing the record and object of identical content. The first registered
// name is kept. The caller references the ID in tx.
func (s *Server) storeFile(ctx context.Context, tx pgx.Tx, path, name, extension, media, digest string, size int64) (int64, error) {
	key := digest + "." + extension
	if e := lockObject(ctx, tx, key); e != nil {
		return 0, e
	}
	if _, e := s.DB.Exec(ctx, `INSERT INTO pending_objects(storage_key) VALUES($1) ON CONFLICT DO NOTHING`, key); e != nil {
		return 0, e
	}
	stored, e := s.objectStored(ctx, key, size)
	if e != nil {
		return 0, e
	}
	if !stored {
		f, e := os.Open(path)
		if e != nil {
			return 0, e
		}
		e = s.Config.Objects.Put(ctx, key, f, size, media, digest)
		f.Close()
		if e != nil {
			return 0, e
		}
	}
	var id int64
	e = tx.QueryRow(ctx, `INSERT INTO chart_resources(storage_key,original_filename,sha256,byte_size,extension) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(storage_key) DO UPDATE SET storage_key=EXCLUDED.storage_key RETURNING id`, key, name, digest, size, extension).Scan(&id)
	return id, e
}

// fileDigest returns the SHA-256 and size of a staged file.
func fileDigest(path string) (string, int64, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", 0, e
	}
	defer f.Close()
	h := sha256.New()
	n, e := io.Copy(h, f)
	return hex.EncodeToString(h.Sum(nil)), n, e
}

// objectStored reports whether key already holds the complete object. The
// caller holds its lock; an interrupted local write is removed for rewriting.
func (s *Server) objectStored(ctx context.Context, key string, size int64) (bool, error) {
	f, e := s.Config.Objects.Open(ctx, key)
	if errors.Is(e, os.ErrNotExist) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	complete := f.Size() == size
	f.Close()
	if complete {
		return true, nil
	}
	return false, s.Config.Objects.Delete(ctx, key)
}

func (s *Server) reconcilePending(ctx context.Context) error {
	// Only age out abandoned writes after a full day. A commit with an unknown
	// outcome is resolved against live references before any object is retired.
	_, e := s.DB.Exec(ctx, `WITH settled AS (
 DELETE FROM pending_objects p WHERE p.created_at<now()-interval '1 day' RETURNING storage_key
 ) INSERT INTO retired_files(storage_key)
 SELECT storage_key FROM settled p WHERE
 NOT EXISTS(SELECT 1 FROM chart_resources r WHERE r.storage_key=p.storage_key)
 ON CONFLICT DO NOTHING`)
	return e
}
