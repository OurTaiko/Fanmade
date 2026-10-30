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

func TestMovieHeaders(t *testing.T) {
	const source = "TITLE:A\r\nBPM:120\r\nWAVE:a.ogg\r\nBGMOVIE: 映像.MP4 // clip\r\nMOVIEOFFSET:-0.25\r\nCOURSE:Oni\r\nLEVEL:5\r\n#START\r\n1,\r\n#END\r\n"
	m, issue := Parse([]byte(source), "a.ogg")
	if issue != nil || m.Movie != "映像.MP4" || m.MovieOffset != -0.25 || MovieName([]byte(source)) != "映像.MP4" {
		t.Fatal(m.Movie, m.MovieOffset, issue)
	}
	stored, ok := SetMovie([]byte(source), "x.mp4")
	if !ok || string(stored) != "TITLE:A\r\nBPM:120\r\nWAVE:a.ogg\r\nBGMOVIE:x.mp4\r\nMOVIEOFFSET:-0.25\r\nCOURSE:Oni\r\nLEVEL:5\r\n#START\r\n1,\r\n#END\r\n" {
		t.Fatalf("%q", stored)
	}
	if m, issue = Parse(stored, "a.ogg"); issue != nil || m.Movie != "x.mp4" || m.MovieOffset != -0.25 {
		t.Fatal(m.Movie, issue)
	}
	// No movie: the offset defaults to zero and there is nothing to rewrite.
	plain := "TITLE:A\nBPM:120\nWAVE:a.ogg\nCOURSE:Oni\nLEVEL:5\n#START\n1,\n#END\n"
	if m, issue = Parse([]byte(plain), "a.ogg"); issue != nil || m.Movie != "" || m.MovieOffset != 0 {
		t.Fatal(m.Movie, m.MovieOffset, issue)
	}
	if _, ok = SetMovie([]byte(plain), "x.mp4"); ok || MovieName([]byte(plain)) != "" {
		t.Fatal("unexpected BGMOVIE header")
	}
}
