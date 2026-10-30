package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/sitekit/audio"
	"ourtaiko.dev/sitekit/tja"
)

// Files stored before schema 038 keep their original keys until rekeyed.
const legacyFile = `r.storage_key<>r.sha256||'.'||r.extension`

type storedFile struct {
	id                        *int64
	key, name, sha, extension string
	size                      int64
}

func (f storedFile) legacy() bool { return f.id != nil && f.key != f.sha+"."+f.extension }

// fetch copies a stored file into path and verifies it against its record.
func (s *Server) fetch(ctx context.Context, f storedFile, path string) error {
	in, err := s.Config.Objects.Open(ctx, f.key)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(in, f.size+1))
	if err = errors.Join(err, out.Close()); err != nil {
		return err
	}
	if n != f.size || hex.EncodeToString(h.Sum(nil)) != f.sha {
		return fmt.Errorf("stored file integrity mismatch: %s", f.key)
	}
	return nil
}

// RekeyFiles moves every chart's pre-038 files to {sha256}.{extension} keys and
// points its TJA at the content-addressed audio name. It resumes on startup
// and retries failures on later passes. Row locks serialize with replacements.
func (s *Server) RekeyFiles(ctx context.Context) error {
	rows, err := s.DB.Query(ctx, `SELECT c.id FROM charts c WHERE EXISTS(SELECT 1 FROM chart_resources r
 WHERE r.id IN (c.tja_file,c.audio_file,c.cover_file,c.preview_file) AND `+legacyFile+`) ORDER BY c.id`)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	var failures []error
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.rekeyChart(ctx, id); err != nil {
			log.Printf("file rekey for %s failed: %v", id, err)
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (s *Server) rekeyChart(parent context.Context, id string) error {
	ctx, cancel := context.WithTimeout(parent, 10*time.Minute)
	defer cancel()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var locked string
	err = tx.QueryRow(ctx, `SELECT id FROM charts WHERE id=$1 FOR UPDATE SKIP LOCKED`, id).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Read file rows in a fresh snapshot after taking the lock.
	columns := []string{"tja_file", "audio_file", "cover_file", "preview_file"}
	files := map[string]storedFile{}
	for _, column := range columns {
		var f storedFile
		err = tx.QueryRow(ctx, `SELECT r.id,r.storage_key,r.original_filename,r.sha256,r.extension,r.byte_size FROM charts c JOIN chart_resources r ON r.id=c.`+column+` WHERE c.id=$1`, id).
			Scan(&f.id, &f.key, &f.name, &f.sha, &f.extension, &f.size)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		files[column] = f
	}
	dir, err := os.MkdirTemp(s.Config.Storage, "staging-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	ids := map[string]*int64{}
	for _, column := range columns {
		ids[column] = files[column].id
	}
	store := func(column, path, name, extension, media, digest string, size int64) error {
		file, err := s.storeFile(ctx, tx, path, name, extension, media, digest, size)
		ids[column] = &file
		return err
	}
	t, a := files["tja_file"], files["audio_file"]
	if t.legacy() || a.legacy() {
		// The TJA changes with its audio's name.
		tjaPath, audioPath := filepath.Join(dir, "tja"), filepath.Join(dir, "audio")
		if err = errors.Join(s.fetch(ctx, t, tjaPath), s.fetch(ctx, a, audioPath)); err != nil {
			return err
		}
		data, err := os.ReadFile(tjaPath)
		if err != nil {
			return err
		}
		waveName := a.sha + "." + a.extension
		data, ok := tja.SetWave(data, waveName)
		if !ok {
			return errors.New("stored TJA has no WAVE header")
		}
		if len(data) > tja.MaxTJA {
			return errors.New("rewritten TJA exceeds limit")
		}
		if err = os.WriteFile(tjaPath, data, 0600); err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		digest := hex.EncodeToString(sum[:])
		if err = store("tja_file", tjaPath, t.name, "tja", "application/octet-stream", digest, int64(len(data))); err != nil {
			return err
		}
		if err = store("audio_file", audioPath, a.name, a.extension, audio.MediaType(a.name), a.sha, a.size); err != nil {
			return err
		}
		// Keep upload retries recognizing this chart's files as their result.
		if _, err = tx.Exec(ctx, `UPDATE upload_requests SET tja_sha256=$3 WHERE chart_id=$1 AND tja_sha256=$2`, id, t.sha, digest); err != nil {
			return err
		}
	}
	for _, v := range [][2]string{{"cover_file", "image/webp"}, {"preview_file", "audio/ogg"}} {
		column, media := v[0], v[1]
		f := files[column]
		if !f.legacy() {
			continue
		}
		path := filepath.Join(dir, column)
		if err = s.fetch(ctx, f, path); err != nil {
			return err
		}
		if err = store(column, path, f.name, f.extension, media, f.sha, f.size); err != nil {
			return err
		}
	}
	// The chart trigger queues the previous files for deletion.
	if _, err = tx.Exec(ctx, `UPDATE charts SET tja_file=$2,audio_file=$3,cover_file=$4,preview_file=$5 WHERE id=$1`,
		id, ids["tja_file"], ids["audio_file"], ids["cover_file"], ids["preview_file"]); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) RunFileRekey(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		if err := s.RekeyFiles(ctx); err != nil && ctx.Err() == nil {
			log.Printf("file rekey pending: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
