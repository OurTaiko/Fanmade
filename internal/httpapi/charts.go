package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/tja"
	"ourtaiko.dev/sitekit/constants"
	"ourtaiko.dev/sitekit/video"
)

type Chart struct {
	DemoEnd      float64       `json:"demoEnd"`
	PreviewPath  string        `json:"previewPath,omitempty"`
	AudioPreview *AudioPreview `json:"audioPreview,omitempty"`
	CoverHash    string        `json:"coverHash,omitempty"`
	CategoryIDs  []string      `json:"categoryIds"`
	ID           string        `json:"id"`
	// NumberID is the chart's short number, also accepted by GET /charts/{id}.
	NumberID int64               `json:"numberId"`
	OwnerIDs []string            `json:"ownerIds"`
	Owners   []NotificationActor `json:"owners"`
	// Deprecated: original uploader only; authorization uses OwnerIDs.
	OwnerID  string `json:"ownerId"`
	Uploader string `json:"uploader"`
	// UploaderAvatarURL is empty when the uploader has no avatar or SSO is unavailable.
	UploaderAvatarURL string    `json:"uploaderAvatarUrl"`
	Description       string    `json:"description"`
	CreatedAt         time.Time `json:"createdAt"`
	Duration          float64   `json:"duration"`
	Encoding          string    `json:"encoding"`
	TJAName           string    `json:"tjaName"`
	AudioName         string    `json:"audioName"`
	// The stored file's hash: object key and download check, not the chart's identity (that is
	// each block's chartHash). Not in the JSON; the resource manifest carries it as sha256.
	TJAHash   string `json:"-"`
	AudioHash string `json:"audioHash"`
	AudioSize int64  `json:"audioSize"`
	// Votes and comments; MyVote is only filled for the signed-in detail view.
	Score        int    `json:"score"`
	Upvotes      int    `json:"upvotes"`
	Downvotes    int    `json:"downvotes"`
	CommentCount int    `json:"commentCount"`
	MyVote       int    `json:"myVote"`
	TJAKey       string `json:"-"`
	AudioKey     string `json:"-"`
	// Background movie (BGMOVIE), transcoded; empty when the chart has none.
	MovieHash string `json:"movieHash,omitempty"`
	MovieSize int64  `json:"movieSize,omitempty"`
	MovieKey  string `json:"-"`
	// Only in an upload's own response: optional files that were left out.
	FailedFiles []fileFailure `json:"failedFiles,omitempty"`
	tja.Metadata
}

const publishedChart = `c.status='published'`

// Blocks are listed Easy to Edit, each as single, p1, p2.
const slotOrder = `array_position(ARRAY['Easy','Normal','Hard','Oni','Edit'],d.course),array_position(ARRAY['single','p1','p2'],d.side)`

const chartSelect = `SELECT c.id,c.number_id,c.owner_ids,''::text,c.description,c.created_at,c.duration,tf.original_filename,af.original_filename,tf.sha256,af.sha256,af.byte_size,tf.storage_key,af.storage_key,c.title,c.subtitle,c.bpm,c.offset_seconds,c.demo_start,af.sha256||'.'||af.extension,c.title_translations,c.subtitle_translations,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'course',d.course,'side',d.side,'level',d.level,'maker',d.maker,'branching',d.branching,'chartHash',d.content_hash) ORDER BY ` + slotOrder + `) FROM chart_difficulties d WHERE d.chart_id=c.id),'[]'),
 c.category_flags,c.demo_end,COALESCE((SELECT storage_key FROM chart_resources WHERE id=c.preview_file),''),
 c.movie_offset,COALESCE(mf.sha256,''),COALESCE(mf.byte_size,0),COALESCE(mf.storage_key,''),
 COALESCE((SELECT upvotes FROM chart_stats WHERE chart_id=c.id),0),COALESCE((SELECT downvotes FROM chart_stats WHERE chart_id=c.id),0),COALESCE((SELECT comment_count FROM chart_stats WHERE chart_id=c.id),0)
 FROM charts c JOIN chart_resources tf ON tf.id=c.tja_file JOIN chart_resources af ON af.id=c.audio_file LEFT JOIN chart_resources mf ON mf.id=c.movie_file `

func readChart(row pgx.Row) (Chart, error) {
	c := Chart{Encoding: "utf-8"} // Compatibility field; stored TJA bytes are always UTF-8.
	var difficulties []byte
	var flags CategoryFlags
	e := row.Scan(&c.ID, &c.NumberID, &c.OwnerIDs, &c.Uploader, &c.Description, &c.CreatedAt, &c.Duration, &c.TJAName, &c.AudioName, &c.TJAHash, &c.AudioHash, &c.AudioSize, &c.TJAKey, &c.AudioKey, &c.Title, &c.Subtitle, &c.BPM, &c.Offset, &c.DemoStart, &c.Wave, &c.TitleTranslations, &c.SubtitleTranslations, &difficulties, &flags, &c.DemoEnd, &c.PreviewPath, &c.MovieOffset, &c.MovieHash, &c.MovieSize, &c.MovieKey, &c.Upvotes, &c.Downvotes, &c.CommentCount)
	if e == nil {
		c.OwnerID = c.OwnerIDs[0]
		c.Score = c.Upvotes - c.Downvotes
		c.CategoryIDs = flags.IDs()
		e = json.Unmarshal(difficulties, &c.Difficulties)
		c.Maker = difficultyMakers(c.Difficulties)
		c.AudioPreview = audioPreview(c)
	}
	return c, e
}
func (s *Server) chart(ctx context.Context, id string) (Chart, error) {
	return s.chartWhere(ctx, "c.id", id)
}

// chartWhere reads the published chart whose column (c.id or c.number_id) is value.
func (s *Server) chartWhere(ctx context.Context, column string, value any) (Chart, error) {
	c, e := s.readChart(s.DB.QueryRow(ctx, chartSelect+` WHERE `+column+`=$1 AND `+publishedChart, value))
	if e == nil {
		c.setOwners(s.publicProfiles(ctx, c.OwnerIDs))
	}
	if e == nil {
		items := []Chart{c}
		e = s.coverHashes(ctx, items)
		c = items[0]
	}
	return c, e
}
func (s *Server) list(w http.ResponseWriter, r *http.Request) {
	owner := r.URL.Query().Get("owner")
	if owner != "" && !validSubject(owner) {
		problem(w, 400, "QUERY_INVALID", "用户标识无效")
		return
	}
	s.listFor(w, r, owner)
}
func (s *Server) mine(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, false)
	if !ok {
		return
	}
	s.listFor(w, r, u.User.ID)
}
func (s *Server) listFor(w http.ResponseWriter, r *http.Request, owner string) {
	s.webSearch(w, r, owner)
}

// validID reports whether id has the form of every random ID here (charts, courses,
// playlists): 32 lowercase hex digits.
func validID(id string) bool {
	if len(id) != 32 {
		return false
	}
	for _, c := range id {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// detail answers GET /charts/{id}: by=number looks {id} up as the chart's number, by=id as its
// ID, and without by its form decides.
func (s *Server) detail(w http.ResponseWriter, r *http.Request) {
	raw, column := r.PathValue("id"), ""
	var value any = raw
	by := r.URL.Query().Get("by")
	if by == "" {
		// Without by, the form tells: an ID has 32 hex digits, a number at most 19.
		by = "number"
		if validID(raw) {
			by = "id"
		}
	}
	switch by {
	case "number":
		if n, e := strconv.ParseInt(raw, 10, 64); e == nil && n > 0 && raw[0] != '0' {
			column, value = "c.number_id", n
		}
	case "id":
		column = "c.id"
	default:
		problem(w, 400, "QUERY_INVALID", "by 只能是 number 或 id")
		return
	}
	e := pgx.ErrNoRows
	var c Chart
	if column != "" {
		c, e = s.chartWhere(r.Context(), column, value)
	}
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在或已删除")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	// The difficulty constants, for the chart page only (lists and the game catalog go without).
	ids := make([]int64, len(c.Difficulties))
	for i, d := range c.Difficulties {
		ids[i] = d.ID
	}
	shown, e := constants.ForBlocks(r.Context(), s.DB, ids)
	if e != nil {
		internal(w, e)
		return
	}
	for i := range c.Difficulties {
		c.Difficulties[i].Constants = shown[c.Difficulties[i].ID]
	}
	if viewer := s.viewer(r); viewer != "" {
		e = s.DB.QueryRow(r.Context(), `SELECT value FROM chart_votes WHERE chart_id=$1 AND user_id=$2`, c.ID, viewer).Scan(&c.MyVote)
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			internal(w, e)
			return
		}
	}
	respond(w, 200, c)
}
func (s *Server) remove(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	c, e := s.chart(r.Context(), r.PathValue("id"))
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if !c.hasOwner(u.User.ID) {
		problem(w, 403, "FORBIDDEN", "只能删除自己的作品")
		return
	}
	keys, e := s.deleteChart(r.Context(), c.ID, u.User.ID)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	// Files are queued by the deletion; the periodic cleanup retries any failure.
	for _, key := range keys {
		if e = s.deleteRetiredFile(r.Context(), key); e != nil {
			log.Printf("deleted chart file cleanup pending: %v", e)
		}
	}
	respond(w, 200, map[string]bool{"ok": true})
}

// deleteChart removes a song's scores and row. The chart trigger queues each
// of its files in retired_files; it returns their keys.
func (s *Server) deleteChart(ctx context.Context, chartID, ownerID string) ([]string, error) {
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	// Serialize with score submissions, which hold the song row FOR SHARE.
	if e = tx.QueryRow(ctx, `SELECT id FROM charts WHERE id=$1 AND owner_ids @> ARRAY[$2::text] AND status<>'deleted' FOR UPDATE`, chartID, ownerID).Scan(&chartID); e != nil {
		return nil, e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM scores WHERE difficulty_id IN (SELECT id FROM chart_difficulties WHERE chart_id=$1)`, chartID); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, `SELECT r.storage_key FROM charts c JOIN chart_resources r ON r.id IN (c.tja_file,c.audio_file,c.cover_file,c.preview_file,c.movie_file) WHERE c.id=$1`, chartID)
	if e != nil {
		return nil, e
	}
	keys, e := pgx.CollectRows(rows, pgx.RowTo[string])
	if e != nil {
		return nil, e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM charts WHERE id=$1`, chartID); e != nil {
		return nil, e
	}
	return keys, tx.Commit(ctx)
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	c, e := s.chart(r.Context(), r.PathValue("id"))
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在或已删除")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	kind := r.PathValue("kind")
	if kind == "download" {
		// The ZIP is built per request from the stored TJA and audio.
		tf, e := s.Config.Objects.Open(r.Context(), c.TJAKey)
		if e != nil {
			internal(w, e)
			return
		}
		defer tf.Close()
		af, e := s.Config.Objects.Open(r.Context(), c.AudioKey)
		if e != nil {
			internal(w, e)
			return
		}
		defer af.Close()
		// Name the audio as this TJA does; a file awaiting rekeying still
		// declares its uploaded name.
		data, e := io.ReadAll(io.LimitReader(tf, tja.MaxTJA+1))
		if e != nil {
			internal(w, e)
			return
		}
		entries := []struct {
			name string
			file io.Reader
		}{{c.TJAName, bytes.NewReader(data)}, {tja.WaveName(data), af}}
		if c.MovieKey != "" {
			mf, e := s.Config.Objects.Open(r.Context(), c.MovieKey)
			if e != nil {
				internal(w, e)
				return
			}
			defer mf.Close()
			entries = append(entries, struct {
				name string
				file io.Reader
			}{tja.MovieName(data), mf})
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": strings.TrimSuffix(c.TJAName, filepath.Ext(c.TJAName)) + ".zip"}))
		z := zip.NewWriter(w)
		for _, f := range entries {
			dst, e := z.CreateHeader(&zip.FileHeader{Name: f.name, Method: zip.Store})
			if e != nil {
				return
			}
			if _, e = io.Copy(dst, f.file); e != nil {
				return
			}
		}
		z.Close()
		return
	}
	var key, name, contentType, etag string
	switch kind {
	case "tja":
		key, name, contentType, etag = c.TJAKey, c.TJAName, "application/octet-stream", c.TJAHash
	case "movie":
		if c.MovieKey == "" {
			problem(w, 404, "RESOURCE_NOT_FOUND", "该谱面没有背景视频")
			return
		}
		key, name, contentType, etag = c.MovieKey, c.MovieHash+"."+video.Extension, video.MediaType, c.MovieHash
	default:
		problem(w, 404, "RESOURCE_NOT_FOUND", "资源不存在")
		return
	}
	if s.redirectResource(w, r, key, name) {
		return
	}
	f, e := s.Config.Objects.Open(r.Context(), key)
	if e != nil {
		internal(w, e)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("ETag", `"`+etag+`"`)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	http.ServeContent(w, r, name, f.ModTime(), f)
}
