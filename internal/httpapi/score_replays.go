package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
	"net/http"

	"github.com/jackc/pgx/v5"
)

const (
	maxReplayBytes       = 4 << 20
	maxReplayInputs      = 100000
	maxReplayFlipped     = 100000
	maxReplayTimeMS      = 86400000
	maxScoreRequestBytes = (8 << 20) + 8192
)

// replayOptions are the play options of a version 2 recording: the scroll speed in tenths,
// あべこべ, ドロン, ランダム (0 off, 1 きまぐれ, 2 でたらめ) and the notes ランダム flipped, as ascending
// indexes into the block's notes. With them the chart the inputs were played on can be rebuilt.
type replayOptions struct {
	Speed   *int   `json:"speed"`
	Inverse *bool  `json:"inverse"`
	Display *bool  `json:"display"`
	Random  *int   `json:"random"`
	Flipped *[]int `json:"flipped"`
}

func (o *replayOptions) valid() bool {
	if o == nil || o.Speed == nil || *o.Speed < 1 || *o.Speed > 40 || o.Inverse == nil || o.Display == nil ||
		o.Random == nil || *o.Random < 0 || *o.Random > 2 || o.Flipped == nil || len(*o.Flipped) > maxReplayFlipped {
		return false
	}
	last := -1
	for _, index := range *o.Flipped {
		if index <= last {
			return false
		}
		last = index
	}
	if *o.Flipped == nil {
		*o.Flipped = []int{}
	}
	return true
}

// Recordings are optional attachments. Invalid recordings must not discard an
// otherwise valid score. Canonicalize before hashing so invalid/null/absent
// attachments retain the pre-021 payload digest and old retry keys still work.
func normalizeScoreReplay(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || len(raw) > maxReplayBytes {
		return nil
	}
	var envelope struct {
		Version      *int            `json:"version"`
		AudioOffset  *int32          `json:"audio_offset_ms"`
		VisualOffset *int32          `json:"visual_offset_ms"`
		Inputs       json.RawMessage `json:"inputs"`
		Options      *replayOptions  `json:"options,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&envelope) != nil || envelope.Version == nil || (*envelope.Version != 1 && *envelope.Version != 2) ||
		envelope.AudioOffset == nil || envelope.VisualOffset == nil {
		return nil
	}
	// Version 1 has no options; version 2 has all of them.
	if (*envelope.Version == 1) != (envelope.Options == nil) || (envelope.Options != nil && !envelope.Options.valid()) {
		return nil
	}
	var events [][]json.RawMessage
	if json.Unmarshal(envelope.Inputs, &events) != nil || events == nil || len(events) > maxReplayInputs {
		return nil
	}
	inputs := make([][2]float64, 0, len(events))
	for _, event := range events {
		if len(event) != 2 {
			return nil
		}
		var ms *float64
		var key *int
		if json.Unmarshal(event[0], &ms) != nil || json.Unmarshal(event[1], &key) != nil ||
			ms == nil || key == nil || math.IsNaN(*ms) || math.IsInf(*ms, 0) ||
			math.Abs(*ms) > maxReplayTimeMS || *key < 0 || *key > 3 {
			return nil
		}
		// Preserve game consumption order. Hard audio resync can move game time
		// backwards, and multiple inputs in one frame share a timestamp.
		inputs = append(inputs, [2]float64{*ms, float64(*key)})
	}
	canonical, err := json.Marshal(inputs)
	if err != nil {
		return nil
	}
	envelope.Inputs = canonical
	canonical, err = json.Marshal(envelope)
	if err != nil || len(canonical) > maxReplayBytes {
		return nil
	}
	return canonical
}

// scoreReplay is GET /api/v1/scores/{id}/replay, public like the leaderboards: the play and its
// recording. A score without a recording, or on a chart that is not published, has none. The
// inputs were played on the files the score was made with, so the reader checks isLatest
// before showing them over the current chart.
func (s *Server) scoreReplay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var replay []byte
	row := s.DB.QueryRow(r.Context(), `SELECT `+scoreColumns+`,sc.replay_data FROM scores sc
	 JOIN chart_difficulties d ON d.id=sc.difficulty_id JOIN charts c ON c.id=d.chart_id
	 WHERE sc.id=$1 AND sc.replay_data IS NOT NULL AND `+publishedChart, id)
	var v Score
	err := row.Scan(&v.ID, &v.UserID, &v.SongID, &v.DifficultyID, &v.Course, &v.Side, &v.Good, &v.OK, &v.Bad, &v.Score, &v.Drumroll, &v.MaxCombo, &v.ClearStatus, &v.IsLatest, &v.SubmittedAt, &v.AdLib, &v.Mines, &v.HasReplay, &replay)
	if errors.Is(err, pgx.ErrNoRows) {
		problem(w, 404, "REPLAY_NOT_FOUND", "这条成绩没有回放")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	profile := s.publicProfiles(r.Context(), []string{v.UserID})[v.UserID]
	respond(w, 200, map[string]any{"score": v, "nickname": profile.Nickname, "avatarUrl": profile.AvatarURL, "replay": json.RawMessage(replay)})
}
