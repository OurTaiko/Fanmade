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

func TestChartOwnersMigration(t *testing.T) {
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
	name := fmt.Sprintf("owners_migration_%d", time.Now().UnixNano())
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
	if err = migrateTo(ctx, pool, storage, 36); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `BEGIN;
 INSERT INTO users(id,username,password_hash) VALUES('owner','owner','unused'),('other','other','unused');
 INSERT INTO charts(id,owner_id,title,bpm,duration,wave_filename,difficulties) VALUES('chart','owner','Song',120,10,'a.ogg','[{"course":"Oni","level":5,"maker":""}]');
 INSERT INTO chart_resources SELECT 'chart',kind,kind,'file',repeat('a',64),10,'test' FROM unnest(ARRAY['tja','audio','archive']) kind;
 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	// Production already uses the SSO identity-only auth schema before this upgrade.
	if err = MigrateSSO(ctx, pool, func(context.Context, []string) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err = Migrate(ctx, pool, storage); err != nil {
			t.Fatal(err)
		}
	}
	var ids []string
	if err = pool.QueryRow(ctx, `SELECT owner_ids FROM charts WHERE id='chart'`).Scan(&ids); err != nil || !slices.Equal(ids, []string{"owner"}) {
		t.Fatal(ids, err)
	}
	for _, sql := range []string{
		`UPDATE charts SET owner_ids='{}'`,
		`UPDATE charts SET owner_ids=ARRAY['owner','owner']`,
		`UPDATE charts SET owner_ids=ARRAY['owner',NULL]`,
		`UPDATE charts SET owner_ids=ARRAY['missing']`,
		`DELETE FROM users WHERE id='owner'`,
		`UPDATE users SET id='changed' WHERE id='owner'`,
	} {
		if _, err = pool.Exec(ctx, sql); err == nil {
			t.Fatal("invalid owners allowed", sql)
		}
	}
	if _, err = pool.Exec(ctx, `UPDATE charts SET owner_ids=ARRAY['owner','other']`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM users WHERE id='other'`); err == nil {
		t.Fatal("co-owner deletion allowed")
	}
	var oldColumn bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='charts' AND column_name='owner_id')`).Scan(&oldColumn); err != nil || oldColumn {
		t.Fatal("scalar ownership remains", err)
	}
}
