package httpapi

import (
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"ourtaiko.dev/sitekit/audio"
	"ourtaiko.dev/sitekit/tja"
)

// replacementBlock is one course×side slot of a replacement as it would land:
// "same" keeps its content hash, "changed" retires its scores from the
// leaderboard, "removed" deletes the block with its scores, "added" is new.
// Scores counts the slot's current leaderboard scores.
type replacementBlock struct {
	Course string `json:"course"`
	Side   string `json:"side"`
	Change string `json:"change"`
	Scores int    `json:"scores"`
}

// previewReplacement reads a new TJA for a chart as the replacement would,
// without storing anything, so the uploader can review what changes before
// sending the audio. Previous is the stored file's own reading (null when it
// can no longer be read), which tells site edits apart from changes in the file.
func (s *Server) previewReplacement(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	c, err := s.chart(r.Context(), r.PathValue("id"))
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
	r.Body = http.MaxBytesReader(w, r.Body, int64(tja.MaxTJA)+64*1024)
	if err = r.ParseMultipartForm(int64(tja.MaxTJA) + 64*1024); err != nil {
		uploadReadError(w, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, header, err := r.FormFile("tja")
	if err != nil || !tja.SafeFilename(header.Filename) || !strings.EqualFold(filepath.Ext(header.Filename), ".tja") {
		problem(w, 400, "UPLOAD_FILES_INVALID", "请选择 TJA 文件")
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, int64(tja.MaxTJA)+1))
	if err != nil {
		internal(w, err)
		return
	}
	normalized, issue := tja.NormalizeUTF8(data)
	if issue != nil {
		respond(w, 422, map[string]any{"code": issue.Code, "message": issue.Message, "errors": []*tja.Issue{issue}, "validationVersion": tja.Version})
		return
	}
	// As the replacement checks WAVE: against new audio, or not at all when the stored audio stays.
	wave := tja.WaveName(normalized)
	if name := r.FormValue("audioName"); name != "" {
		if !tja.SafeFilename(name) || audio.MediaType(name) == "" {
			problem(w, 400, "UPLOAD_FILES_INVALID", "音频文件名无效")
			return
		}
		wave = name
	}
	meta, issue := tja.Parse(normalized, wave)
	if issue != nil {
		respond(w, 422, map[string]any{"code": issue.Code, "message": issue.Message, "errors": []*tja.Issue{issue}, "validationVersion": tja.Version})
		return
	}
	tx, err := s.DB.Begin(r.Context())
	if err != nil {
		internal(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var previous *tja.Metadata
	if parsed, err := s.sourceMetadata(r.Context(), tx, c.ID); err == nil {
		previous = &parsed
	}
	rows, err := tx.Query(r.Context(), `SELECT d.course,d.side,COALESCE(d.content_hash,''),count(sc.id) FILTER (WHERE sc.is_latest)
 FROM chart_difficulties d LEFT JOIN scores sc ON sc.difficulty_id=d.id WHERE d.chart_id=$1 GROUP BY d.id ORDER BY d.id`, c.ID)
	if err != nil {
		internal(w, err)
		return
	}
	type stored struct {
		hash   string
		scores int
	}
	current := map[[2]string]stored{}
	var order [][2]string
	for rows.Next() {
		var slot [2]string
		var v stored
		if err = rows.Scan(&slot[0], &slot[1], &v.hash, &v.scores); err != nil {
			rows.Close()
			internal(w, err)
			return
		}
		current[slot] = v
		order = append(order, slot)
	}
	if err = rows.Err(); err != nil {
		internal(w, err)
		return
	}
	blocks := []replacementBlock{}
	for _, d := range meta.Difficulties {
		slot := [2]string{d.Course, d.Side}
		old, found := current[slot]
		block := replacementBlock{Course: d.Course, Side: d.Side, Change: "added"}
		if found {
			block.Change, block.Scores = "changed", old.scores
			if old.hash == d.Hash {
				block.Change = "same"
			}
			delete(current, slot)
		}
		blocks = append(blocks, block)
	}
	for _, slot := range order {
		if old, found := current[slot]; found {
			blocks = append(blocks, replacementBlock{Course: slot[0], Side: slot[1], Change: "removed", Scores: old.scores})
		}
	}
	respond(w, 200, map[string]any{"metadata": meta, "previous": previous, "blocks": blocks})
}
