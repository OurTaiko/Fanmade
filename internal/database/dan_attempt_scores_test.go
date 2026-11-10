package database

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Migrations 056 and 057 turn songs_played from a count into that many score ids, unknown (NULL)
// where no score is found; its length stays the count.
func TestDanAttemptScoresMigration(t *testing.T) {
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
	name := fmt.Sprintf("dan_attempt_scores_test_%d", time.Now().UnixNano())
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
	if err = migrateTo(ctx, pool, t.TempDir(), 55); err != nil {
		t.Fatal(err)
	}
	if err = MigrateSSO(ctx, pool, nil); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `BEGIN;
 INSERT INTO users(id) VALUES('u');
 INSERT INTO dan_courses(id,owner_id,title,exams,code) VALUES(repeat('a',32),'u','{"ja":"x"}','[]','ABC123');
 INSERT INTO dan_attempts(id,course_id,user_id,idempotency_key,payload_digest,verdict,songs_played)
  SELECT 'attempt'||n,repeat('a',32),'u','key-'||n,'digest',1,n FROM generate_series(0,3) n;
 COMMIT;`)
	if err != nil {
		t.Fatal(err)
	}
	if err = Migrate(ctx, pool, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, `SELECT id,songs_played FROM dan_attempts ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for n := 0; rows.Next(); n++ {
		var id string
		var played []*string
		if err = rows.Scan(&id, &played); err != nil {
			t.Fatal(err)
		}
		if len(played) != n {
			t.Fatalf("%s: %d songs became %d scores", id, n, len(played))
		}
		for _, score := range played {
			if score != nil {
				t.Fatalf("%s: a score from nowhere", id)
			}
		}
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE dan_attempts SET songs_played=ARRAY['a','b','c','d'] WHERE id='attempt2'`); err == nil {
		t.Fatal("more than three songs")
	}
	// 056 added score_keys and 057 took it away again.
	var keys bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='dan_attempts' AND column_name='score_keys')`).Scan(&keys); err != nil || keys {
		t.Fatal("score_keys", err, keys)
	}
}
