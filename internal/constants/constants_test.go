package constants

import (
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

// testdata/golden.json pins the constants repository's Python (tja_analysis.py with
// algorithms/, Python 3.14): five real routes, whose notes are `tjaparser inspect` output and
// whose expected values the Python computed from the TJAAnalyzer worker's gaps for the same
// chart (charts where the worker's gaps and the game's agree), and synthetic edge cases.
func TestGolden(t *testing.T) {
	data, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Chart string    `json:"chart"`
		Ms    []float64 `json:"ms"`
		Kinds []int     `json:"kinds"`
		Want  Raw       `json:"want"`
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		got := FromNotes(c.Ms, c.Kinds)
		if got.NoteCount != c.Want.NoteCount {
			t.Errorf("%s: note count %d, want %d", c.Chart, got.NoteCount, c.Want.NoteCount)
		}
		for _, f := range []struct {
			name      string
			got, want float64
		}{
			{"stamina", got.Stamina, c.Want.Stamina}, {"handspeed", got.Handspeed, c.Want.Handspeed},
			{"burst", got.Burst, c.Want.Burst}, {"complex", got.Complex, c.Want.Complex},
			{"complexRatio", got.ComplexRatio, c.Want.ComplexRatio}, {"rhythm", got.Rhythm, c.Want.Rhythm},
			{"rhythmRatio", got.RhythmRatio, c.Want.RhythmRatio},
		} {
			// libm rounding aside (see the package comment), the port is the same arithmetic.
			if math.Abs(f.got-f.want) > 1e-12*math.Max(math.Abs(f.want), 1) {
				t.Errorf("%s: %s %v, want %v", c.Chart, f.name, f.got, f.want)
			}
		}
	}
}

func TestOfRoutes(t *testing.T) {
	stream := Notes{Ms: []float64{0, 125, 250, 375, 500, 625}, Kinds: []int{1, 2, 1, 2, 1, 2}}
	slow := Notes{Ms: []float64{0, 500, 1000}, Kinds: []int{1, 1, 1}}
	routes := OfRoutes(map[string]Notes{"normal": slow, "expert": slow, "master": stream})
	if len(routes) != 3 || routes["master"] != FromNotes(stream.Ms, stream.Kinds) || routes["normal"].NoteCount != 3 {
		t.Errorf("routes %+v", routes)
	}
	if OfRoutes(nil) != nil {
		t.Error("no notes, no routes")
	}
}

// The original sums with Python's built-in sum(), compensated since 3.12.
func TestSumCompensates(t *testing.T) {
	if got := sum([]float64{1e16, 1, -1e16, 1}); got != 2 {
		t.Errorf("sum = %v, want 2 (plain addition gives 1)", got)
	}
}

// testdata/rating_golden.json pins rating.py: routes across every main-constant band and every
// piece of the speed and burst conversions, with their eight values under the published
// calibration, and calibrations of small subsets, where the data-dependent extremes move.
func TestRatingGolden(t *testing.T) {
	t.Setenv("CONSTANTS_STAGE2", "testdata/rating_golden.json")
	TestRatingCorpus(t)
}

func TestParseParams(t *testing.T) {
	published := `{"min_体力换算":0.0,"max_体力换算":15.5,"max_手速换算":15.5,"max_爆发换算":15.5,"min_复合占比换算":0.027989008758595446,
"max_复合占比换算":15.6,"min_复合换算":0.0,"max_复合换算":15.5,"min_节奏换算":0.01160173377865803,"max_节奏换算":15.54733200247501,
"max_粗糙75定数":15.4,"max_粗糙主定数":15.15,"max_粗糙99定数":15.0}`
	p, err := ParseParams([]byte(published))
	if err != nil || p.MaxRhythm != 15.54733200247501 || p.MaxRough99 != 15 {
		t.Fatalf("%+v %v", p, err)
	}
	if _, err = ParseParams([]byte(`{"min_体力换算":0}`)); err == nil {
		t.Error("an incomplete calibration was accepted")
	}
}

func TestNextCalibration(t *testing.T) {
	tokyo := time.FixedZone("JST", 9*60*60)
	for _, c := range []struct{ now, want string }{
		{"2026-10-25T05:00:00", "2026-10-25T05:30:00"}, // a Sunday, before the slot
		{"2026-10-25T05:30:00", "2026-11-01T05:30:00"}, // at it: the next week's
		{"2026-10-26T12:00:00", "2026-11-01T05:30:00"}, // a Monday
		{"2026-10-31T23:59:00", "2026-11-01T05:30:00"}, // a Saturday
	} {
		now, _ := time.ParseInLocation("2006-01-02T15:04:05", c.now, tokyo)
		if got := NextCalibration(now.UTC()).In(tokyo).Format("2006-01-02T15:04:05"); got != c.want {
			t.Errorf("after %s: %s, want %s", c.now, got, c.want)
		}
	}
	now := time.Now()
	fresh := Calibration{RatingVersion: RatingVersion, ConstantsVersion: Version, ComputedAt: now.Add(-time.Hour)}
	if Due(fresh, true, now) || !Due(fresh, false, now) {
		t.Error("a fresh calibration is not due; none is")
	}
	old, other := fresh, fresh
	old.ComputedAt = now.Add(-8 * 24 * time.Hour)
	other.RatingVersion = RatingVersion + 1
	if !Due(old, true, now) || !Due(other, true, now) {
		t.Error("a calibration over a week old, or from other formulas, is due")
	}
}
