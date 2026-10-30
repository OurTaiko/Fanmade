package database

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Migration 051 starts update_at at the latest change still on record.
func TestUpdateAtMigration(t *testing.T) {
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
	name := fmt.Sprintf("update_at_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA IF EXISTS "+name+", "+name+"_auth, "+name+"_internal CASCADE")
	cfg, _ := pgxpool.ParseConfig(url)
	cfg.ConnConfig.RuntimeParams["search_path"] = SchemaSearchPath(name)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = migrateTo(ctx, pool, t.TempDir(), 50); err != nil {
		t.Fatal(err)
	}
	if err = MigrateSSO(ctx, pool, nil); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `BEGIN;
 INSERT INTO users(id) VALUES('u');
 INSERT INTO chart_resources(storage_key,original_filename,sha256,byte_size,extension)
  SELECT k,'f',repeat(n,64),1,'tja' FROM (VALUES ('a','a'),('b','b')) v(k,n);
 INSERT INTO charts(id,owner_ids,title,bpm,duration,tja_file,audio_file,created_at,metadata_updated_at)
  SELECT id,ARRAY['u'],id,120,10,(SELECT min(id) FROM chart_resources),(SELECT max(id) FROM chart_resources),created,edited
  FROM (VALUES ('voted','2026-10-01Z'::timestamptz,'2026-10-05Z'::timestamptz),('edited','2026-10-01Z','2026-10-05Z'),('quiet','2026-10-03Z',NULL)) v(id,created,edited);
 INSERT INTO chart_votes(chart_id,user_id,value,voted_at) VALUES('voted','u',1,'2026-10-08Z');
 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]string{"voted": "2026-10-08", "edited": "2026-10-05", "quiet": "2026-10-03"} {
		var got string
		if err = pool.QueryRow(ctx, `SELECT to_char(update_at AT TIME ZONE 'UTC','YYYY-MM-DD') FROM charts WHERE id=$1`, id).Scan(&got); err != nil || got != want {
			t.Fatal(id, got, err, "want", want)
		}
	}
	var gone bool
	if err = pool.QueryRow(ctx, `SELECT count(*)=0 FROM information_schema.columns WHERE table_schema=$1 AND table_name='charts' AND column_name='metadata_updated_at'`, name).Scan(&gone); err != nil || !gone {
		t.Fatal("metadata_updated_at remains", err)
	}
}
