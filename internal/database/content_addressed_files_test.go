package database

import (
	"context"
	"fmt"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestContentAddressedFilesMigration(t *testing.T) {
	url := os.Getenv("DATABASE_TEST_URL")
	if url == "" {
		t.Skip("DATABASE_TEST_URL required")
	}
	ctx := context.Background()
	admin, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("files_migration_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA IF EXISTS "+name+", "+name+"_auth, "+name+"_internal CASCADE")
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = SchemaSearchPath(name)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	storage := t.TempDir()
	if err = migrateTo(ctx, pool, storage, 37); err != nil {
		t.Fatal(err)
	}
	// Both songs use one audio object; only the first has optional files.
	_, err = pool.Exec(ctx, `BEGIN;
 INSERT INTO users(id,username,password_hash) VALUES('owner','owner','unused');
 INSERT INTO charts(id,owner_ids,title,bpm,duration,wave_filename,difficulties) VALUES
  ('full',ARRAY['owner'],'Full',120,10,'Song.MP3','[{"course":"Oni","level":5,"maker":""}]'),
  ('bare',ARRAY['owner'],'Bare',120,10,'Song.MP3','[{"course":"Oni","level":5,"maker":""}]');
 INSERT INTO chart_resources(chart_id,kind,storage_key,original_filename,sha256,byte_size,media_type) VALUES
  ('full','tja','objects/full/1/tja','full.tja',repeat('1',64),11,'application/octet-stream'),
  ('full','audio','objects/shared/audio','Song.MP3',repeat('2',64),12,'audio/mpeg'),
  ('full','cover','covers/1/cover.webp','cover.webp',repeat('3',64),13,'image/webp'),
  ('full','preview','previews/full/1/preview.ogg','preview.ogg',repeat('4',64),14,'audio/ogg'),
  ('full','archive','archives/full/1/download.zip','download.zip',repeat('5',64),15,'application/zip'),
  ('bare','tja','objects/bare/1/tja','bare.tja',repeat('6',64),16,'application/octet-stream'),
  ('bare','audio','objects/shared/audio','Song.MP3',repeat('2',64),12,'audio/mpeg');
 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = Migrate(ctx, pool, storage); err != nil {
			t.Fatal(err)
		}
	}
	// Resolve file IDs to keys so the expectations stay readable.
	if _, err = pool.Exec(ctx, `CREATE FUNCTION file_key(bigint) RETURNS text LANGUAGE sql AS 'SELECT storage_key FROM chart_resources WHERE id=$1'`); err != nil {
		t.Fatal(err)
	}
	var files, references []string
	var waveColumn bool
	var retired int
	err = pool.QueryRow(ctx, `SELECT
	 (SELECT array_agg(storage_key||' '||original_filename||' '||left(sha256,1)||' '||byte_size||' '||extension ORDER BY storage_key) FROM chart_resources),
	 (SELECT array_agg(concat_ws(' ',file_key(tja_file),file_key(audio_file),COALESCE(file_key(cover_file),'-'),COALESCE(file_key(preview_file),'-')) ORDER BY id) FROM charts),
	 EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='charts' AND column_name='wave_filename'),
	 (SELECT count(*) FROM retired_files WHERE storage_key<>'archives/full/1/download.zip')`).Scan(&files, &references, &waveColumn, &retired)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(files, []string{
		"covers/1/cover.webp cover.webp 3 13 webp", "objects/bare/1/tja bare.tja 6 16 tja",
		"objects/full/1/tja full.tja 1 11 tja", "objects/shared/audio Song.MP3 2 12 mp3", "previews/full/1/preview.ogg preview.ogg 4 14 ogg"}) {
		t.Fatal("files", files)
	}
	if !slices.Equal(references, []string{
		"objects/bare/1/tja objects/shared/audio - -",
		"objects/full/1/tja objects/shared/audio covers/1/cover.webp previews/full/1/preview.ogg"}) {
		t.Fatal("references", references)
	}
	if waveColumn || retired != 0 {
		t.Fatal("wave column or retirement", waveColumn, retired)
	}
	// Stored ZIPs are queued for deletion; downloads are built on request.
	if tag, err := pool.Exec(ctx, `DELETE FROM retired_files WHERE storage_key='archives/full/1/download.zip'`); err != nil || tag.RowsAffected() != 1 {
		t.Fatal("stored ZIP not retired", err)
	}
	for _, sql := range []string{
		`UPDATE charts SET audio_file=NULL WHERE id='bare'`,
		`DELETE FROM chart_resources WHERE storage_key='objects/shared/audio'`,
		`INSERT INTO chart_resources(storage_key,original_filename,sha256,byte_size,extension) VALUES('objects/shared/audio','x',repeat('a',64),1,'ogg')`,
	} {
		if _, err = pool.Exec(ctx, sql); err == nil {
			t.Fatal("invalid file state allowed", sql)
		}
	}
	// Releasing a reference queues that file even when another song shares
	// it; the server decides which are unreferenced.
	if _, err = pool.Exec(ctx, `UPDATE charts SET cover_file=NULL WHERE id='full'; DELETE FROM charts WHERE id='bare'`); err != nil {
		t.Fatal(err)
	}
	var queued []string
	if err = pool.QueryRow(ctx, `SELECT array_agg(storage_key ORDER BY storage_key) FROM retired_files`).Scan(&queued); err != nil ||
		!slices.Equal(queued, []string{"covers/1/cover.webp", "objects/bare/1/tja", "objects/shared/audio"}) {
		t.Fatal("queued", queued, err)
	}
}
