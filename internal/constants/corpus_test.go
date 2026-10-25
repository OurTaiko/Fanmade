package constants

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestCorpus is the regression run against the original pipeline, skipped unless pointed at a
// corpus (OurTaikoLogs/Fanmade/docs/2026-10-25-difficulty-constants.md has the full procedure):
//
//	CONSTANTS_GAPS=<dir>    the TJAAnalyzer worker's output (unit=ms, longNoteHandling=skip), one
//	                        <name>.json per chart: the algorithms alone, on the gaps the Python saw
//	CONSTANTS_INSPECT=<dir> `tjaparser inspect` output, one <name>.json per chart: the server's
//	                        path, gaps from the notes TJAParser plays
//	CONSTANTS_OUT=<file>    where to write {name: {course: {route: Raw}}} for the comparison script
func TestCorpus(t *testing.T) {
	gaps, inspect, out := os.Getenv("CONSTANTS_GAPS"), os.Getenv("CONSTANTS_INSPECT"), os.Getenv("CONSTANTS_OUT")
	if out == "" || (gaps == "") == (inspect == "") {
		t.Skip("set CONSTANTS_OUT and one of CONSTANTS_GAPS, CONSTANTS_INSPECT")
	}
	dir := gaps + inspect
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	result := map[string]map[string]map[string]Raw{}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		name := strings.TrimSuffix(filepath.Base(file), ".json")
		if gaps != "" {
			result[name] = fromAnalyzer(t, data)
		} else {
			result[name] = fromInspection(t, data)
		}
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(out, data, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("%d charts", len(result))
}

// fromAnalyzer is TJAChartAnalyzer.process over the worker's JSON.
func fromAnalyzer(t *testing.T, data []byte) map[string]map[string]Raw {
	var analysis struct {
		Courses   map[string]map[string][][]*float64 `json:"courses"`
		NoteTypes map[string]map[string][]int        `json:"noteTypes"`
	}
	if err := json.Unmarshal(data, &analysis); err != nil {
		t.Fatal(err)
	}
	result := map[string]map[string]Raw{}
	for course, branches := range analysis.Courses {
		result[course] = map[string]Raw{}
		for branch, bars := range branches {
			var intervals []float64
			for _, bar := range bars {
				for _, gap := range bar {
					if gap != nil && *gap > 0 {
						intervals = append(intervals, *gap)
					}
				}
			}
			types := analysis.NoteTypes[course][branch]
			count := 0
			for _, v := range types {
				if v >= 1 && v <= 4 {
					count++
				}
			}
			result[course][branch] = fromIntervals(intervals, types, count)
		}
	}
	return result
}

// fromInspection keys each block "<name>/<side>", as the servers store it.
func fromInspection(t *testing.T, data []byte) map[string]map[string]Raw {
	var inspection struct {
		Blocks []struct {
			Name  string           `json:"name"`
			Side  string           `json:"side"`
			Notes map[string]Notes `json:"notes"`
		} `json:"blocks"`
	}
	if err := json.Unmarshal(data, &inspection); err != nil {
		t.Fatal(err)
	}
	result := map[string]map[string]Raw{}
	for _, block := range inspection.Blocks {
		routes := map[string]Raw{}
		for route, notes := range block.Notes {
			routes[route] = FromNotes(notes.Ms, notes.Kinds)
		}
		result[block.Name+"/"+block.Side] = routes
	}
	return result
}
