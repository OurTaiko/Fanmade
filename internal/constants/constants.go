// Package constants computes the raw values behind OurTaiko's difficulty constants (定数) for one
// route of a chart block: stamina, handspeed, burst, complex and rhythm, the two ratios the final
// conversion reads, and the note count.
//
// It is a port of the constants repository (github.com/OurTaiko/constants: src/tja_analysis.py
// and src/algorithms/), which took its note gaps from the TJAAnalyzer worker. Here the gaps come
// from the notes TJAParser plays (`tjaparser inspect`, per route), measured as the worker did:
// milliseconds between consecutive don/ka notes, drumrolls and balloons skipped, rounded to
// thousandths. The arithmetic follows the Python statement by statement, in the same order, with
// each product converted to float64 before it is added so the compiler cannot fuse the two, and
// sum() reproduced with CPython's compensated summation (3.12+). On the same gaps the results
// agree with Python to about 1e-14 relative; what remains is libm rounding (Python's x**2 and
// x**0.5 go through pow, its sin and cos through the platform's libm; Go multiplies, takes
// square roots and has its own sin and cos).
//
// The notes are the game's, so a gap spanning a #BPMCHANGE inside a measure, or a branch whose
// routes differ in length, is measured as played, where the worker measured it with one BPM or
// on the route's own clock (OurTaikoLogs/Fanmade/docs/2026-10-25-difficulty-constants.md).
// The calibration and the final constants (rating.py) stay in the constants repository.
package constants

import (
	"errors"
	"math"
	"sort"
)

// Version is the algorithm's version, stored with the values (chart_difficulties.constants_version):
// raise it when a change here or in what TJAParser reports would change them, and the startup
// backfill recomputes every block.
const Version = 1

// Notes is one route's don and ka notes in play order, as `tjaparser inspect` reports them: each
// note's time in milliseconds from #START (TJAParser's unrounded RawMs) and its kind, 1–4 (don,
// ka, big don, big ka).
type Notes struct {
	Ms    []float64 `json:"ms"`
	Kinds []int     `json:"kinds"`
}

// OfBlock computes the values stored for a block from its routes ("unbranched", or "normal",
// "expert" and "master"): the master route of a branching block, as the constants repository
// publishes (extract_song_constants.py), else its one route. ok is false when there is neither.
func OfBlock(routes map[string]Notes) (raw Raw, ok bool) {
	notes, ok := routes["master"]
	if !ok {
		notes, ok = routes["unbranched"]
	}
	if !ok {
		return Raw{}, false
	}
	return FromNotes(notes.Ms, notes.Kinds), true
}

// Raw is one route's raw values. A dimension the original code could not compute (it raised and
// the caller kept the default) is zero, as it was there.
type Raw struct {
	Stamina      float64 `json:"stamina"`
	Handspeed    float64 `json:"handspeed"` // speed in the constants repository
	Burst        float64 `json:"burst"`
	Complex      float64 `json:"complex"`
	ComplexRatio float64 `json:"complexRatio"`
	Rhythm       float64 `json:"rhythm"`
	RhythmRatio  float64 `json:"rhythmRatio"`
	NoteCount    int     `json:"noteCount"` // totalNotes: the route's don and ka notes
}

// FromNotes computes a route's raw values from its notes (see Notes).
func FromNotes(ms []float64, kinds []int) Raw {
	types := make([]int, len(kinds))
	for i, k := range kinds {
		types[i] = 1 // don, big don
		if k == 2 || k == 4 {
			types[i] = 2 // ka, big ka
		}
	}
	intervals := make([]float64, 0, len(ms))
	for i := 1; i < len(ms); i++ {
		// The worker rounds each gap with Math.round(gap * 1000) / 1000; gaps are positive, where
		// math.Round agrees with it. A gap that rounds to zero (two notes at once) is dropped.
		if gap := math.Round((ms[i]-ms[i-1])*1000) / 1000; gap > 0 {
			intervals = append(intervals, gap)
		}
	}
	return fromIntervals(intervals, types, len(kinds))
}

// fromIntervals is TJAChartAnalyzer.calculate_raw_ratings: each dimension on its own, a failure
// leaving it zero.
func fromIntervals(intervals []float64, types []int, noteCount int) Raw {
	raw := Raw{NoteCount: noteCount}
	if len(intervals) == 0 {
		return raw
	}
	if v, err := stamina(intervals); err == nil {
		raw.Stamina = v
	}
	if v, ratio, err := complexDifficulty(intervals, types); err == nil {
		raw.Complex, raw.ComplexRatio = v, ratio
	}
	raw.Rhythm, raw.RhythmRatio = rhythm(intervals)
	if v, err := handspeed(intervals); err == nil {
		raw.Handspeed = v
	}
	if v, err := burst(intervals); err == nil {
		raw.Burst = v
	}
	return raw
}

var errTooShort = errors.New("too few notes")

// pi is math.Pi as a float64 value: 20*pi*p must round 20*π first, as Python's 20 * math.pi
// does, not fold it exactly as a Go constant.
var pi = math.Pi

// div keeps a quotient a float64 value, so that thresholds such as 30/130*1000*1.5 are rounded
// at each step as Python evaluates them rather than folded exactly as Go constants.
func div(a, b float64) float64 { return a / b }

// sum is Python's built-in sum() over floats, which since 3.12 compensates for rounding
// (Neumaier's improvement of Kahan summation, CPython's builtin_sum_impl). The original's
// sum(...) calls go through it; its `+=` loops are plain additions and stay so here.
func sum(values []float64) float64 {
	total, compensation := 0.0, 0.0
	for _, x := range values {
		t := total + x
		if math.Abs(total) >= math.Abs(x) {
			compensation += (total - t) + x
		} else {
			compensation += (x - t) + total
		}
		total = t
	}
	if compensation != 0 && !math.IsInf(compensation, 0) && !math.IsNaN(compensation) {
		total += compensation
	}
	return total
}

// rank is each value's 1-based place in ascending order, ties in index order (Python's stable
// sorted(range(len(c)), key=lambda i: c[i])).
func rank(c []float64) []int {
	order := make([]int, len(c))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return c[order[a]] < c[order[b]] })
	ranks := make([]int, len(c))
	for place, i := range order {
		ranks[i] = place + 1
	}
	return ranks
}

func weightedAverage(w, c []float64) float64 {
	products := make([]float64, len(w))
	for i := range w {
		products[i] = w[i] * c[i]
	}
	numerator, denominator := sum(products), sum(w)
	if math.Abs(denominator) < 1e-12 {
		return 0
	}
	return numerator / denominator
}

// stamina is 体力.calculate_result: the note density of the two disjoint 20-second stretches
// holding the most notes, against the rest.
func stamina(arr []float64) (float64, error) {
	total := sum(arr)
	n := len(arr)
	if total < 40000 {
		a := 0.0
		if total > 0 {
			a = float64(n) / total * 1000
		}
		return math.Sqrt(float64(0.9*float64(a*a)) + float64(0.1*0)), nil
	}
	type segment struct {
		start, end int
		sum        float64
	}
	var segments []segment
	for i := 0; i < n; i++ {
		current := 0.0
		for j := i; j < n; j++ {
			current += arr[j]
			if current >= 20000 {
				if current-arr[j] < 20000 {
					segments = append(segments, segment{i, j, current})
				}
				break
			}
		}
	}
	if len(segments) < 2 {
		return 0, errTooShort
	}
	best, found, maxLength := [2]segment{}, false, 0
	for i := range segments {
		s1 := segments[i]
		for j := i + 1; j < len(segments); j++ {
			s2 := segments[j]
			if s1.end < s2.start || s2.end < s1.start {
				if length := (s1.end - s1.start + 1) + (s2.end - s2.start + 1); length > maxLength {
					maxLength, best, found = length, [2]segment{s1, s2}, true
				}
			}
		}
	}
	if !found {
		return 0, errTooShort
	}
	s1, s2 := best[0], best[1]
	elements := (s1.end - s1.start + 1) + (s2.end - s2.start + 1)
	segmentSum := s1.sum + s2.sum
	a := 0.0
	if segmentSum > 0 {
		a = float64(elements) / segmentSum * 1000
	}
	var rest []float64
	for i, v := range arr {
		if !(s1.start <= i && i <= s1.end || s2.start <= i && i <= s2.end) {
			rest = append(rest, v)
		}
	}
	b := 0.0
	if len(rest) > 0 {
		b = float64(len(rest)) / sum(rest) * 1000
	}
	return math.Sqrt(float64(0.9*float64(a*a)) + float64(0.1*float64(b*b))), nil
}

// handspeed is 手速.compute_weighted_average: the top quarter of local note rates over two and
// four notes, weighted towards the fastest.
func handspeed(a []float64) (float64, error) {
	n := len(a) - 1
	if n <= 2 {
		return 0, errTooShort
	}
	c := make([]float64, 0, n-2)
	for i := 0; i < n-2; i++ {
		x := a[i] + a[i+1]
		y := (a[i] + a[i+1] + a[i+2] + a[i+3]) / 2
		b := (1.0 + 1.0) / (1.0/x + 1.0/y)
		c = append(c, 1000.0/b)
	}
	ranks := rank(c)
	w := make([]float64, len(c))
	for i, r := range ranks {
		p := float64(r) / float64(len(c))
		switch {
		case p < 0.75:
			w[i] = 0
		case p > 0.95:
			w[i] = 0.5 - float64(0.5*math.Cos(20*pi*p))
		default:
			w[i] = float64(0.5*math.Sin(float64(5*pi*p)-float64(div(17, 4)*pi))) + 0.5
		}
	}
	return weightedAverage(w, c), nil
}

// burst is 爆发.compute_weighted_average: the top 5% of single-gap note rates.
func burst(a []float64) (float64, error) {
	n := len(a) - 1
	if n <= 0 {
		return 0, errTooShort
	}
	c := make([]float64, n)
	for i := 0; i < n; i++ {
		x := 2 * a[i]
		y := a[i] + a[i+1]
		b := (1.0 + 1.0) / (1.0/x + 1.0/y)
		c[i] = 1000.0 / b
	}
	ranks := rank(c)
	w := make([]float64, n)
	for i, r := range ranks {
		if p := float64(r) / float64(n); p >= 0.95 {
			w[i] = 0.5 - float64(0.5*math.Cos(40*pi*p))
		}
	}
	return weightedAverage(w, c), nil
}

// largeInterval is the large-gap correction both complex and rhythm apply: full below
// 30/130 s × 1.5, none above 30/90 s × 1.5, linear between.
var largeLow, largeHigh = div(30, 130) * 1000 * 1.5, div(30, 90) * 1000 * 1.5

func largeInterval(x float64) float64 {
	switch {
	case x <= largeLow:
		return 1
	case x >= largeHigh:
		return 0
	default:
		return 1 - (x-largeLow)/(largeHigh-largeLow)
	}
}

// Thresholds between alternating hands: gaps under T are played hand to hand. Complex and rhythm
// average over every T from 30/180 s down to 30/260 s that a gap of the chart falls on.
var thresholdHigh, thresholdLow = div(30, 180) * 1000, div(30, 260) * 1000

// candidates are the distinct gaps strictly between the two thresholds, largest first.
func candidates(arr []float64) []float64 {
	seen := map[float64]bool{}
	var values []float64
	for _, v := range arr {
		if thresholdLow < v && v < thresholdHigh && !seen[v] {
			seen[v] = true
			values = append(values, v)
		}
	}
	sort.Sort(sort.Reverse(sort.Float64Slice(values)))
	return values
}

// hands marks each slot of a (the gaps with a 0 appended) R or L (true is R): a slot is L when
// the one before it is R and its gap is under t.
func hands(a []float64, t float64) []bool {
	marks := make([]bool, len(a))
	marks[0] = true
	for i := 1; i < len(a); i++ {
		marks[i] = !(marks[i-1] && a[i-1] < t)
	}
	return marks
}

var syncLow, syncHigh = 1 / (div(30, 180) * 1000), 1 / (div(30, 300) * 1000)

// compound is 复合.calculate_compound_difficulty for one threshold: in each RLRL run of at least
// six notes, how often the hand-over pattern between don and ka changes.
func compound(an []float64, bn []int, t float64) float64 {
	a := append(append(make([]float64, 0, len(an)+1), an...), 0)
	n := len(a)
	marks := hands(a, t)
	var difficulties []float64
	for current := 0; current < n; {
		if !marks[current] {
			current++
			continue
		}
		var indices []int
		expectR := true
		for i := current; i < n; i++ {
			if marks[i] != expectR {
				// Two R in a row end the run; the original appends the first R once more.
				if marks[i] && marks[i-1] {
					indices = append(indices, i-1)
				}
				break
			}
			indices = append(indices, i)
			expectR = !expectR
		}
		if len(indices) == 0 {
			current++
			continue
		}
		length := len(indices)
		if length < 6 {
			current = indices[length-1] + 1
			continue
		}
		handover := make([]int, length)
		for j := 2; j < length; j++ {
			if bn[indices[j]] != bn[indices[j-2]] {
				handover[j] = 1
			}
		}
		sync := make([]int, length)
		for j := 4; j < length; j++ {
			if handover[j] == handover[j-2] {
				sync[j] = 1
			}
		}
		difficulty := 0.0
		for j := 5; j < length; j++ {
			coefficientA := 0.0
			if sync[j] != sync[j-1] {
				coefficientA = 1
			}
			i := indices[j]
			correction1, correction2 := 0.0, 0.0
			if i-1 >= 0 && i-2 >= 0 {
				correction1 = largeInterval(a[i-1] + a[i-2])
			}
			if i-2 >= 0 && i-3 >= 0 {
				correction2 = largeInterval(a[i-2] + a[i-3])
			}
			coefficientB := correction1 * correction2
			coefficientC := 1.0
			switch v := 1 / a[i-1]; {
			case v > syncHigh:
				coefficientC = 1
			case v < syncLow:
				coefficientC = 0.5
			default:
				coefficientC = 0.5 + 0.5*(v-syncLow)/(syncHigh-syncLow)
			}
			difficulty += float64(float64(coefficientA*coefficientB) * coefficientC)
		}
		difficulties = append(difficulties, difficulty)
		current = indices[length-1] + 1
	}
	return sum(difficulties)
}

// complexDifficulty is 复合.calculate_complete_compound_difficulty: compound averaged over the
// thresholds the chart's gaps fall on, weighted by the span of 1/T each covers; and per gap.
func complexDifficulty(an []float64, bn []int) (float64, float64, error) {
	if len(bn) != len(an)+1 {
		return 0, 0, errors.New("note types do not match the gaps")
	}
	var difficulty float64
	values := candidates(an)
	if len(values) == 0 {
		difficulty = compound(an, bn, thresholdHigh)
	} else {
		thresholds := append([]float64{thresholdHigh}, values...)
		weighted, totalWeight := 0.0, 0.0
		for i, t := range thresholds {
			w := 1/thresholdLow - 1/thresholds[len(thresholds)-1]
			if i < len(thresholds)-1 {
				w = 1/thresholds[i+1] - 1/t
			}
			weighted += float64(compound(an, bn, t) * w)
			totalWeight += w
		}
		if totalWeight > 0 {
			difficulty = weighted / totalWeight
		}
	}
	return difficulty, difficulty / float64(len(an)), nil
}

var fillLow, fillHigh = div(30, 375) * 1000, div(30, 225) * 1000

// rhythmOf is 节奏.calculate_array_difficulty: how far each pair of neighbouring gaps one hand
// plays is from a simple ratio, with the large-gap and filling corrections.
func rhythmOf(array []float64) float64 {
	if len(array) < 2 {
		return 0
	}
	total := 0.0
	for i := 1; i < len(array); i++ {
		ai, previous := array[i], array[i-1]
		n := 0.0
		if ai != 0 && previous != 0 {
			ratio := math.Max(ai, previous) / math.Min(ai, previous)
			n = ratio - math.Trunc(ratio)
		}
		n = math.Min(n, 1-n)
		var coefficientA float64
		if third := float64(1 - float64(3*n)); n < div(1, 3) {
			half := float64(0.5 * third)
			coefficientA = 2 * math.Sqrt(0.25-float64(half*half))
		} else {
			wide := float64(0.94 * third)
			coefficientA = 2 * math.Sqrt(0.25-float64(wide*wide))
		}
		coefficientB := largeInterval(previous) * largeInterval(ai)
		coefficientC := 1.0
		switch {
		case ai >= fillHigh:
			coefficientC = 1
		case ai <= fillLow:
			coefficientC = 0
		default:
			coefficientC = (ai - fillLow) / (fillHigh - fillLow)
		}
		total += float64(float64(coefficientA*coefficientB) * coefficientC)
	}
	return total
}

// rhythmAt is 节奏.calculate_rhythm_difficulty's sum for one threshold: the gaps merged into
// what the right hand plays and what the left hand plays.
func rhythmAt(arr []float64, t float64) float64 {
	a := append(append(make([]float64, 0, len(arr)+1), arr...), 0)
	marks := hands(a, t)
	var right, left []float64
	for i, v := range a {
		if !marks[i] && len(right) > 0 {
			right[len(right)-1] += v
		} else {
			right = append(right, v)
		}
		if marks[i] {
			if len(left) > 0 {
				left[len(left)-1] += v
			}
		} else {
			left = append(left, v)
		}
	}
	return rhythmOf(left) + rhythmOf(right)
}

// rhythm is 节奏.compute_final_rhythm_difficulty: rhythmAt averaged over the thresholds as
// complex is; and per gap.
func rhythm(arr []float64) (float64, float64) {
	values := candidates(arr)
	if len(values) == 0 {
		difficulty := rhythmAt(arr, thresholdHigh)
		return difficulty, difficulty / float64(len(arr))
	}
	thresholds := append([]float64{thresholdHigh}, values...)
	weights := make([]float64, len(thresholds))
	for i := 0; i < len(thresholds)-1; i++ {
		weights[i] = 1/thresholds[i+1] - 1/thresholds[i]
	}
	weights[len(weights)-1] = 1/thresholdLow - 1/thresholds[len(thresholds)-1]
	totalWeight := sum(weights)
	var average float64
	if totalWeight <= 0 {
		average = rhythmAt(arr, thresholds[0])
	} else {
		weighted := 0.0
		for i, t := range thresholds {
			weighted += float64(rhythmAt(arr, t) * weights[i])
		}
		average = weighted / totalWeight
	}
	return average, average / float64(len(arr))
}
