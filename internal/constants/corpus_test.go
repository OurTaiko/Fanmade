package constants

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
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

// TestRatingCorpus checks the second stage against rating.py, skipped unless pointed at the
// expectations constants-regression/stage2.py writes (CONSTANTS_STAGE2=<file>): every route's
// eight values under the published calibration, and Calibrate over the whole set and subsets.
func TestRatingCorpus(t *testing.T) {
	path := os.Getenv("CONSTANTS_STAGE2")
	if path == "" {
		t.Skip("set CONSTANTS_STAGE2")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var expected struct {
		Params json.RawMessage `json:"params"`
		Routes []struct {
			Label  string `json:"label"`
			Raw    Raw    `json:"raw"`
			Rating Rating `json:"rating"`
		} `json:"routes"`
		Calibrations []struct {
			Routes []int  `json:"routes"`
			Params Params `json:"params"`
		} `json:"calibrations"`
	}
	if err = json.Unmarshal(data, &expected); err != nil {
		t.Fatal(err)
	}
	params, err := ParseParams(expected.Params)
	if err != nil {
		t.Fatal(err)
	}
	// 复合占比换算 is 18200.736 × tanh(…) − 18184.558: an ulp of tanh (Go's against libm's)
	// becomes about 2e-12 in it, and in complex and the 75 constant after it. The values are on
	// 0–15.5, so 1e-10 absolute is far below anything shown.
	close := func(a, b float64) bool { return math.Abs(a-b) <= math.Max(1e-12*math.Abs(b), 1e-10) }
	identical, worst := 0, 0.0
	for _, route := range expected.Routes {
		got, want := Rate(route.Raw, params), route.Rating
		g := []float64{got.SubConstant1, got.MainConstant, got.SubConstant2, got.Stamina, got.Handspeed, got.Burst, got.Complex, got.Rhythm}
		w := []float64{want.SubConstant1, want.MainConstant, want.SubConstant2, want.Stamina, want.Handspeed, want.Burst, want.Complex, want.Rhythm}
		if got == want {
			identical++
		}
		for i := range g {
			worst = math.Max(worst, math.Abs(g[i]-w[i]))
			if !close(g[i], w[i]) {
				t.Errorf("%s: field %d %v, want %v", route.Label, i, g[i], w[i])
			}
		}
	}
	t.Logf("ratings: %d routes, %d identical, largest difference %.3g", len(expected.Routes), identical, worst)
	same := 0
	for _, c := range expected.Calibrations {
		routes := make([]Raw, len(c.Routes))
		for i, index := range c.Routes {
			routes[i] = expected.Routes[index].Raw
		}
		got, err := Calibrate(routes)
		if err != nil {
			t.Fatal(err)
		}
		if got == c.Params {
			same++
			continue
		}
		g, _ := json.Marshal(got)
		w, _ := json.Marshal(c.Params)
		var gm, wm map[string]float64
		json.Unmarshal(g, &gm)
		json.Unmarshal(w, &wm)
		for key := range wm {
			if !close(gm[key], wm[key]) {
				t.Errorf("calibration of %d routes: %s %v, want %v", len(routes), key, gm[key], wm[key])
			}
		}
	}
	t.Logf("calibrations: %d, %d identical", len(expected.Calibrations), same)
}

// TestServerCorpus runs the servers' path over `tjaparser inspect` output, skipped unless
// pointed at it (CONSTANTS_INSPECT=<dir>, CONSTANTS_RATED=<file>): every route's raw values,
// one calibration over the distinct (content hash, route) rows as Recalibrate takes them, and
// every route rated by it. Writes {"params", "charts": {name: {"<Name>/<side>": {route:
// {"raw", "rating"}}}}} for the comparison with the published constants.
func TestServerCorpus(t *testing.T) {
	dir, out := os.Getenv("CONSTANTS_INSPECT"), os.Getenv("CONSTANTS_RATED")
	if dir == "" || out == "" {
		t.Skip("set CONSTANTS_INSPECT and CONSTANTS_RATED")
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	type entry struct {
		Raw    Raw    `json:"raw"`
		Rating Rating `json:"rating"`
	}
	charts := map[string]map[string]map[string]*entry{}
	distinct := map[[2]string]Raw{}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var inspection struct {
			Blocks []struct {
				Name  string           `json:"name"`
				Side  string           `json:"side"`
				Hash  string           `json:"hash"`
				Notes map[string]Notes `json:"notes"`
			} `json:"blocks"`
		}
		if err = json.Unmarshal(data, &inspection); err != nil {
			t.Fatal(err)
		}
		name := strings.TrimSuffix(filepath.Base(file), ".json")
		charts[name] = map[string]map[string]*entry{}
		for _, b := range inspection.Blocks {
			routes := map[string]*entry{}
			for route, raw := range OfRoutes(b.Notes) {
				routes[route] = &entry{Raw: raw}
				distinct[[2]string{b.Hash, route}] = raw
			}
			charts[name][b.Name+"/"+b.Side] = routes
		}
	}
	keys := make([][2]string, 0, len(distinct))
	for k := range distinct {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool {
		return keys[i][0] < keys[j][0] || keys[i][0] == keys[j][0] && keys[i][1] < keys[j][1]
	})
	raws := make([]Raw, len(keys))
	for i, k := range keys {
		raws[i] = distinct[k]
	}
	params, err := Calibrate(raws)
	if err != nil {
		t.Fatal(err)
	}
	for _, blocks := range charts {
		for _, routes := range blocks {
			for _, e := range routes {
				e.Rating = Rate(e.Raw, params)
			}
		}
	}
	data, err := json.Marshal(map[string]any{"params": params, "routes": len(raws), "charts": charts})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(out, data, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("%d charts, %d distinct routes calibrated: %+v", len(charts), len(raws), params)
}
