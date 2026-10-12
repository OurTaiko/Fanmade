package video

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func probe(t *testing.T, path string) (streams []struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	PixFmt    string `json:"pix_fmt"`
	Width     int
	Height    int
	Rate      string `json:"r_frame_rate"`
}) {
	t.Helper()
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate", "-of", "json", path).Output()
	if err != nil {
		t.Fatal(err)
	}
	var p struct{ Streams json.RawMessage }
	if json.Unmarshal(out, &p) != nil || json.Unmarshal(p.Streams, &streams) != nil {
		t.Fatal("ffprobe output")
	}
	return streams
}

func TestTranscode(t *testing.T) {
	for _, tool := range []string{"ffmpeg", "ffprobe"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skip(tool + " required")
		}
	}
	dir := t.TempDir()
	generate := func(name string, args ...string) string {
		t.Helper()
		path := filepath.Join(dir, name)
		if out, err := exec.Command("ffmpeg", append(append([]string{"-nostdin", "-v", "error"}, args...), path)...).CombinedOutput(); err != nil {
			t.Fatal(string(out))
		}
		return path
	}
	ctx := context.Background()
	// Larger, faster and with sound: every limit applies and the sound is dropped.
	large := generate("large.mp4", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60:duration=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest")
	out := filepath.Join(dir, "large-out.mp4")
	if err := Transcode(ctx, large, out); err != nil {
		t.Fatal(err)
	}
	s := probe(t, out)
	if len(s) != 1 || s[0].CodecType != "video" || s[0].CodecName != "h264" || s[0].PixFmt != "yuv420p" || s[0].Width != 1280 || s[0].Height != 720 || s[0].Rate != "30/1" {
		t.Fatalf("large: %+v", s)
	}
	// Small portrait input with odd dimensions is kept at its size, made even; WebM is accepted.
	small := generate("small.webm", "-f", "lavfi", "-i", "testsrc2=size=241x361:rate=24:duration=1", "-c:v", "libvpx-vp9", "-b:v", "200k")
	out = filepath.Join(dir, "small-out.mp4")
	if err := Transcode(ctx, small, out); err != nil {
		t.Fatal(err)
	}
	if s = probe(t, out); len(s) != 1 || s[0].Width != 240 || s[0].Height != 360 || s[0].Rate != "24/1" {
		t.Fatalf("small: %+v", s)
	}
	// Not a video, and an audio file whose only "video" is embedded cover art.
	text := filepath.Join(dir, "text.mp4")
	if err := os.WriteFile(text, []byte("not a video"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{text, "../audio/testdata/cover.mp3", "../audio/testdata/vorbis.ogg"} {
		if err := Transcode(ctx, source, filepath.Join(dir, "rejected.mp4")); !errors.Is(err, ErrInvalid) {
			t.Fatal(source, err)
		}
	}
	// A cancelled request stops the encoder and is not reported as a bad file.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := Transcode(cancelled, large, filepath.Join(dir, "cancelled.mp4")); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if !ValidExtension("a.MP4") || !ValidExtension("a.webm") || !ValidExtension("a.mov") || ValidExtension("a.avi") || ValidExtension("mp4") {
		t.Fatal("extension allowlist")
	}
}
