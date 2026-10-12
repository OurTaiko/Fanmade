// migrate-storage copies a database/file snapshot into an isolated S3 prefix.
// It never deletes source files or replaces an existing object with different bytes.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"strings"
	"time"

	"github.com/aws/smithy-go"
	"github.com/jackc/pgx/v5/pgxpool"
	"ourtaiko.dev/fanmade/api/internal/database"
	"ourtaiko.dev/fanmade/api/internal/objectstore"
)

type entry struct {
	ID, Key, Name, Media, SHA string
	Size                      int64
	Data                      []byte
}
type migrator struct {
	ctx              context.Context
	store            *objectstore.S3
	copied, verified int
	bytes            int64
	apply            bool
}

func (m *migrator) copy(v entry, r io.ReadSeeker) error {
	h := sha256.New()
	n, e := io.Copy(h, r)
	if e != nil {
		return e
	}
	if n != v.Size || hex.EncodeToString(h.Sum(nil)) != v.SHA {
		return fmt.Errorf("source integrity mismatch: %s", v.Key)
	}
	if !m.apply {
		return nil
	}
	if _, e = r.Seek(0, io.SeekStart); e != nil {
		return e
	}
	if e = m.store.Put(m.ctx, v.Key, r, v.Size, v.Media, v.SHA); e != nil {
		var api smithy.APIError
		if !errors.As(e, &api) || api.ErrorCode() != "PreconditionFailed" {
			return e
		}
	} else {
		m.copied++
	}
	// Read back every byte, including on retries. Metadata alone is not proof.
	object, e := m.store.Open(m.ctx, v.Key)
	if e != nil {
		return e
	}
	defer object.Close()
	h.Reset()
	n, e = io.Copy(h, object)
	if e != nil {
		return e
	}
	if n != v.Size || hex.EncodeToString(h.Sum(nil)) != v.SHA {
		return fmt.Errorf("destination integrity mismatch (not overwritten): %s", v.Key)
	}
	m.verified++
	m.bytes += n
	return nil
}
func main() {
	if e := run(); e != nil {
		log.Fatal(e)
	}
}
func run() error {
	source := flag.String("source", "", "snapshot file directory")
	bucket := flag.String("bucket", "", "destination bucket")
	region := flag.String("region", "", "destination region")
	prefix := flag.String("prefix", "", "isolated destination prefix")
	apply := flag.Bool("apply", false, "copy and read back all objects (default: inventory/source verification only)")
	activate := flag.Bool("activate", false, "migrate and activate S3 metadata in a database ending _s3_test")
	flag.Parse()
	if *source == "" {
		return errors.New("source snapshot directory required")
	}
	if *activate && !*apply {
		return errors.New("activate requires apply")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
	defer cancel()
	db, e := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if e != nil {
		return e
	}
	defer db.Close()
	if *activate {
		var name string
		if e = db.QueryRow(ctx, `SELECT current_database()`).Scan(&name); e != nil {
			return e
		}
		if !strings.HasSuffix(name, "_s3_test") {
			return errors.New("activation is restricted to a dedicated _s3_test database")
		}
		if e = database.Migrate(ctx, db, *source); e != nil {
			return e
		}
	}
	store, e := objectstore.NewS3(ctx, *bucket, *region, *prefix)
	if e != nil {
		return e
	}
	m := migrator{ctx: ctx, store: store, apply: *apply}
	var simplified bool
	if e = db.QueryRow(ctx, `SELECT to_regclass('chart_resources') IS NOT NULL`).Scan(&simplified); e != nil {
		return e
	}
	flat, e := independentFiles(ctx, db)
	if e != nil {
		return e
	}
	inventory := `SELECT id,storage_key,original_filename,media_type,sha256,byte_size FROM files ORDER BY storage_key`
	if simplified {
		inventory = `SELECT chart_id,storage_key,original_filename,media_type,sha256,byte_size FROM chart_resources WHERE kind<>'archive' ORDER BY storage_key`
	}
	if flat {
		inventory = `SELECT id::text,storage_key,original_filename,CASE extension WHEN 'ogg' THEN 'audio/ogg' WHEN 'mp3' THEN 'audio/mpeg' WHEN 'webp' THEN 'image/webp' ELSE 'application/octet-stream' END,sha256,byte_size
 FROM chart_resources ORDER BY storage_key`
	}
	rows, e := db.Query(ctx, inventory)
	if e != nil {
		return e
	}
	var files []entry
	for rows.Next() {
		var v entry
		if e = rows.Scan(&v.ID, &v.Key, &v.Name, &v.Media, &v.SHA, &v.Size); e != nil {
			rows.Close()
			return e
		}
		files = append(files, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	local := objectstore.Local{Root: *source}
	for _, v := range files {
		f, e := local.Open(ctx, v.Key)
		if e != nil {
			return e
		}
		e = m.copy(v, f)
		f.Close()
		if e != nil {
			return e
		}
	}
	coversQuery := `SELECT id,webp,sha256 FROM chart_covers ORDER BY id`
	if simplified {
		coversQuery = `SELECT NULL::text,NULL::bytea,NULL::text WHERE false`
	}
	rows, e = db.Query(ctx, coversQuery)
	if e != nil {
		return e
	}
	var covers []entry
	for rows.Next() {
		var v entry
		if e = rows.Scan(&v.ID, &v.Data, &v.SHA); e != nil {
			rows.Close()
			return e
		}
		if v.Data == nil {
			rows.Close()
			return errors.New("migration requires original cover bytes retained in snapshot")
		}
		v.Key = "covers/" + v.ID + "/cover.webp"
		v.Size = int64(len(v.Data))
		v.Media = "image/webp"
		covers = append(covers, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, v := range covers {
		if e = m.copy(v, bytes.NewReader(v.Data)); e != nil {
			return e
		}
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"files": len(files), "covers": len(covers), "uploaded": m.copied, "verified": m.verified, "verifiedBytes": m.bytes, "activated": *activate, "applied": *apply})
}

// independentFiles reports whether the snapshot is at schema 038 or later,
// where charts reference chart_resources rows by ID.
func independentFiles(ctx context.Context, db *pgxpool.Pool) (bool, error) {
	var flat bool
	e := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='charts' AND column_name='tja_file')`).Scan(&flat)
	return flat, e
}
