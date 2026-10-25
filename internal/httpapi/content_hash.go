package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/charthash"
	"ourtaiko.dev/fanmade/api/internal/constants"
	"ourtaiko.dev/fanmade/api/internal/tja"
)

// constantsColumnNames are chart_difficulties' difficulty-constant columns (migration 047), in
// the order constantsColumns gives their values.
const constantsColumnNames = `constants_version,raw_stamina,raw_handspeed,raw_burst,raw_complex,raw_complex_ratio,raw_rhythm,raw_rhythm_ratio,note_count`

// keepConstantsUnlessNew is the ON CONFLICT assignment that takes a block's new constants and
// keeps the stored ones when the new reading has none (all nine are NULL together).
const keepConstantsUnlessNew = `constants_version=COALESCE(EXCLUDED.constants_version,chart_difficulties.constants_version),
 raw_stamina=COALESCE(EXCLUDED.raw_stamina,chart_difficulties.raw_stamina),
 raw_handspeed=COALESCE(EXCLUDED.raw_handspeed,chart_difficulties.raw_handspeed),
 raw_burst=COALESCE(EXCLUDED.raw_burst,chart_difficulties.raw_burst),
 raw_complex=COALESCE(EXCLUDED.raw_complex,chart_difficulties.raw_complex),
 raw_complex_ratio=COALESCE(EXCLUDED.raw_complex_ratio,chart_difficulties.raw_complex_ratio),
 raw_rhythm=COALESCE(EXCLUDED.raw_rhythm,chart_difficulties.raw_rhythm),
 raw_rhythm_ratio=COALESCE(EXCLUDED.raw_rhythm_ratio,chart_difficulties.raw_rhythm_ratio),
 note_count=COALESCE(EXCLUDED.note_count,chart_difficulties.note_count)`

// constantsColumns are the values for constantsColumnNames: all NULL without constants.
func constantsColumns(raw *constants.Raw) []any {
	if raw == nil {
		return make([]any, 9)
	}
	return []any{constants.Version, raw.Stamina, raw.Handspeed, raw.Burst, raw.Complex, raw.ComplexRatio, raw.Rhythm, raw.RhythmRatio, raw.NoteCount}
}

// RunContentHashBackfill fills chart_difficulties.content_hash for charts stored before
// migration 046, or hashed by an older algorithm than the tool now reports, and the raw
// difficulty constants for blocks stored before migration 047 or computed by an older
// constants.Version; it adds the titles TJAParser reads (origin and every locale) to the title
// dictionaries, never removing a key. It runs after start-up, resumes on the next start, and
// leaves a block the tool cannot play NULL with a log line; the retire trigger ignores a hash
// set for the first time, and the constants touch no score.
func (s *Server) RunContentHashBackfill(ctx context.Context) {
	cli, ok := tja.Inspector.(charthash.CLI)
	if !ok {
		return
	}
	version, err := cli.Version(ctx)
	if err != nil {
		log.Printf("content hash backfill skipped: %v", err)
		return
	}
	if err := s.backfillContentHashes(ctx, version+":", constants.Version); err != nil && ctx.Err() == nil {
		log.Printf("content hash backfill: %v", err)
	}
}

func (s *Server) backfillContentHashes(ctx context.Context, prefix string, constantsVersion int) error {
	rows, err := s.DB.Query(ctx, `SELECT DISTINCT c.id FROM charts c JOIN chart_difficulties d ON d.chart_id=c.id
 WHERE c.status<>'deleted' AND (d.content_hash IS NULL OR left(d.content_hash,length($1))<>$1 OR d.constants_version IS DISTINCT FROM $2) ORDER BY c.id`, prefix, constantsVersion)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	log.Printf("content hash backfill: %d charts", len(ids))
	var failures []error
	done := 0
	for _, id := range ids {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := s.backfillChartHashes(ctx, id); err != nil {
			log.Printf("content hash backfill for %s failed: %v", id, err)
			failures = append(failures, err)
			continue
		}
		done++
	}
	log.Printf("content hash backfill: %d charts done, %d failed", done, len(failures))
	return errors.Join(failures...)
}

func (s *Server) backfillChartHashes(parent context.Context, id string) error {
	ctx, cancel := context.WithTimeout(parent, 2*time.Minute)
	defer cancel()
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var f storedFile
	err = tx.QueryRow(ctx, `SELECT r.id,r.storage_key,r.original_filename,r.sha256,r.extension,r.byte_size FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1 FOR UPDATE OF c SKIP LOCKED`, id).
		Scan(&f.id, &f.key, &f.name, &f.sha, &f.extension, &f.size)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	dir, err := os.MkdirTemp(s.Config.Storage, "hash-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "stored.tja")
	if err = s.fetch(ctx, f, path); err != nil {
		return err
	}
	result, err := tja.Inspector.Inspect(ctx, path)
	if err != nil {
		return err
	}
	for _, b := range result.Blocks {
		if b.Error != "" {
			log.Printf("content hash backfill: %s %s/%s cannot be played: %s", id, b.Name, b.Side, b.Error)
			continue
		}
		if b.Hash == "" {
			continue
		}
		if _, err = tx.Exec(ctx, `UPDATE chart_difficulties SET content_hash=$4 WHERE chart_id=$1 AND course=$2 AND side=$3 AND content_hash IS DISTINCT FROM $4`, id, b.Name, b.Side, b.Hash); err != nil {
			return err
		}
		raw, ok := constants.OfBlock(b.Notes)
		if !ok {
			continue
		}
		args := append([]any{id, b.Name, b.Side}, constantsColumns(&raw)...)
		if _, err = tx.Exec(ctx, `UPDATE chart_difficulties SET (`+constantsColumnNames+`)=($4,$5,$6,$7,$8,$9,$10,$11,$12)
 WHERE chart_id=$1 AND course=$2 AND side=$3`, args...); err != nil {
			return err
		}
	}
	// Titles: add what the file says (origin and every locale the game maps); keep every key
	// already stored, since an "en" written by the uploader cannot be told from a defaulted one.
	titles, _ := json.Marshal(result.Titles)
	subtitles, _ := json.Marshal(result.Subtitles)
	if _, err = tx.Exec(ctx, `UPDATE charts SET title_translations=COALESCE(title_translations,'{}'::jsonb)||$2::jsonb,
 subtitle_translations=COALESCE(subtitle_translations,'{}'::jsonb)||$3::jsonb WHERE id=$1`, id, titles, subtitles); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
