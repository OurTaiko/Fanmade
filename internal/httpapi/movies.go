package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/sitekit/tja"
	"ourtaiko.dev/sitekit/video"
)

// replaceMovie sets a chart's background movie apart from its other files, as
// replaceCover sets its cover. The multipart body holds one "movie" file and
// optionally "movieOffset" (seconds; the current offset when left out). The
// movie is transcoded by the upload worker; with Prefer: respond-async the
// answer is 202 and the result arrives as an upload_result notification.
func (s *Server) replaceMovie(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	c, err := s.chart(r.Context(), r.PathValue("id"))
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在或已删除")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	if !c.hasOwner(u.User.ID) && !u.User.IsAdmin {
		problem(w, 403, "FORBIDDEN", "只有上传者或管理员可以修改背景视频")
		return
	}
	select {
	case s.uploads <- struct{}{}:
		defer func() { <-s.uploads }()
	default:
		problem(w, 503, "UPLOAD_BUSY", "当前正在处理其他上传，请稍后重试")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, video.MaxBytes+64*1024)
	mr, err := r.MultipartReader()
	if err != nil {
		problem(w, 400, "UPLOAD_FILES_INVALID", "请选择一个 MP4、WebM 或 MOV 视频")
		return
	}
	dir, err := os.MkdirTemp(s.Config.Storage, "staging-movie-")
	if err != nil {
		internal(w, err)
		return
	}
	accepted := false
	defer func() {
		if !accepted {
			os.RemoveAll(dir)
		}
	}()
	var movie *stagedFile
	offset, offsetSent := c.MovieOffset, false
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			uploadReadError(w, err)
			return
		}
		disposition, params, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		field, name := params["name"], params["filename"]
		switch {
		case err != nil || disposition != "form-data":
			problem(w, 400, "UPLOAD_FILES_INVALID", "上传字段格式错误")
			return
		case field == "movie":
			if movie != nil || !tja.SafeFilename(name) || !video.ValidExtension(name) {
				problem(w, 400, "UPLOAD_FILES_INVALID", "只能上传一个 MP4、WebM 或 MOV 视频，文件名不能包含路径")
				return
			}
			movie = &stagedFile{name: name, path: filepath.Join(dir, "movie")}
			out, err := os.OpenFile(movie.path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				internal(w, err)
				return
			}
			h := sha256.New()
			n, copyErr := io.Copy(io.MultiWriter(out, h), io.LimitReader(part, video.MaxBytes+1))
			closeErr := out.Close()
			if copyErr != nil {
				uploadReadError(w, copyErr)
				return
			}
			if closeErr != nil {
				internal(w, closeErr)
				return
			}
			if n == 0 || n > video.MaxBytes {
				problem(w, 413, "FILE_TOO_LARGE", "视频为空或超过 64 MiB")
				return
			}
			movie.size, movie.sha = n, hex.EncodeToString(h.Sum(nil))
		case field == "movieOffset" && name == "" && !offsetSent:
			data, err := io.ReadAll(io.LimitReader(part, 65))
			if err != nil {
				uploadReadError(w, err)
				return
			}
			if offset, ok = parseMovieOffset(string(data)); !ok {
				problem(w, 422, "TJA_MOVIE_OFFSET_INVALID", "MOVIEOFFSET 必须为秒数，绝对值不超过 1200")
				return
			}
			offsetSent = true
		default:
			problem(w, 400, "UPLOAD_FILES_INVALID", "包含不支持或重复的上传字段")
			return
		}
		part.Close()
	}
	if movie == nil {
		problem(w, 400, "UPLOAD_FILES_INVALID", "请选择一个 MP4、WebM 或 MOV 视频")
		return
	}
	select {
	case s.pending <- struct{}{}:
	default:
		problem(w, 503, "UPLOAD_BUSY", "当前排队处理的上传较多，请稍后重试")
		return
	}
	job := &uploadJob{
		user: u.User.ID, key: ID(), dir: dir, existingID: c.ID, movie: movie, movieOnly: true,
		meta:  tja.Metadata{Title: c.Title, MovieOffset: offset},
		async: strings.Contains(strings.ToLower(r.Header.Get("Prefer")), "respond-async"), done: make(chan uploadResult, 1),
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
	respond(w, 200, result.chart)
}

func parseMovieOffset(raw string) (float64, bool) {
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	return n, err == nil && video.ValidOffset(n)
}

// processMovie transcodes a job's movie and makes it the chart's, unlike an
// upload rejecting the job when the movie cannot be used.
func (s *Server) processMovie(ctx context.Context, j *uploadJob) uploadResult {
	moviePath := filepath.Join(j.dir, "movie."+video.Extension)
	limited, cancel := context.WithTimeout(ctx, movieTimeout)
	err := video.Transcode(limited, j.movie.path, moviePath)
	cancel()
	switch {
	case errors.Is(err, video.ErrInvalid):
		return rejected(422, "MOVIE_INVALID", "视频无法解码，请使用有效的 MP4、WebM 或 MOV（最长 20 分钟）")
	case errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil:
		return rejected(422, "MOVIE_TOO_SLOW", "视频转码超时，请缩短视频或降低分辨率后重试")
	case err != nil:
		return failed(err)
	}
	movieSHA, movieSize, err := fileDigest(moviePath)
	if err != nil {
		return failed(err)
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return failed(err)
	}
	defer tx.Rollback(context.Background())
	// Serialize with replacements, deletion and metadata edits.
	var locked string
	err = tx.QueryRow(ctx, `SELECT c.id FROM charts c WHERE c.id=$1 AND `+publishedChart+` FOR UPDATE`, j.existingID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return rejected(404, "CHART_NOT_FOUND", "作品不存在或已删除")
	}
	if err != nil {
		return failed(err)
	}
	movieFile, err := s.storeFile(ctx, tx, moviePath, "movie."+video.Extension, video.Extension, video.MediaType, movieSHA, movieSize)
	if err != nil {
		return failed(err)
	}
	if err = s.rewriteMovie(ctx, tx, j.existingID, movieSHA, &movieFile, j.meta.MovieOffset); err != nil {
		return failed(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return failed(err)
	}
	s.cleanupReplacedFiles()
	chart, err := s.chart(ctx, j.existingID)
	if err != nil {
		return failed(err)
	}
	return uploadResult{chart: chart}
}

// rewriteMovie stores the chart's TJA with BGMOVIE naming the movie movieSHA
// and MOVIEOFFSET set to offset, then points the chart at that TJA, the
// movie (movieFile, or the current one when nil) and the offset. Players read
// both headers from the TJA; its chart blocks, and so the scores, are kept.
// tx must hold the chart's row lock.
func (s *Server) rewriteMovie(ctx context.Context, tx pgx.Tx, chartID, movieSHA string, movieFile *int64, offset float64) error {
	tjaFile, err := s.rewriteStoredTJA(ctx, tx, chartID, func(data []byte) ([]byte, bool) {
		stored, ok := tja.SetMovieHeaders(data, movieSHA+"."+video.Extension, offset)
		return stored, ok && tja.MovieName(stored) == movieSHA+"."+video.Extension
	})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE charts SET tja_file=$2,movie_file=COALESCE($3,movie_file),movie_offset=$4 WHERE id=$1`, chartID, tjaFile, movieFile, offset)
	return err
}

// rewriteStoredTJA stores the chart's TJA as edit changes it and returns the new file, for
// the caller to point the chart at. Only headers change, so a file stored under older rules
// is not judged again. tx must hold the chart's row lock.
func (s *Server) rewriteStoredTJA(ctx context.Context, tx pgx.Tx, chartID string, edit func([]byte) ([]byte, bool)) (int64, error) {
	var key, name string
	if err := tx.QueryRow(ctx, `SELECT r.storage_key,r.original_filename FROM charts c JOIN chart_resources r ON r.id=c.tja_file WHERE c.id=$1`, chartID).Scan(&key, &name); err != nil {
		return 0, err
	}
	f, err := s.Config.Objects.Open(ctx, key)
	if err != nil {
		return 0, err
	}
	data, err := io.ReadAll(io.LimitReader(f, tja.MaxTJA+1))
	f.Close()
	if err != nil {
		return 0, err
	}
	stored, ok := edit(data)
	if !ok || len(stored) > tja.MaxTJA {
		return 0, fmt.Errorf("stored TJA of %s cannot take its new headers", chartID)
	}
	staged, err := os.CreateTemp(s.Config.Storage, "staging-tja-")
	if err != nil {
		return 0, err
	}
	defer os.Remove(staged.Name())
	_, err = staged.Write(stored)
	if err = errors.Join(err, staged.Close()); err != nil {
		return 0, err
	}
	digest := sha256.Sum256(stored)
	return s.storeFile(ctx, tx, staged.Name(), name, "tja", "application/octet-stream", hex.EncodeToString(digest[:]), int64(len(stored)))
}
