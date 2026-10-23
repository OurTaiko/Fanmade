package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/fanmade/api/internal/audio"
	"ourtaiko.dev/fanmade/api/internal/cover"
	"ourtaiko.dev/fanmade/api/internal/tja"
	"ourtaiko.dev/fanmade/api/internal/video"
)

// uploadJob is an accepted upload: its files are staged and its fast checks
// passed. Decoding, transcoding and storing happen after the request returns.
type uploadJob struct {
	user, key, dir           string
	existingID               string // set when replacing a chart's files
	audioHash, movieHash     string // files of that chart the upload keeps
	tja, audio, cover, movie *stagedFile
	normalized               []byte
	meta                     tja.Metadata
	description              string
	categoryIDs              []string
	demoStart, demoEnd       float64
	keepMovie, async         bool
	done                     chan uploadResult
}

// fileFailure names an optional file that was left out of a published chart.
type fileFailure struct {
	File string `json:"file"`
	Code string `json:"code"`
}

// uploadError rejects the whole upload. cause marks an internal failure.
type uploadError struct {
	status        int
	code, message string
	cause         error
}

type uploadResult struct {
	chart Chart
	err   *uploadError
}

const (
	// Jobs waiting with staged files; temporary storage holds about this many.
	maxPendingUploads = 4
	uploadTimeout     = 20 * time.Minute
	movieTimeout      = 15 * time.Minute
)

func (s *Server) enqueue(j *uploadJob) {
	s.worker.Do(func() { go s.runUploads() })
	s.jobs <- j
}

// One job at a time: decoding and transcoding are CPU-bound.
func (s *Server) runUploads() {
	for j := range s.jobs {
		ctx, cancel := context.WithTimeout(context.Background(), uploadTimeout)
		result := s.processUpload(ctx, j)
		os.RemoveAll(j.dir)
		s.finishUpload(j, result)
		cancel()
		<-s.pending
		j.done <- result
	}
}

func rejected(status int, code, message string) uploadResult {
	return uploadResult{err: &uploadError{status: status, code: code, message: message}}
}
func failed(cause error) uploadResult {
	return uploadResult{err: &uploadError{status: 503, code: "SERVICE_UNAVAILABLE", cause: cause}}
}

// processUpload decodes and stores an accepted upload. A bad TJA or audio
// rejects everything before any object is written; a bad cover or movie is
// left out and reported while the chart is still published.
func (s *Server) processUpload(ctx context.Context, j *uploadJob) uploadResult {
	var failures []fileFailure
	af := j.audio
	if j.existingID != "" {
		current, err := s.chart(ctx, j.existingID)
		if errors.Is(err, pgx.ErrNoRows) {
			return rejected(404, "CHART_NOT_FOUND", "歌曲不存在或已下架")
		}
		if err != nil {
			return failed(err)
		}
		// Kept files must still be the ones the uploader saw.
		if (af == nil && current.AudioHash != j.audioHash) || (j.keepMovie && current.MovieHash != j.movieHash) {
			return rejected(409, "CHART_FILES_CHANGED", "歌曲文件已被其他更新替换，请重新打开歌曲页面后上传")
		}
		if af == nil {
			if af, err = s.copyAudio(ctx, &current, j.dir); err != nil {
				return failed(err)
			}
		}
	}
	duration, err := audio.Validate(ctx, af.path, af.name)
	if err != nil {
		return rejected(422, "AUDIO_INVALID", "音频未通过完整性检查，请使用完整的单音轨 Ogg Vorbis 或 MP3 文件（最长 20 分钟）")
	}
	if !audio.ValidPreviewRange(j.demoStart, j.demoEnd, duration) {
		return rejected(422, "PREVIEW_RANGE_INVALID", "试听起点必须位于音频范围内，终点须晚于起点且不超过 1215 秒")
	}
	var coverData []byte
	if j.cover != nil {
		raw, err := os.ReadFile(j.cover.path)
		if err != nil {
			return failed(err)
		}
		coverData, err = cover.Encode(ctx, j.cover.name, raw)
		if errors.Is(err, cover.ErrInvalid) {
			failures = append(failures, fileFailure{"cover", "COVER_INVALID"})
		} else if err != nil {
			return failed(err)
		}
	}
	// The movie is stored without sound, re-encoded only if over the limits.
	var moviePath, movieSHA string
	var movieSize int64
	if j.movie != nil {
		moviePath = filepath.Join(j.dir, "movie."+video.Extension)
		limited, cancel := context.WithTimeout(ctx, movieTimeout)
		err = video.Transcode(limited, j.movie.path, moviePath)
		cancel()
		switch {
		case errors.Is(err, video.ErrInvalid):
			failures = append(failures, fileFailure{"movie", "MOVIE_INVALID"})
		case errors.Is(err, context.DeadlineExceeded) && ctx.Err() == nil:
			failures = append(failures, fileFailure{"movie", "MOVIE_TOO_SLOW"})
		case err != nil:
			return failed(err)
		default:
			if movieSHA, movieSize, err = fileDigest(moviePath); err != nil {
				return failed(err)
			}
		}
	} else if j.keepMovie {
		movieSHA = j.movieHash
	}
	// The stored TJA names its audio and movie by content, matching their
	// objects. A movie that was left out is no longer declared.
	waveName := af.sha + "." + fileExtension(af.name)
	stored, ok := tja.SetWave(j.normalized, waveName)
	if ok && j.meta.Movie != "" {
		name := ""
		if movieSHA != "" {
			name = movieSHA + "." + video.Extension
		}
		stored, ok = tja.SetMovie(stored, name)
	}
	if !ok {
		return failed(errors.New("validated TJA lost a rewritten header"))
	}
	if _, issue := tja.Parse(stored, "utf-8", waveName); issue != nil {
		return rejected(422, issue.Code, issue.Message)
	}
	tjaPath := filepath.Join(j.dir, "stored.tja")
	if err = os.WriteFile(tjaPath, stored, 0600); err != nil {
		return failed(err)
	}
	storedHash := sha256.Sum256(stored)
	tjaSHA := hex.EncodeToString(storedHash[:])

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return failed(err)
	}
	defer tx.Rollback(context.Background())
	chartID := ID()
	var movieFile *int64
	var replacedTJA, replacedAudio string
	if j.existingID != "" {
		chartID = j.existingID
		// Serialize with other replacements, deletion and score submissions, and
		// confirm the kept files once more now that nothing can change them.
		var audioSHA, currentMovie string
		err = tx.QueryRow(ctx, `SELECT af.sha256,tf.sha256,COALESCE(mf.sha256,''),c.movie_file FROM charts c JOIN chart_resources af ON af.id=c.audio_file
 JOIN chart_resources tf ON tf.id=c.tja_file LEFT JOIN chart_resources mf ON mf.id=c.movie_file WHERE c.id=$1 AND `+publishedChart+` FOR UPDATE OF c`, chartID).Scan(&audioSHA, &replacedTJA, &currentMovie, &movieFile)
		replacedAudio = audioSHA
		if errors.Is(err, pgx.ErrNoRows) {
			return rejected(404, "CHART_NOT_FOUND", "歌曲不存在或已下架")
		}
		if err != nil {
			return failed(err)
		}
		if (j.audio == nil && audioSHA != j.audioHash) || (j.keepMovie && currentMovie != j.movieHash) {
			return rejected(409, "CHART_FILES_CHANGED", "歌曲文件已被其他更新替换，请重新打开歌曲页面后上传")
		}
		if !j.keepMovie {
			movieFile = nil
		}
	}
	committed := false
	defer func() {
		if !committed {
			// Shared objects are never deleted directly; the cleaner removes
			// these only if no chart refers to them.
			written := []string{tjaSHA + ".tja", waveName}
			if moviePath != "" && movieSHA != "" {
				written = append(written, movieSHA+"."+video.Extension)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			_, _ = s.DB.Exec(ctx, `INSERT INTO retired_files(storage_key) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`, written)
		}
	}()
	// A fixed order keeps concurrent identical uploads from deadlocking.
	tjaFile, err := s.storeFile(ctx, tx, tjaPath, j.tja.name, "tja", "application/octet-stream", tjaSHA, int64(len(stored)))
	if err != nil {
		return failed(err)
	}
	audioFile, err := s.storeFile(ctx, tx, af.path, af.name, fileExtension(af.name), audio.MediaType(af.name), af.sha, af.size)
	if err != nil {
		return failed(err)
	}
	if moviePath != "" && movieSHA != "" {
		file, err := s.storeFile(ctx, tx, moviePath, "movie."+video.Extension, video.Extension, video.MediaType, movieSHA, movieSize)
		if err != nil {
			return failed(err)
		}
		movieFile = &file
	}
	if j.existingID != "" {
		if err = retireChart(ctx, tx, chartID, j.description, replacedAudio != af.sha); err != nil {
			return failed(err)
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO charts(id,owner_ids,description,title,subtitle,bpm,offset_seconds,demo_start,duration,title_translations,subtitle_translations,demo_end,tja_file,audio_file,movie_file,movie_offset)
 VALUES($1,ARRAY[$2::text],$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
 ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,subtitle=EXCLUDED.subtitle,bpm=EXCLUDED.bpm,offset_seconds=EXCLUDED.offset_seconds,demo_start=EXCLUDED.demo_start,demo_end=EXCLUDED.demo_end,duration=EXCLUDED.duration,tja_file=EXCLUDED.tja_file,audio_file=EXCLUDED.audio_file,movie_file=EXCLUDED.movie_file,movie_offset=EXCLUDED.movie_offset,title_translations=EXCLUDED.title_translations,subtitle_translations=EXCLUDED.subtitle_translations`,
		chartID, j.user, j.description, j.meta.Title, j.meta.Subtitle, j.meta.BPM, j.meta.Offset, j.demoStart, duration, j.meta.TitleTranslations, j.meta.SubtitleTranslations, j.demoEnd, tjaFile, audioFile, movieFile, j.meta.MovieOffset); err != nil {
		return failed(err)
	}
	if err = setDifficulties(ctx, tx, chartID, j.meta.Difficulties); err != nil {
		return failed(err)
	}
	if err = s.savePreview(ctx, tx, chartID, af.path, j.demoStart, j.demoEnd, duration); err != nil {
		return failed(err)
	}
	if coverData != nil {
		if err = s.saveCover(ctx, tx, chartID, coverData); err != nil {
			return failed(err)
		}
	}
	if err = setCategories(ctx, tx, chartID, j.categoryIDs); err != nil {
		return failed(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE upload_requests SET status='done',chart_id=$3,tja_sha256=$4,audio_sha256=$5 WHERE user_id=$1 AND idempotency_key=$2`, j.user, j.key, chartID, tjaSHA, af.sha); err != nil {
		return failed(err)
	}
	// A lost connection during COMMIT may have committed. Keep objects for reconciliation.
	committed = true
	if err = tx.Commit(ctx); err != nil {
		return failed(err)
	}
	if j.existingID != "" {
		s.cleanupReplacedFiles()
	}
	chart, err := s.chart(ctx, chartID)
	if err != nil {
		return failed(err)
	}
	chart.FailedFiles = failures
	return uploadResult{chart: chart}
}

// finishUpload releases a rejected upload's receipt, so the same request can
// be sent again, and tells an uploader who did not wait what happened.
func (s *Server) finishUpload(j *uploadJob, result uploadResult) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	data := map[string]any{"title": j.meta.Title, "status": "published"}
	chartID := result.chart.ID
	if j.existingID != "" {
		data["status"] = "updated"
	}
	if result.err != nil {
		if result.err.cause != nil {
			log.Printf("upload %s failed: %v", j.key, result.err.cause)
		}
		if _, err := s.DB.Exec(ctx, `DELETE FROM upload_requests WHERE user_id=$1 AND idempotency_key=$2 AND status='processing'`, j.user, j.key); err != nil {
			log.Printf("upload receipt cleanup failed: %v", err)
		}
		data["status"], data["code"], chartID = "failed", result.err.code, j.existingID
	} else if len(result.chart.FailedFiles) > 0 {
		data["failedFiles"] = result.chart.FailedFiles
	}
	if !j.async {
		return
	}
	if err := notify(ctx, s.DB, Notice{Recipient: j.user, Kind: "upload_result", ChartID: chartID, DedupeKey: "upload:" + j.key, Data: data}); err != nil {
		log.Printf("upload notification failed: %v", err)
	}
}

// FailInterruptedUploads runs once at startup. Staged files do not survive a
// restart, so uploads that were still being processed are reported as failed.
func (s *Server) FailInterruptedUploads(ctx context.Context) error {
	rows, err := s.DB.Query(ctx, `DELETE FROM upload_requests WHERE status='processing' RETURNING user_id,idempotency_key,title,COALESCE(chart_id,'')`)
	if err != nil {
		return err
	}
	type interrupted struct{ user, key, title, chart string }
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (v interrupted, e error) {
		e = row.Scan(&v.user, &v.key, &v.title, &v.chart)
		return
	})
	if err != nil {
		return err
	}
	for _, v := range items {
		if err = notify(ctx, s.DB, Notice{Recipient: v.user, Kind: "upload_result", ChartID: v.chart, DedupeKey: "upload:" + v.key,
			Data: map[string]any{"title": v.title, "status": "failed", "code": "UPLOAD_INTERRUPTED"}}); err != nil {
			return err
		}
	}
	return nil
}
