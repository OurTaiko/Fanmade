package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/text/unicode/norm"
	"ourtaiko.dev/fanmade/api/internal/tja"
	"ourtaiko.dev/sitekit/audio"
	"ourtaiko.dev/sitekit/cover"
	"ourtaiko.dev/sitekit/video"
)

type stagedFile struct {
	name, path, sha string
	size            int64
}

var keyPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{16,80}$`)

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var existing *Chart
	if id := r.PathValue("id"); id != "" {
		c, err := s.chart(r.Context(), id)
		if errors.Is(err, pgx.ErrNoRows) {
			problem(w, 404, "CHART_NOT_FOUND", "歌曲不存在或已下架")
			return
		}
		if err != nil {
			internal(w, err)
			return
		}
		if !c.hasOwner(u.User.ID) && !u.User.IsAdmin {
			problem(w, 403, "FORBIDDEN", "只有上传者或管理员可以替换歌曲")
			return
		}
		existing = &c
	}
	key := r.Header.Get("Idempotency-Key")
	if !keyPattern.MatchString(key) {
		problem(w, 400, "IDEMPOTENCY_KEY_INVALID", "需要有效的上传请求标识")
		return
	}
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	default:
		problem(w, 503, "UPLOAD_BUSY", "当前正在处理其他上传，请稍后重试")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 112*1024*1024)
	mr, e := r.MultipartReader()
	if e != nil {
		problem(w, 400, "UPLOAD_FILES_INVALID", "请选择 TJA 和 OGG 或 MP3 音频文件")
		return
	}
	dir, e := os.MkdirTemp(s.Config.Storage, "staging-")
	if e != nil {
		internal(w, e)
		return
	}
	// The staged files belong to the request until a job accepts them.
	accepted := false
	defer func() {
		if !accepted {
			os.RemoveAll(dir)
		}
	}()
	files := map[string]*stagedFile{}
	fields := map[string]string{}
	for {
		part, e := mr.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			uploadReadError(w, e)
			return
		}
		disposition, params, e := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		if e != nil || disposition != "form-data" {
			problem(w, 400, "UPLOAD_FILES_INVALID", "上传字段格式错误")
			return
		}
		field, name := params["name"], params["filename"]
		if field == "tja" || field == "audio" || field == "cover" || field == "movie" {
			validExtension := strings.EqualFold(filepath.Ext(name), ".tja")
			maxBytes := int64(tja.MaxTJA)
			if field == "audio" {
				validExtension = audio.MediaType(name) != ""
				maxBytes = tja.MaxAudio
			}
			if field == "cover" {
				validExtension = cover.ValidExtension(name)
				maxBytes = cover.MaxBytes
			}
			if field == "movie" {
				validExtension = video.ValidExtension(name)
				maxBytes = video.MaxBytes
			}
			if files[field] != nil || !tja.SafeFilename(name) || !validExtension {
				problem(w, 400, "UPLOAD_FILES_INVALID", "文件类型、数量或文件名无效；封面仅支持 JPG / PNG / WebP，视频仅支持 MP4 / WebM / MOV，文件名不能包含路径")
				return
			}
			f := &stagedFile{name: name, path: filepath.Join(dir, field)}
			out, e := os.OpenFile(f.path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if e != nil {
				internal(w, e)
				return
			}
			h := sha256.New()
			n, copyErr := io.Copy(io.MultiWriter(out, h), io.LimitReader(part, maxBytes+1))
			closeErr := out.Close()
			if copyErr != nil {
				uploadReadError(w, copyErr)
				return
			}
			if closeErr != nil {
				internal(w, closeErr)
				return
			}
			if n == 0 || n > maxBytes {
				problem(w, 413, "FILE_TOO_LARGE", "文件为空或超过上传大小限制")
				return
			}
			f.size = n
			f.sha = hex.EncodeToString(h.Sum(nil))
			files[field] = f
		} else {
			if (field != "description" && field != "categoryIds" && field != "difficultyMakers" && field != "demoStart" && field != "demoEnd" && !(existing != nil && (field == "confirmReset" || field == "keepTitles"))) || name != "" {
				problem(w, 400, "UPLOAD_FILES_INVALID", "包含不支持的上传字段")
				return
			}
			if _, exists := fields[field]; exists {
				problem(w, 400, "UPLOAD_FILES_INVALID", "上传字段重复")
				return
			}
			limit := int64(4000)
			if field == "difficultyMakers" {
				limit = 64 * 1024
			}
			data, e := io.ReadAll(io.LimitReader(part, limit+1))
			if e != nil {
				uploadReadError(w, e)
				return
			}
			if int64(len(data)) > limit {
				if field == "difficultyMakers" {
					problem(w, 400, "UPLOAD_FIELD_TOO_LONG", "制作者表格不能超过 64 KiB")
				} else {
					problem(w, 400, "DESCRIPTION_TOO_LONG", "说明不能超过 4000 字节")
				}
				return
			}
			fields[field] = string(data)
		}
		part.Close()
	}
	categoryIDs, categoryErr := categorySelection(json.RawMessage(fields["categoryIds"]))
	if categoryErr != nil {
		problem(w, 422, "CATEGORIES_INVALID", "分类必须为分类 ID 数组")
		return
	}
	if !validCategories(categoryIDs) {
		problem(w, 422, "CATEGORIES_INVALID", "包含不存在的分类，请刷新后重试")
		return
	}
	cf, mv := files["cover"], files["movie"]
	tf, af := files["tja"], files["audio"]
	if tf == nil || (af == nil && existing == nil) {
		message := "必须同时选择 TJA 和一个 OGG 或 MP3 音频"
		if existing != nil {
			message = "必须选择新的 TJA，音频可沿用当前文件"
		}
		problem(w, 400, "UPLOAD_FILES_INVALID", message)
		return
	}
	invalid := func(issue *tja.Issue) {
		respond(w, 422, map[string]any{"code": issue.Code, "message": issue.Message, "errors": []*tja.Issue{issue}, "requestId": w.Header().Get("X-Request-ID"), "validationVersion": tja.Version})
	}
	data, e := os.ReadFile(tf.path)
	if e != nil {
		internal(w, e)
		return
	}
	normalized, issue := tja.NormalizeUTF8(data)
	if issue != nil {
		invalid(issue)
		return
	}
	tjaHash := sha256.Sum256(normalized)
	tf.sha = hex.EncodeToString(tjaHash[:])
	if existing != nil && fields["confirmReset"] != "true" {
		problem(w, 400, "REPLACEMENT_CONFIRMATION_REQUIRED", "替换需要确认删除旧文件和旧成绩")
		return
	}
	// Staged files wait on bounded temporary storage, so the queue is bounded too.
	select {
	case s.pending <- struct{}{}:
	default:
		problem(w, 503, "UPLOAD_BUSY", "当前排队处理的上传较多，请稍后重试")
		return
	}
	defer func() {
		if !accepted {
			<-s.pending
		}
	}()
	var tx pgx.Tx
	var digest string
	if existing != nil {
		// Hash only submitted data: a retry must work after the old audio was
		// deleted, and is answered before the new files are judged again.
		parts := []string{existing.ID, tf.name, tf.sha}
		if af != nil {
			parts = append(parts, af.name, af.sha)
		}
		if cf != nil {
			parts = append(parts, "cover", cf.name, cf.sha)
		}
		if mv != nil {
			parts = append(parts, "movie", mv.name, mv.sha)
		}
		encoded, _ := json.Marshal(struct {
			Parts  []string
			Fields map[string]string
		}{parts, fields})
		digest = hash("replace:" + string(encoded))
		var proceed bool
		if tx, proceed = s.beginUpload(w, r, u.User.ID, key, digest); !proceed {
			return
		}
		defer tx.Rollback(r.Context())
	}
	// Retained audio is already identified; a shared file keeps the name it was
	// first uploaded with, so the new TJA's WAVE need not match it.
	waveSource := tja.WaveName(normalized)
	if af != nil {
		waveSource = af.name
	}
	meta, issue := tja.Parse(normalized, waveSource)
	if issue != nil {
		invalid(issue)
		return
	}
	// A declared BGMOVIE needs its file; a replacement may keep the stored movie.
	keepMovie := false
	switch {
	case meta.Movie == "" && mv != nil:
		problem(w, 400, "UPLOAD_FILES_INVALID", "TJA 没有声明 BGMOVIE，不能上传视频")
		return
	case meta.Movie != "" && mv == nil:
		if existing == nil || existing.MovieHash == "" {
			invalid(&tja.Issue{Code: "TJA_MOVIE_MISSING", Message: fmt.Sprintf("TJA 的 BGMOVIE 引用了「%s」，请同时选择该视频文件，或删除 BGMOVIE 后重新上传。", meta.Movie), Expected: meta.Movie})
			return
		}
		keepMovie = true
	case mv != nil && norm.NFC.String(meta.Movie) != norm.NFC.String(mv.name):
		invalid(&tja.Issue{Code: "TJA_MOVIE_MISMATCH", Message: fmt.Sprintf("BGMOVIE 引用了「%s」，但你选择的是「%s」。请选择对应文件，或修改 TJA 的 BGMOVIE 后重新选择。", meta.Movie, mv.name), Expected: meta.Movie, Actual: mv.name})
		return
	}
	if e = applyDifficultyMakers(fields["difficultyMakers"], meta.Difficulties); e != nil {
		problem(w, 422, "DIFFICULTY_MAKERS_INVALID", e.Error())
		return
	}
	// The range is checked against the audio's duration once it has been decoded.
	demoStart := meta.DemoStart
	if raw, ok := fields["demoStart"]; ok {
		demoStart, e = strconv.ParseFloat(strings.TrimSpace(raw), 64)
		if e != nil {
			problem(w, 422, "PREVIEW_RANGE_INVALID", "试听起点必须为秒数")
			return
		}
	}
	demoEnd := demoStart + 15
	if raw, ok := fields["demoEnd"]; ok {
		demoEnd, e = strconv.ParseFloat(strings.TrimSpace(raw), 64)
		if e != nil {
			problem(w, 422, "PREVIEW_RANGE_INVALID", "试听终点必须为秒数")
			return
		}
	}
	if existing == nil {
		digestData, _ := json.Marshal([]string{tf.name, tf.sha, af.name, af.sha, fields["description"]})
		if demoStart != meta.DemoStart || demoEnd != meta.DemoStart+15 {
			encoded, _ := json.Marshal([]any{"preview", demoStart, demoEnd})
			digestData = append(digestData, encoded...)
		}
		if len(categoryIDs) != 1 || categoryIDs[0] != "variety" {
			encoded, _ := json.Marshal(categoryIDs)
			digestData = append(digestData, encoded...)
		}
		for _, d := range meta.Difficulties {
			if d.Maker != meta.Maker {
				encoded, _ := json.Marshal(meta.Difficulties)
				digestData = append(digestData, encoded...)
				break
			}
		}
		if cf != nil {
			encoded, _ := json.Marshal([]string{"cover", cf.name, cf.sha})
			digestData = append(digestData, encoded...)
		}
		if mv != nil {
			encoded, _ := json.Marshal([]string{"movie", mv.name, mv.sha})
			digestData = append(digestData, encoded...)
		}
		digest = hash(string(digestData))
	}
	job := &uploadJob{
		user: u.User.ID, key: key, dir: dir, tja: tf, audio: af, cover: cf, movie: mv, normalized: normalized, meta: meta,
		description: fields["description"], categoryIDs: categoryIDs, demoStart: demoStart, demoEnd: demoEnd, keepMovie: keepMovie,
		// RFC 7240: the client asks not to wait for processing.
		async: strings.Contains(strings.ToLower(r.Header.Get("Prefer")), "respond-async"), done: make(chan uploadResult, 1),
	}
	if existing != nil {
		job.existingID, job.audioHash, job.movieHash = existing.ID, existing.AudioHash, existing.MovieHash
		job.keepTitles = fields["keepTitles"] == "true"
		// A replacement keeps the description and categories it does not send, as on OurTaiko Database.
		if _, sent := fields["description"]; !sent {
			job.description = existing.Description
		}
		if _, sent := fields["categoryIds"]; !sent {
			job.categoryIDs = existing.CategoryIDs
		}
	}
	if tx == nil {
		var proceed bool
		if tx, proceed = s.beginUpload(w, r, u.User.ID, key, digest); !proceed {
			return
		}
		defer tx.Rollback(r.Context())
	}
	_, e = tx.Exec(r.Context(), `INSERT INTO upload_requests(user_id,idempotency_key,payload_digest,chart_id,status,title) VALUES($1,$2,$3,$4,'processing',$5)`, u.User.ID, key, digest, nullable(job.existingID), meta.Title)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		internal(w, e)
		return
	}
	accepted = true
	s.enqueue(job)
	if job.async {
		respond(w, 202, map[string]string{"status": "processing"})
		return
	}
	result := <-job.done
	if result.err != nil {
		if result.err.cause != nil {
			internal(w, result.err.cause)
		} else {
			problem(w, result.err.status, result.err.code, result.err.message)
		}
		return
	}
	status := 201
	if existing != nil {
		status = 200
	}
	respond(w, status, result.chart)
}
func uploadReadError(w http.ResponseWriter, e error) {
	var max *http.MaxBytesError
	if errors.As(e, &max) {
		problem(w, 413, "FILE_TOO_LARGE", "上传超过请求大小限制")
	} else {
		problem(w, 400, "UPLOAD_INTERRUPTED", "上传中断或请求格式错误，请重试")
	}
}
