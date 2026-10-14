package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ourtaiko.dev/fanmade/api/internal/teststore"
)

func TestRekeyFiles(t *testing.T) {
	for _, remote := range []bool{false, true} {
		t.Run(fmt.Sprint("s3=", remote), func(t *testing.T) {
			ctx := context.Background()
			pool := scoreTestDB(t)
			const owner = "d46774d30dd13b92d9e536808da468a4"
			if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES($1,'author','unused')`, owner); err != nil {
				t.Fatal(err)
			}
			cfg := Config{Storage: t.TempDir(), Origin: "http://localhost"}
			if remote {
				cfg.Objects = teststore.New(t)
			}
			app := testServer(t, pool, cfg)
			put := func(key, data string) {
				t.Helper()
				if err := app.Config.Objects.Put(ctx, key, strings.NewReader(data), int64(len(data)), "application/octet-stream", hash(data)); err != nil {
					t.Fatal(err)
				}
			}
			read := func(key string) (string, error) {
				f, err := app.Config.Objects.Open(ctx, key)
				if err != nil {
					return "", err
				}
				defer f.Close()
				data, err := io.ReadAll(f)
				return string(data), err
			}
			// Two songs uploaded the same audio separately before schema 038.
			const audio, cover, preview = "audio bytes", "cover bytes", "preview bytes"
			tjaOf := func(title string) string {
				return "TITLE:" + title + "\r\nBPM:120\r\nWAVE:Song.OGG\r\nCOURSE:Oni\r\nLEVEL:5\r\n#START\r\n1000,\r\n#END\r\n"
			}
			legacy := map[string]string{
				"objects/a/1/tja": tjaOf("A"), "objects/a/2/audio": audio, "covers/1/cover.webp": cover, "previews/a/1/preview.ogg": preview,
				"objects/b/1/tja": tjaOf("B"), "objects/b/2/audio": audio,
			}
			for key, data := range legacy {
				put(key, data)
			}
			_, err := pool.Exec(ctx, `INSERT INTO charts(id,owner_ids,title,bpm,duration,tja_file,audio_file,cover_file,preview_file) VALUES
 ('a',ARRAY[$1],'A',120,10,test_file('objects/a/1/tja','a.tja',$2,$4),test_file('objects/a/2/audio','Song.OGG',$5,11),
  test_file('covers/1/cover.webp','cover.webp',$6,11),test_file('previews/a/1/preview.ogg','preview.ogg',$7,13)),
 ('b',ARRAY[$1],'B',120,10,test_file('objects/b/1/tja','b.tja',$3,$4),test_file('objects/b/2/audio','Song.OGG',$5,11),NULL,NULL)`,
				owner, hash(tjaOf("A")), hash(tjaOf("B")), len(tjaOf("A")), hash(audio), hash(cover), hash(preview))
			if err != nil {
				t.Fatal(err)
			}
			if _, err = pool.Exec(ctx, `INSERT INTO upload_requests(user_id,idempotency_key,payload_digest,chart_id,tja_sha256,audio_sha256) VALUES($1,'receipt-for-song-a',repeat('a',64),'a',$2,$3)`, owner, hash(tjaOf("A")), hash(audio)); err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err = app.RekeyFiles(ctx); err != nil {
					t.Fatal(err)
				}
				app.cleanupReplacedFiles()
			}
			wave := hash(audio) + ".ogg"
			a, err := app.chart(ctx, "a")
			if err != nil {
				t.Fatal(err)
			}
			b, err := app.chart(ctx, "b")
			if err != nil {
				t.Fatal(err)
			}
			storedA := strings.Replace(tjaOf("A"), "Song.OGG", wave, 1)
			if a.TJAHash != hash(storedA) || a.TJAKey != hash(storedA)+".tja" || a.TJAName != "a.tja" || a.Wave != wave || a.AudioName != "Song.OGG" || a.AudioHash != hash(audio) {
				t.Fatalf("song a: %+v", a)
			}
			if a.AudioKey != wave || b.AudioKey != wave || b.TJAKey == a.TJAKey || !strings.HasSuffix(a.PreviewPath, hash(preview)+".ogg") {
				t.Fatal("audio not shared or keys wrong", a.AudioKey, b.AudioKey, a.PreviewPath)
			}
			want := map[string]string{a.TJAKey: storedA, b.TJAKey: strings.Replace(tjaOf("B"), "Song.OGG", wave, 1), wave: audio, hash(cover) + ".webp": cover, hash(preview) + ".ogg": preview}
			for key, data := range want {
				if got, err := read(key); err != nil || got != data {
					t.Fatal("object", key, err)
				}
			}
			for key := range legacy {
				if _, err := read(key); !os.IsNotExist(err) {
					t.Fatal("legacy object remains", key, err)
				}
			}
			// The ZIP is built on request and names the audio as the stored TJA does.
			w := httptest.NewRecorder()
			app.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/charts/a/download", nil))
			z, err := zip.NewReader(bytes.NewReader(w.Body.Bytes()), int64(w.Body.Len()))
			if w.Code != 200 || err != nil || len(z.File) != 2 {
				t.Fatal("download", w.Code, err)
			}
			for name, content := range map[string]string{"a.tja": storedA, wave: audio} {
				f, err := z.Open(name)
				if err != nil {
					t.Fatal(name, err)
				}
				var got bytes.Buffer
				_, err = io.Copy(&got, f)
				f.Close()
				if err != nil || got.String() != content {
					t.Fatal("ZIP entry", name, err)
				}
			}
			files := len(want)
			var rows, flat, queued, receipts int
			if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM chart_resources),(SELECT count(*) FROM chart_resources WHERE storage_key=sha256||'.'||extension),
 (SELECT count(*) FROM retired_files),(SELECT count(*) FROM upload_requests WHERE chart_id='a' AND tja_sha256=$1)`, a.TJAHash).Scan(&rows, &flat, &queued, &receipts); err != nil {
				t.Fatal(err)
			}
			if rows != files || flat != files || queued != 0 || receipts != 1 {
				t.Fatal("records", rows, flat, queued, receipts)
			}
		})
	}
}
