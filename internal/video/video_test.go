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

// packets hashes the coded video packets, which a copy leaves unchanged.
func packets(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command("ffmpeg", "-nostdin", "-v", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "streamhash", "-hash", "md5", "-").Output()
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestWithinLimits(t *testing.T) {
	ok := stream{CodecName: "h264", Profile: "High", Width: 1280, Height: 720, SampleAspectRatio: "1:1", PixFmt: "yuv420p", RFrameRate: "60/1", AvgFrameRate: "60/1", BitRate: "7500000"}
	if !ok.withinLimits("", 1) {
		t.Fatal("at every limit")
	}
	for name, change := range map[string]func(*stream){
		"codec":    func(s *stream) { s.CodecName = "hevc" },
		"profile":  func(s *stream) { s.Profile = "High 10" },
		"width":    func(s *stream) { s.Width = 1282 },
		"odd":      func(s *stream) { s.Height = 719 },
		"pixels":   func(s *stream) { s.SampleAspectRatio = "4:3" },
		"fps":      func(s *stream) { s.AvgFrameRate = "120/1" },
		"timebase": func(s *stream) { s.RFrameRate = "90000/1" },
		"bitrate":  func(s *stream) { s.BitRate = "7500001" },
		"rotation": func(s *stream) { s.SideDataList = []struct{ Rotation float64 }{{-90}} },
	} {
		s := ok
		change(&s)
		if s.withinLimits("", 1) {
			t.Error(name)
		}
	}
	// Without a track bit rate the whole file is measured.
	s := ok
	s.BitRate = ""
	if !s.withinLimits("9375000", 10) || s.withinLimits("9375001", 10) || s.withinLimits("", 10) {
		t.Fatal("file bit rate")
	}
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
	large := generate("large.mp4", "-f", "lavfi", "-i", "testsrc2=size=2560x1440:rate=120:duration=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest")
	out := filepath.Join(dir, "large-out.mp4")
	if err := Transcode(ctx, large, out); err != nil {
		t.Fatal(err)
	}
	s := probe(t, out)
	if len(s) != 1 || s[0].CodecType != "video" || s[0].CodecName != "h264" || s[0].PixFmt != "yuv420p" || s[0].Width != 1280 || s[0].Height != 720 || s[0].Rate != "60/1" {
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
	// H.264 already within the limits is copied as is, only without its sound.
	fit := generate("fit.mov", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=60000/1001:duration=1", "-f", "lavfi", "-i", "sine=duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest")
	out = filepath.Join(dir, "fit-out.mp4")
	if err := Transcode(ctx, fit, out); err != nil {
		t.Fatal(err)
	}
	if s = probe(t, out); len(s) != 1 || s[0].Width != 640 || s[0].Height != 360 || packets(t, out) != packets(t, fit) {
		t.Fatalf("fit: %+v", s)
	}
	// Within size, but 4:4:4 or rotated: re-encoded, the rotation applied.
	full := generate("full.mp4", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv444p")
	rotated := generate("rotated.mp4", "-display_rotation", "90", "-i", fit, "-an", "-c", "copy")
	for source, want := range map[string][2]int{full: {640, 360}, rotated: {360, 640}} {
		out = filepath.Join(dir, "reencoded-"+filepath.Base(source))
		if err := Transcode(ctx, source, out); err != nil {
			t.Fatal(err)
		}
		if s = probe(t, out); len(s) != 1 || s[0].PixFmt != "yuv420p" || s[0].Width != want[0] || s[0].Height != want[1] || packets(t, out) == packets(t, source) {
			t.Fatalf("%s: %+v", source, s)
		}
	}
	// A damaged stream that would otherwise be copied fails the decode check.
	data, err := os.ReadFile(fit)
	if err != nil {
		t.Fatal(err)
	}
	for i := len(data) / 3; i < len(data)/3+4000; i++ {
		data[i] ^= 0x5a
	}
	damaged := filepath.Join(dir, "damaged.mov")
	if err := os.WriteFile(damaged, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := Transcode(ctx, damaged, filepath.Join(dir, "damaged-out.mp4")); !errors.Is(err, ErrInvalid) {
		t.Fatal("damaged:", err)
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
