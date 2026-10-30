package tja

import (
	"strings"
	"testing"

	"golang.org/x/text/encoding/japanese"
)

func TestLocalizedTitles(t *testing.T) {
	const headers = "TITLE:English\nSUBTITLE:--Default\nTITLEJA:日本語\nTITLEZH:中文\nTITLEKO:한국어\nSUBTITLEJA:--副題\nSUBTITLEZH:++副标题\nSUBTITLEKO:\n"
	const chart = "BPM:120\nWAVE:music.ogg\nLEVEL:5\n#START\n1000,\n#END\n"
	m, issue := Parse([]byte("\uFEFF"+headers+chart), "music.ogg")
	if issue != nil {
		t.Fatal(issue)
	}
	// The dictionaries are the file's: "origin" is TITLE/SUBTITLE itself; "en" only when written.
	if m.Title != "English" || m.Subtitle != "--Default" || len(m.TitleTranslations) != 4 || m.TitleTranslations["origin"] != "English" || m.SubtitleTranslations["origin"] != "--Default" || m.TitleTranslations["ja"] != "日本語" || m.TitleTranslations["zh"] != "中文" || m.TitleTranslations["ko"] != "한국어" || m.SubtitleTranslations["ja"] != "--副題" || m.SubtitleTranslations["zh"] != "++副标题" {
		t.Fatalf("lost localization: %+v", m)
	}
	if _, ok := m.TitleTranslations["en"]; ok {
		t.Fatal("en is not defaulted from TITLE any more")
	}
	if v, ok := m.SubtitleTranslations["ko"]; !ok || v != "" {
		t.Fatal("explicit empty translation lost")
	}
	m, issue = Parse([]byte("TITLEEN:Explicit English\nSUBTITLEEN:Translated subtitle\n"+headers+chart), "music.ogg")
	if issue != nil || m.Title != "English" || m.Subtitle != "--Default" || m.TitleTranslations["en"] != "Explicit English" || m.SubtitleTranslations["en"] != "Translated subtitle" {
		t.Fatalf("English translation must not replace original: %+v %v", m, issue)
	}
	for _, bad := range []string{headers + "TITLEJA:Duplicate\n" + chart, headers + chart + "TITLEZH:Late\n", "TITLE:English\nTITLEJA:" + strings.Repeat("a", 501) + "\n" + chart} {
		_, issue := Parse([]byte(bad), "music.ogg")
		if issue == nil || issue.Code != "TJA_STRUCTURE_INVALID" || issue.Line == 0 {
			t.Fatalf("expected localized field validation: %v", issue)
		}
	}
	data, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte("TITLE:English\nTITLEJA:日本語\nSUBTITLEJA:副題\n" + chart))
	if err != nil {
		t.Fatal(err)
	}
	// Uploads are UTF-8 only; the browser converts Shift-JIS first.
	if _, issue = Parse(data, "music.ogg"); issue == nil || issue.Code != "TJA_ENCODING_INVALID" {
		t.Fatalf("Shift-JIS must be refused: %v", issue)
	}
	m, issue = Parse([]byte("TITLE:English\n"+chart), "music.ogg")
	if issue != nil || m.TitleTranslations == nil || m.SubtitleTranslations == nil || len(m.TitleTranslations) != 1 || m.TitleTranslations["origin"] != "English" {
		t.Fatal("the origin must be included")
	}
	// The game's locale mapping applies: TITLEJP and TITLECN are ja and zh too.
	m, issue = Parse([]byte("TITLE:English\nTITLEJP:日本\nSUBTITLECN:--中\n"+chart), "music.ogg")
	if issue != nil || m.TitleTranslations["ja"] != "日本" || m.SubtitleTranslations["zh"] != "--中" {
		t.Fatalf("locale aliases: %+v %v", m, issue)
	}
}
