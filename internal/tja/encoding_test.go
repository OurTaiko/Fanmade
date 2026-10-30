package tja

import (
	"bytes"
	"testing"

	"golang.org/x/text/encoding/japanese"
)

func TestNormalizeUTF8(t *testing.T) {
	want := []byte("TITLE:初音ミク\r\nWAVE:音楽.mp3\r\n")
	for _, data := range [][]byte{want, append([]byte("\uFEFF"), want...)} {
		got, issue := NormalizeUTF8(data)
		if issue != nil || !bytes.Equal(got, want) {
			t.Fatalf("%q: %v, %q", data, issue, got)
		}
	}
	// Uploads are UTF-8 only; the browser converts Shift-JIS and the rest first.
	sjis, err := japanese.ShiftJIS.NewEncoder().Bytes(want)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		data []byte
		code string
	}{
		{sjis, "TJA_ENCODING_INVALID"},
		{[]byte{0xff}, "TJA_ENCODING_INVALID"},
		{[]byte("\uFFFD"), "TJA_ENCODING_INVALID"},
		{[]byte("TITLE:a\x00"), "TJA_ENCODING_INVALID"},
		{[]byte("\uFEFF"), "FILE_SIZE_INVALID"},
		{bytes.Repeat([]byte("a"), MaxTJA+1), "FILE_SIZE_INVALID"},
	} {
		_, issue := NormalizeUTF8(tc.data)
		if issue == nil || issue.Code != tc.code {
			t.Fatalf("%q: %v", tc.data[:min(len(tc.data), 16)], issue)
		}
	}
}
