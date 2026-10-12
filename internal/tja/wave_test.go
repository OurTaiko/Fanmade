package tja

import "testing"

func TestSetWave(t *testing.T) {
	for _, tc := range []struct{ name, in, want, declared string }{
		{"LF", "TITLE:A\nWAVE:song.ogg\nCOURSE:Oni\n#START\n1,\n#END\n", "TITLE:A\nWAVE:x.ogg\nCOURSE:Oni\n#START\n1,\n#END\n", "song.ogg"},
		{"CRLF", "TITLE:A\r\nWAVE: 音楽.mp3 \r\n#START\r\n", "TITLE:A\r\nWAVE:x.ogg\r\n#START\r\n", "音楽.mp3"},
		{"comment and indent", "  WAVE:a.ogg // audio\n#START\n", "WAVE:x.ogg\n#START\n", "a.ogg"},
		{"last line", "TITLE:A\nWAVE:a.ogg", "TITLE:A\nWAVE:x.ogg", "a.ogg"},
		{"only the header", "WAVE:a.ogg\n#START\nWAVE:b.ogg\n", "WAVE:x.ogg\n#START\nWAVE:b.ogg\n", "a.ogg"},
	} {
		if got := WaveName([]byte(tc.in)); got != tc.declared {
			t.Fatalf("%s: declared %q", tc.name, got)
		}
		got, ok := SetWave([]byte(tc.in), "x.ogg")
		if !ok || string(got) != tc.want {
			t.Fatalf("%s: %q", tc.name, got)
		}
		// Rewriting is stable, so a rekeyed file is never rewritten differently.
		if again, _ := SetWave(got, "x.ogg"); string(again) != tc.want {
			t.Fatalf("%s: unstable %q", tc.name, again)
		}
	}
	for _, in := range []string{"TITLE:A\n#START\nWAVE:a.ogg\n", "wave:a.ogg\n", ""} {
		if _, ok := SetWave([]byte(in), "x.ogg"); ok || WaveName([]byte(in)) != "" {
			t.Fatalf("unexpected header in %q", in)
		}
	}
}
