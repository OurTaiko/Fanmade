package httpapi

import "strings"

func normalizeCourse(raw string) (string, bool) {
	base, ok := map[string]string{"easy": "Easy", "normal": "Normal", "hard": "Hard", "oni": "Oni", "edit": "Edit", "ura": "Edit"}[strings.ToLower(strings.TrimSpace(raw))]
	return base, ok
}
