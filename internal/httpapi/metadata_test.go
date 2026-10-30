package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"ourtaiko.dev/sitekit/tja"
)

func TestMetadataPatch(t *testing.T) {
	original := metadataTranslations{map[string]string{"en": "Source", "ja": "原文"}, map[string]string{"en": ""}}
	o := metadataTranslations{map[string]string{"en": "Edited", "ja": "旧名", "zh": "中文"}, map[string]string{"ja": "副題"}}
	var p metadataPatch
	if err := json.Unmarshal([]byte(`{"titleTranslations":{"ja":"新名","zh":null},"subtitleTranslations":null}`), &p); err != nil {
		t.Fatal(err)
	}
	if !p.apply(&o, original) || o.Titles["en"] != "Edited" || o.Titles["ja"] != "新名" || len(o.Titles) != 2 || o.Subtitles["en"] != "" || len(o.Subtitles) != 1 {
		t.Fatalf("patch/reset: %+v", o)
	}
	if !(metadataPatch{TitleTranslations: json.RawMessage(`{"en":"English","ko":"한국어"}`)}).apply(&o, original) || o.Titles["en"] != "English" || o.Titles["ko"] != "한국어" || o.Titles["ja"] != "新名" {
		t.Fatal("English must use the same dictionary")
	}
	for _, body := range []string{`{}`, `null`, `{"titleTranslations":{"de":"Unsupported"}}`, `{"titleTranslations":{"ja":""}}`, `{"subtitleTranslations":[]}`} {
		var bad metadataPatch
		if err := json.Unmarshal([]byte(body), &bad); err != nil {
			t.Fatal(err)
		}
		if bad.apply(&metadataTranslations{}, original) {
			t.Fatalf("accepted %s", body)
		}
	}
}

// The title and subtitle are the chart's own names, apart from the
// translations; null restores the stored TJA's.
func TestMetadataNames(t *testing.T) {
	stored := func() (tja.Metadata, error) { return tja.Metadata{Title: "Stored", Subtitle: "--Stored"}, nil }
	title, subtitle := "Current", "Sub"
	if ok, err := (metadataPatch{Title: json.RawMessage(`" Edited "`), Subtitle: json.RawMessage(`""`)}).names(&title, &subtitle, stored); !ok || err != nil || title != "Edited" || subtitle != "" {
		t.Fatalf("edit: %v %v %q %q", ok, err, title, subtitle)
	}
	if ok, _ := (metadataPatch{Title: json.RawMessage(`null`), Subtitle: json.RawMessage(`null`)}).names(&title, &subtitle, stored); !ok || title != "Stored" || subtitle != "--Stored" {
		t.Fatalf("restore: %q %q", title, subtitle)
	}
	for _, p := range []metadataPatch{
		{Title: json.RawMessage(`" "`)}, {Title: json.RawMessage(`12`)}, {Subtitle: json.RawMessage(`false`)},
		{Title: json.RawMessage(`"a\u0000b"`)}, {Title: json.RawMessage(`"` + strings.Repeat("x", 501) + `"`)},
	} {
		if ok, _ := p.names(&title, &subtitle, stored); ok {
			t.Fatalf("accepted %s %s", p.Title, p.Subtitle)
		}
	}
}
