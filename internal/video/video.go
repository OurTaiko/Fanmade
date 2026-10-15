// Package video validates uploaded background movies and stores them as a
// bounded, silent H.264 MP4, re-encoding only those over the limits.
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

// Upload limits. A stored movie is always within the output limits.
const (
	MaxBytes    = 64 * 1024 * 1024
	MaxDuration = 1200 // seconds, as for audio
	MaxWidth    = 1280
	MaxHeight   = 720
	MaxFPS      = 60
	MaxKbps     = 7500
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

// Transcode writes source's first video track to destination as an MP4
// without audio. A track already within the limits (H.264 8-bit 4:2:0 with
// square pixels, no rotation, at most MaxWidth×MaxHeight, MaxFPS and MaxKbps
// on average) is copied unchanged after a full decode check; any other track is
// re-encoded to H.264, scaled down to fit MaxWidth×MaxHeight, at most MaxFPS
// and about MaxKbps. It returns ErrInvalid for input that cannot be decoded.
func Transcode(ctx context.Context, source, destination string) error {
	out, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-select_streams", "v", "-show_entries", "stream=codec_name,profile,width,height,sample_aspect_ratio,pix_fmt,r_frame_rate,avg_frame_rate,bit_rate:stream_disposition=attached_pic:stream_side_data=rotation:format=duration,size", "-of", "json", source).Output()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return fmt.Errorf("%w: probe failed", ErrInvalid)
	}
	var p struct {
		Streams []stream
		Format  struct{ Duration, Size string }
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
	args := []string{"-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file", "-i", source,
		"-map", fmt.Sprintf("0:v:%d", track), "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1"}
	if p.Streams[track].withinLimits(p.Format.Size, duration) {
		// The second output decodes every frame so a corrupt stream is still rejected.
		args = append(args, "-c:v", "copy", "-movflags", "+faststart", "-f", "mp4", "-n", destination,
			"-map", fmt.Sprintf("0:v:%d", track), "-f", "null", "-")
	} else {
		scale := fmt.Sprintf("scale=w='min(%d,iw)':h='min(%d,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", MaxWidth, MaxHeight)
		args = append(args, "-vf", scale, "-fpsmax", strconv.Itoa(MaxFPS),
			"-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", "-pix_fmt", "yuv420p",
			"-crf", "26", "-maxrate", fmt.Sprintf("%dk", MaxKbps), "-bufsize", fmt.Sprintf("%dk", 2*MaxKbps),
			"-movflags", "+faststart", "-f", "mp4", "-n", destination)
	}
	if detail, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w: %s", ErrInvalid, strings.TrimSpace(string(detail)))
	}
	return nil
}

type stream struct {
	CodecName         string `json:"codec_name"`
	Profile           string
	Width, Height     int
	SampleAspectRatio string `json:"sample_aspect_ratio"`
	PixFmt            string `json:"pix_fmt"`
	RFrameRate        string `json:"r_frame_rate"`
	AvgFrameRate      string `json:"avg_frame_rate"`
	BitRate           string `json:"bit_rate"`
	Disposition       struct {
		AttachedPic int `json:"attached_pic"`
	}
	SideDataList []struct{ Rotation float64 } `json:"side_data_list"`
}

// withinLimits reports whether the track can be stored without re-encoding.
// fileSize is the source size, used when the track has no bit rate of its own.
func (s stream) withinLimits(fileSize string, duration float64) bool {
	switch s.Profile {
	case "Constrained Baseline", "Baseline", "Main", "High":
	default:
		return false
	}
	if s.CodecName != "h264" || s.PixFmt != "yuv420p" || s.Width > MaxWidth || s.Height > MaxHeight || s.Width%2 != 0 || s.Height%2 != 0 {
		return false
	}
	if s.SampleAspectRatio != "" && s.SampleAspectRatio != "1:1" && s.SampleAspectRatio != "0:1" {
		return false
	}
	for _, d := range s.SideDataList {
		if d.Rotation != 0 {
			return false
		}
	}
	for _, r := range []string{s.RFrameRate, s.AvgFrameRate} {
		if f, ok := rate(r); !ok || f > MaxFPS+0.01 {
			return false
		}
	}
	bits, err := strconv.ParseFloat(s.BitRate, 64)
	if err != nil || bits <= 0 {
		size, e := strconv.ParseFloat(fileSize, 64)
		if e != nil || size <= 0 {
			return false
		}
		bits = size * 8 / duration
	}
	return bits <= MaxKbps*1000
}

// rate parses an ffprobe frame rate such as "30000/1001".
func rate(r string) (float64, bool) {
	n, d, ok := strings.Cut(r, "/")
	num, e1 := strconv.ParseFloat(n, 64)
	den, e2 := strconv.ParseFloat(d, 64)
	if !ok || e1 != nil || e2 != nil || num <= 0 || den <= 0 {
		return 0, false
	}
	return num / den, true
}
