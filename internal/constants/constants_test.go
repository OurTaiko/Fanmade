package constants

import (
	"encoding/json"
	"math"
	"os"
	"testing"
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

func TestOfBlock(t *testing.T) {
	stream := Notes{Ms: []float64{0, 125, 250, 375, 500, 625}, Kinds: []int{1, 2, 1, 2, 1, 2}}
	slow := Notes{Ms: []float64{0, 500, 1000}, Kinds: []int{1, 1, 1}}
	if raw, ok := OfBlock(map[string]Notes{"unbranched": stream}); !ok || raw != FromNotes(stream.Ms, stream.Kinds) {
		t.Errorf("unbranched: %+v %v", raw, ok)
	}
	branched := map[string]Notes{"normal": slow, "expert": slow, "master": stream}
	if raw, ok := OfBlock(branched); !ok || raw.NoteCount != 6 {
		t.Errorf("a branching block stores its master route: %+v %v", raw, ok)
	}
	if _, ok := OfBlock(nil); ok {
		t.Error("no routes, no constants")
	}
}

// The original sums with Python's built-in sum(), compensated since 3.12.
func TestSumCompensates(t *testing.T) {
	if got := sum([]float64{1e16, 1, -1e16, 1}); got != 2 {
		t.Errorf("sum = %v, want 2 (plain addition gives 1)", got)
	}
}
