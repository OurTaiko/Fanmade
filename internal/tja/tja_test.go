package tja

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestSharedContract(t *testing.T) {
	if !Available() {
		t.Skip("tjaparser not found: set TJAPARSER_BIN or put it on PATH")
	}
	data, err := os.ReadFile("../../contracts/validation.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name, Text, Audio, Code, Encoding string
		Raw                               []byte
		Line                              int
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			b := []byte(c.Text)
			if c.Raw != nil {
				b = c.Raw
			}
			m, e := Parse(b, c.Encoding, c.Audio)
			code := ""
			if e != nil {
				code = e.Code
			}
			if code != c.Code {
				t.Fatalf("wanted %s, got %s: %v", c.Code, code, e)
			}
			if e != nil && c.Line > 0 && e.Line != c.Line {
				t.Fatalf("wanted line %d, got %d", c.Line, e.Line)
			}
			if e == nil && (m.Title == "" || len(m.Difficulties) == 0) {
				t.Fatal("missing parsed metadata")
			}
		})
	}
}
func FuzzParse(f *testing.F) {
	f.Add([]byte("TITLE:Test\nBPM:120\nWAVE:music.ogg\nLEVEL:5\n#START\n1000,\n#END"))
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) <= MaxTJA {
			Parse(b, "utf-8", "music.ogg")
		}
	})
}

// NOTESDESIGNER0–4 credit one course each and win over MAKER; Ura is Edit.
func TestNotesDesigners(t *testing.T) {
	source := "TITLE:Song\nBPM:120\nWAVE:a.ogg\nMAKER:All\nNOTESDESIGNER3:Oni maker\nNOTESDESIGNER4:Edit maker\n" +
		"COURSE:Oni\nLEVEL:8\n#START\n1,\n#END\nCOURSE:Ura\nLEVEL:9\n#START\n1,\n#END\nCOURSE:Easy\nLEVEL:2\n#START\n1,\n#END\n"
	m, issue := parse([]byte(source), "utf-8", "a.ogg", true)
	if issue != nil {
		t.Fatal(issue)
	}
	got := []string{}
	for _, d := range m.Difficulties {
		got = append(got, d.Course+"="+d.Maker)
	}
	if want := "[Oni=Oni maker Edit=Edit maker Easy=All]"; fmt.Sprint(got) != want {
		t.Fatalf("makers %v, want %s", got, want)
	}
}
