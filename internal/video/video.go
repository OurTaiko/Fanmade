// Package video validates uploaded background movies and transcodes them to a
// bounded, silent H.264 MP4.
package video

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Upload limits. The stored movie is always re-encoded within the output limits.
const (
	MaxBytes    = 64 * 1024 * 1024
	MaxDuration = 1200 // seconds, as for audio
	MaxWidth    = 1280
	MaxHeight   = 720
	MaxFPS      = 30
	MaxKbps     = 2000
	Extension   = "mp4"
	MediaType   = "video/mp4"
)

// ErrInvalid reports an upload that is not a usable video.
var ErrInvalid = errors.New("invalid video")

// ValidExtension is the upload extension allowlist. The bytes must pass Transcode.
func ValidExtension(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".webm", ".mov":
		return true
	}
	return false
}

// Transcode writes source's first video track to destination as H.264 MP4
// without audio, scaled down to fit MaxWidth×MaxHeight, at most MaxFPS and
// about MaxKbps. It returns ErrInvalid for input that cannot be decoded.
func Transcode(ctx context.Context, source, destination string) error {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-select_streams", "v", "-show_entries", "stream=width,height:stream_disposition=attached_pic:format=duration", "-of", "json", source).Output()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("%w: probe failed", ErrInvalid)
	}
	var p struct {
		Streams []struct {
			Width, Height int
			Disposition   struct {
				AttachedPic int `json:"attached_pic"`
			}
		}
		Format struct{ Duration string }
	}
	if json.Unmarshal(out, &p) != nil {
		return fmt.Errorf("%w: probe output", ErrInvalid)
	}
	track := -1
	for i, s := range p.Streams {
		// Cover art embedded in an audio file is not a movie.
		if s.Disposition.AttachedPic == 0 && s.Width >= 16 && s.Height >= 16 && s.Width <= 8192 && s.Height <= 8192 {
			track = i
			break
		}
	}
	duration, e := strconv.ParseFloat(p.Format.Duration, 64)
	if track < 0 || e != nil || math.IsNaN(duration) || duration <= 0 || duration > MaxDuration {
		return fmt.Errorf("%w: no usable video track or duration", ErrInvalid)
	}
	scale := fmt.Sprintf("scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", MaxWidth, MaxHeight)
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", source,
		"-map", fmt.Sprintf("0:v:%d", track), "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
		"-vf", scale, "-fpsmax", strconv.Itoa(MaxFPS),
		"-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
		"-crf", "26", "-maxrate", fmt.Sprintf("%dk", MaxKbps), "-bufsize", fmt.Sprintf("%dk", 2*MaxKbps),
		"-movflags", "+faststart", "-f", "mp4", "-n", destination)
	if detail, err := cmd.CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %s", ErrInvalid, strings.TrimSpace(string(detail)))
	}
	return nil
}
