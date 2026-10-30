package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"golang.org/x/text/encoding/japanese"
	"ourtaiko.dev/sitekit/tja"
)

func TestUploadStoresCanonicalUTF8(t *testing.T) {
	pool := scoreTestDB(t)
	ctx := context.Background()
	const cookie = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,username,password_hash) VALUES('89b6ef3a5cb57b6e04f74711d15a8a5f','tester','unused')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,'89b6ef3a5cb57b6e04f74711d15a8a5f','csrf',now()+interval '1 day')`, hash(cookie)); err != nil {
		t.Fatal(err)
	}
	handler := testServer(t, pool, Config{Origin: "http://localhost", Storage: t.TempDir()}).Handler()
	audio, err := os.ReadFile("../../kit/audio/testdata/cbr.mp3")
	if err != nil {
		t.Fatal(err)
	}
	canonical := []byte("TITLE:初音ミク\r\nSUBTITLEJA:日本語の副題\r\nBPM:120\r\nWAVE:cbr.mp3\r\nCOURSE:Oni\r\nLEVEL:5\r\n#START\r\n1000,\r\n#END\r\n")
	sjis, err := japanese.ShiftJIS.NewEncoder().Bytes(canonical)
	if err != nil {
		t.Fatal(err)
	}
	// Stored bytes differ from the normalized upload only in the WAVE header.
	stored, ok := tja.SetWave(canonical, hash(string(audio))+".mp3")
	if !ok || !bytes.Contains(stored, []byte("\r\nWAVE:"+hash(string(audio))+".mp3\r\nCOURSE:Oni\r\n")) {
		t.Fatal("WAVE header not rewritten in place")
	}
	post := func(data []byte, key string, fields ...string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		tf, _ := form.CreateFormFile("tja", "chart.tja")
		tf.Write(data)
		af, _ := form.CreateFormFile("audio", "cbr.mp3")
		af.Write(audio)
		for i := 0; i+1 < len(fields); i += 2 {
			form.WriteField(fields[i], fields[i+1])
		}
		form.Close()
		r := httptest.NewRequest("POST", "/api/v1/charts", &body)
		r.Header.Set("Content-Type", form.FormDataContentType())
		r.Header.Set("Origin", "http://localhost")
		r.Header.Set("X-CSRF-Token", "csrf")
		r.Header.Set("Idempotency-Key", key)
		r.AddCookie(&http.Cookie{Name: "ourtaiko_session", Value: cookie})
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"UTF-8", canonical},
		{"UTF-8 BOM", append([]byte("\uFEFF"), canonical...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			key := ID()
			w := post(tc.data, key)
			var chart Chart
			if w.Code != 201 || json.Unmarshal(w.Body.Bytes(), &chart) != nil {
				t.Fatal(w.Code, w.Body.String())
			}
			digest := sha256.Sum256(stored)
			if chart.Title != "初音ミク" {
				t.Fatal("noncanonical metadata", chart.Title)
			}
			// The stored file is the normalized bytes (the API no longer tells its hash).
			var size int64
			var storedHash string
			if err := pool.QueryRow(ctx, `SELECT r.byte_size,r.sha256 FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, chart.ID).Scan(&size, &storedHash); err != nil || size != int64(len(stored)) || storedHash != hex.EncodeToString(digest[:]) {
				t.Fatal("incorrect normalized file", size, storedHash, err)
			}
			for _, kind := range []string{"tja", "download"} {
				w = httptest.NewRecorder()
				handler.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/charts/"+chart.ID+"/"+kind, nil))
				if w.Code != 200 {
					t.Fatal(w.Code)
				}
				data := w.Body.Bytes()
				if kind == "download" {
					archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
					if err != nil {
						t.Fatal(err)
					}
					data = nil
					for _, file := range archive.File {
						if strings.HasSuffix(file.Name, ".tja") {
							r, _ := file.Open()
							data, err = io.ReadAll(r)
							r.Close()
							if err != nil {
								t.Fatal(err)
							}
						}
					}
				}
				if !bytes.Equal(data, stored) {
					t.Fatal("download differs from normalized stored bytes", kind)
				}
			}
			w = post(canonical, key)
			if w.Code != 200 {
				t.Fatal("canonical idempotent retry", w.Code, w.Body.String())
			}
		})
	}
	// Uploads are UTF-8 only: the browser converts Shift-JIS and the rest first.
	w := post(sjis, ID())
	if w.Code != 422 || !strings.Contains(w.Body.String(), "TJA_ENCODING_INVALID") {
		t.Fatal("Shift-JIS must be refused", w.Code, w.Body.String())
	}
	// The encoding field is gone, whatever it says.
	for _, encoding := range []string{"utf-8", "shift-jis"} {
		if w = post(canonical, ID(), "encoding", encoding); w.Code != 400 || !strings.Contains(w.Body.String(), "UPLOAD_FILES_INVALID") {
			t.Fatal("encoding field accepted", encoding, w.Code, w.Body.String())
		}
	}
}
