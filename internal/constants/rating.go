package constants

import (
	"encoding/json"
	"fmt"
	"math"
)

// The second stage: the constants repository's rating.py, statement by statement. Calibrate is
// RatingPipeline.calibrate (the 13 global minima and maxima over every route of a data set) and
// Rate is RatingPipeline.compute (a route's eight published values under a calibration). The
// same care as in the first stage keeps the arithmetic Python's (stepwise constants, unfused
// products, compensated sum()); exp, tanh and pow are libm's in Python and Go's here.

// RatingVersion is the version of the formulas below (rating.py): raise it with a change to
// them, and the next calibration recomputes every rating.
const RatingVersion = 1

// The caps rating.py puts on the rough 75, main and 99 constants (Lightning Beams and the like).
const (
	raw75Cap   = 15.4
	rawMainCap = 15.15
	raw99Cap   = 15.0
)

// Params are a calibration's 13 global values, keyed as cached_computing_parameters.json is.
type Params struct {
	MinStamina      float64 `json:"min_体力换算"`
	MaxStamina      float64 `json:"max_体力换算"`
	MaxHandspeed    float64 `json:"max_手速换算"`
	MaxBurst        float64 `json:"max_爆发换算"`
	MinComplexRatio float64 `json:"min_复合占比换算"`
	MaxComplexRatio float64 `json:"max_复合占比换算"`
	MinComplex      float64 `json:"min_复合换算"`
	MaxComplex      float64 `json:"max_复合换算"`
	MinRhythm       float64 `json:"min_节奏换算"`
	MaxRhythm       float64 `json:"max_节奏换算"`
	MaxRough75      float64 `json:"max_粗糙75定数"`
	MaxRoughMain    float64 `json:"max_粗糙主定数"`
	MaxRough99      float64 `json:"max_粗糙99定数"`
}

// ParseParams reads a calibration as computing_parameters.py does: all 13 values present and
// finite, no minimum above its maximum.
func ParseParams(data []byte) (Params, error) {
	var values map[string]*float64
	if err := json.Unmarshal(data, &values); err != nil {
		return Params{}, err
	}
	var p Params
	if err := json.Unmarshal(data, &p); err != nil {
		return Params{}, err
	}
	for _, key := range []string{"min_体力换算", "max_体力换算", "max_手速换算", "max_爆发换算", "min_复合占比换算", "max_复合占比换算",
		"min_复合换算", "max_复合换算", "min_节奏换算", "max_节奏换算", "max_粗糙75定数", "max_粗糙主定数", "max_粗糙99定数"} {
		if v := values[key]; v == nil || math.IsNaN(*v) || math.IsInf(*v, 0) {
			return Params{}, fmt.Errorf("calibration lacks %s", key)
		}
	}
	if p.MinStamina > p.MaxStamina || p.MinComplexRatio > p.MaxComplexRatio || p.MinComplex > p.MaxComplex || p.MinRhythm > p.MaxRhythm {
		return Params{}, fmt.Errorf("calibration has a minimum above its maximum")
	}
	return p, nil
}

// Rating is a route's eight published values (constants.json): the 75, main and 99 constants
// and the five dimensions, each on 0–15.5.
type Rating struct {
	SubConstant1 float64 `json:"sub_constant_1"` // 归一75定数
	MainConstant float64 `json:"main_constant"`  // 归一主定数
	SubConstant2 float64 `json:"sub_constant_2"` // 最终99定数
	Stamina      float64 `json:"stamina"`
	Handspeed    float64 `json:"handspeed"`
	Burst        float64 `json:"burst"`
	Complex      float64 `json:"complex"`
	Rhythm       float64 `json:"rhythm"`
}

func sub(a, b float64) float64 { return a - b }

// halfTanh is rating.py's comparison 0.5 × tanh(x) + 0.5.
func halfTanh(x float64) float64 { return float64(0.5*math.Tanh(x)) + 0.5 }

func clamp(v, low, high float64) float64 { return math.Max(math.Min(v, high), low) }

// pyMin is Python's min(): the first of equal values, as math.Min would only differ on -0/NaN.
func pyMin(values ...float64) float64 {
	m := values[0]
	for _, v := range values[1:] {
		if v < m {
			m = v
		}
	}
	return m
}

func pyMax(values ...float64) float64 {
	m := values[0]
	for _, v := range values[1:] {
		if v > m {
			m = v
		}
	}
	return m
}

// 体力换算: a sigmoid onto [0, 15.5].
func convertStamina(raw float64) float64 {
	v := 16.3783/(1.0+math.Exp(-0.6764*(raw-7.2836))) - 0.6012
	return clamp(v, 0, 15.5)
}

// 手速换算.
func convertSpeed(raw float64) float64 {
	switch {
	case raw < 5.0:
		return 3.0 * math.Pow(raw/5.0, 35.0/3.0)
	case raw < 6.0:
		return float64(7.0*raw) - 32.0
	case raw < 10.0:
		return float64(div(11, 8)*raw) + 1.75
	}
	return 15.5
}

// 爆发换算.
func convertBurst(raw float64) float64 {
	switch {
	case raw < 6.0:
		return 4 * math.Pow(6, -63.0/8) * math.Pow(raw, 63.0/8)
	case raw < 7.0:
		return float64(5.25*raw) - 27.5
	case raw < 10.0:
		return float64(div(7, 4)*raw) - 3.0
	case raw < 12.75:
		return (float64(8.0*raw) + 239.0) / 22.0
	}
	return 15.5
}

// 复合占比换算: tanh onto [0, 15.6].
func convertComplexRatio(ratio float64) float64 {
	v := float64(18200.736*math.Tanh(float64(4.491*ratio)+3.86)) - 18184.558
	return clamp(v, 0, 15.6)
}

// 复合上限, by note count.
func complexUpper(notes int) float64 {
	return 17.7743/(1.0+math.Exp(float64(-0.0083*float64(notes))+2.8484)) - 0.9613
}

// 节奏占比换算.
func convertRhythmRatio(ratio float64) float64 {
	return 20.1353/(1.0+math.Exp(-18.0625*(ratio-0.0692))) - 4.4496
}

// 节奏上限, by note count.
func rhythmUpper(notes int) float64 {
	return 17.4097/(1.0+math.Exp(float64(-0.007*float64(notes))+2.7059)) - 1.0787
}

func normalize(v, low, high float64) float64 {
	if high == low {
		return 0
	}
	return (v - low) / (high - low) * 15.5
}

func squares(values ...float64) float64 {
	total := 0.0
	for _, v := range values {
		total += float64(v * v)
	}
	return total
}

// weights are the main constant's weights (主定数权重) with the rough average they depend on.
func weights(stamina, speed, burst, complex, rhythm float64) (w [5]float64, rough float64) {
	least := pyMin(stamina, speed, burst, complex, rhythm)
	rough = math.Sqrt((squares(stamina, speed, burst, complex, rhythm) - float64(float64(0.9*least)*least)) / 4.1)
	average10 := halfTanh(1.0 * (rough - 10.0))
	staminaAverage := halfTanh(3.0 * (stamina - rough + 0.5))
	stamina145 := halfTanh(3.0 * (stamina - 14.5))
	burstAverage := halfTanh(3.0 * (burst - rough + 0.5))
	complexAverage := halfTanh(3.0 * (complex - rough + 0.5))
	rhythmAverage := halfTanh(3.0 * (rhythm - rough + 0.5))

	staminaCondition := average10 * staminaAverage * (1.0 - stamina145)
	speedCondition := average10
	burstCondition := 1.0 - burstAverage
	complexCondition := average10 * complexAverage
	rhythmCondition := average10 * rhythmAverage

	w = [5]float64{float64(0.7*(1.0-staminaCondition)) + 0.3, 1.0, float64(0.9*burstCondition) + 0.1,
		float64(0.9*(1.0-complexCondition)) + 0.1, float64(0.9*(1.0-rhythmCondition)) + 0.1}
	if least == stamina {
		w[0] = 0.1
	}
	if least == speed {
		w[1] = float64(0.9*speedCondition) + 0.1
	}
	if least == burst {
		w[2] = 0.1
	}
	if least == complex {
		w[3] = 0.1
	}
	if least == rhythm {
		w[4] = 0.1
	}
	return w, rough
}

// weightedRMS is the 加权 RMS both rough constants take, sums as Python's sum().
func weightedRMS(values, w [5]float64) float64 {
	var products [5]float64
	for i := range values {
		products[i] = float64(values[i]*values[i]) * w[i]
	}
	total, weight := sum(products[:]), sum(w[:])
	if weight > 0 {
		return math.Sqrt(total / weight)
	}
	return 0
}

// roughMain is _calc_raw_main_constant: before its cap and the 13.3 soft limit.
func roughMain(stamina, speed, burst, complex, rhythm float64) float64 {
	w, _ := weights(stamina, speed, burst, complex, rhythm)
	return weightedRMS([5]float64{stamina, speed, burst, complex, rhythm}, w)
}

// rough99 is _calc_raw_99_constant, weighted by where the main constant falls.
func rough99(stamina, speed, burst, complex, rhythm, main float64) float64 {
	band := 6
	switch {
	case main > 14.5:
		band = 1
	case main > 13.5:
		band = 2
	case main > 12.5:
		band = 3
	case main > 11.5:
		band = 4
	case main > 9.5:
		band = 5
	}
	w, _ := weights(stamina, speed, burst, complex, rhythm)
	stamina14 := halfTanh(3.0 * (stamina - 14.0))
	stamina135 := halfTanh(3.0 * (stamina - 13.5))
	speed11 := halfTanh(3.0 * (speed - 11.0))
	burst15 := halfTanh(3.0 * (burst - 15.0))
	burst85 := halfTanh(3.0 * (burst - 8.5))
	rhythmMain := halfTanh(3.0 * (rhythm - main))

	w99 := w
	switch band {
	case 3:
		w99[0] = float64(1.0*stamina14) + float64(w[0]*(1.0-stamina14))
	case 4:
		w99[0] = float64(1.0*stamina135) + float64(w[0]*(1.0-stamina135))
	case 5, 6:
		w99[0] = 0.1
	}
	switch band {
	case 5:
		w99[1] = float64(0.5*speed11) + 0.5
	case 6:
		w99[1] = float64(0.9*speed11) + 0.1
	}
	switch band {
	case 1:
		w99[2] = 1.0
	case 2, 4:
		w99[2] = 0.5
	case 3:
		w99[2] = float64(0.5*burst15) + float64(w[2]*(1.0-burst15))
	case 5:
		w99[2] = float64(0.3*burst85) + 0.5
	case 6:
		w99[2] = float64(0.9*burst85) + 0.1
	}
	if band != 1 && band != 2 {
		w99[3] = 0.1
	}
	switch band {
	case 1:
		w99[4] = 0.3
	case 2, 3:
		w99[4] = 0.5
	case 4:
		w99[4] = 0.8
	case 5:
		w99[4] = float64(0.5*rhythmMain) + 0.3
	case 6:
		w99[4] = 1.0
	}
	return weightedRMS([5]float64{stamina, speed, burst, complex, rhythm}, w99)
}

func rough75(stamina, speed, complex float64) float64 {
	return math.Min(math.Sqrt(squares(stamina, speed, complex)/3.0), raw75Cap)
}

// softLimit is the 13.3 soft limit both normalized constants share, against the data set's
// largest rough value. Where that largest value is not above 13.3 (a small data set, rated
// against a calibration that saw no harder route) rating.py divides by zero or a negative
// number; the value is then left as it is, as calibrate does.
func softLimit(rough, max float64) float64 {
	if rough > 13.3 && max > 13.3 {
		return 13.3 + sub(15.5, 13.3)*(rough-13.3)/(max-13.3)
	}
	return rough
}

// converted is a route's 换算 values: rating.py's first step, before normalization.
type converted struct {
	stamina, speed, burst, complexRatio, complexUpper, rhythm float64
}

func convert(raw Raw) converted {
	return converted{
		stamina:      convertStamina(raw.Stamina),
		speed:        convertSpeed(raw.Handspeed),
		burst:        convertBurst(raw.Burst),
		complexRatio: convertComplexRatio(raw.ComplexRatio),
		complexUpper: complexUpper(raw.NoteCount),
		rhythm:       math.Min(convertRhythmRatio(raw.RhythmRatio), rhythmUpper(raw.NoteCount)),
	}
}

// Rate is RatingPipeline.compute: a route's published values under a calibration.
func Rate(raw Raw, p Params) Rating {
	c := convert(raw)
	complexValue := math.Min(normalize(c.complexRatio, p.MinComplexRatio, p.MaxComplexRatio), c.complexUpper)
	stamina := normalize(c.stamina, p.MinStamina, p.MaxStamina)
	speed := normalize(c.speed, 0, p.MaxHandspeed)
	burst := normalize(c.burst, 0, p.MaxBurst)
	complex := normalize(complexValue, p.MinComplex, p.MaxComplex)
	rhythm := normalize(c.rhythm, p.MinRhythm, p.MaxRhythm)

	// rating.py divides by zero for a calibration whose every rough 75 constant is 0; 0 here.
	sub1 := 0.0
	if p.MaxRough75 != 0 {
		sub1 = 15.5 * rough75(stamina, speed, complex) / p.MaxRough75
	}
	main := softLimit(math.Min(roughMain(stamina, speed, burst, complex, rhythm), rawMainCap), p.MaxRoughMain)
	r99 := math.Min(rough99(stamina, speed, burst, complex, rhythm, main), raw99Cap)
	speedLimit := float64(float64(div(1, 8)*speed)*speed) + 10.0
	return Rating{
		SubConstant1: sub1, MainConstant: main, SubConstant2: math.Min(softLimit(r99, p.MaxRough99), speedLimit),
		Stamina: stamina, Handspeed: speed, Burst: burst, Complex: complex, Rhythm: rhythm,
	}
}

// Calibrate is RatingPipeline.calibrate: the global values from a data set of routes, in its
// stages (each maximum of a rough constant taken after that constant's cap). It needs at least
// one route.
func Calibrate(routes []Raw) (Params, error) {
	n := len(routes)
	if n == 0 {
		return Params{}, fmt.Errorf("calibration needs at least one route")
	}
	c := make([]converted, n)
	for i, raw := range routes {
		c[i] = convert(raw)
	}
	var p Params
	p.MinComplexRatio, p.MaxComplexRatio = c[0].complexRatio, c[0].complexRatio
	for _, v := range c {
		p.MinComplexRatio, p.MaxComplexRatio = pyMin(p.MinComplexRatio, v.complexRatio), pyMax(p.MaxComplexRatio, v.complexRatio)
	}
	span := p.MaxComplexRatio - p.MinComplexRatio
	complexValues := make([]float64, n)
	for i, v := range c {
		if span > 0 {
			complexValues[i] = math.Min((v.complexRatio-p.MinComplexRatio)/span*15.5, v.complexUpper)
		}
	}
	p.MinStamina, p.MaxStamina = c[0].stamina, c[0].stamina
	p.MaxHandspeed, p.MaxBurst = c[0].speed, c[0].burst
	p.MinComplex, p.MaxComplex = complexValues[0], complexValues[0]
	p.MinRhythm, p.MaxRhythm = c[0].rhythm, c[0].rhythm
	for i, v := range c {
		p.MinStamina, p.MaxStamina = pyMin(p.MinStamina, v.stamina), pyMax(p.MaxStamina, v.stamina)
		p.MaxHandspeed, p.MaxBurst = pyMax(p.MaxHandspeed, v.speed), pyMax(p.MaxBurst, v.burst)
		p.MinComplex, p.MaxComplex = pyMin(p.MinComplex, complexValues[i]), pyMax(p.MaxComplex, complexValues[i])
		p.MinRhythm, p.MaxRhythm = pyMin(p.MinRhythm, v.rhythm), pyMax(p.MaxRhythm, v.rhythm)
	}
	type dims struct{ stamina, speed, burst, complex, rhythm float64 }
	d := make([]dims, n)
	roughMains := make([]float64, n)
	for i, v := range c {
		d[i] = dims{normalize(v.stamina, p.MinStamina, p.MaxStamina), normalize(v.speed, 0, p.MaxHandspeed),
			normalize(v.burst, 0, p.MaxBurst), normalize(complexValues[i], p.MinComplex, p.MaxComplex),
			normalize(v.rhythm, p.MinRhythm, p.MaxRhythm)}
		r75 := rough75(d[i].stamina, d[i].speed, d[i].complex)
		roughMains[i] = math.Min(roughMain(d[i].stamina, d[i].speed, d[i].burst, d[i].complex, d[i].rhythm), rawMainCap)
		if i == 0 {
			p.MaxRough75, p.MaxRoughMain = r75, roughMains[i]
		}
		p.MaxRough75, p.MaxRoughMain = pyMax(p.MaxRough75, r75), pyMax(p.MaxRoughMain, roughMains[i])
	}
	mainSpan := p.MaxRoughMain - 13.3
	for i := range c {
		main := roughMains[i]
		if main > 13.3 && mainSpan > 0 {
			main = 13.3 + sub(15.5, 13.3)*(main-13.3)/mainSpan
		}
		r99 := math.Min(rough99(d[i].stamina, d[i].speed, d[i].burst, d[i].complex, d[i].rhythm, main), raw99Cap)
		if i == 0 {
			p.MaxRough99 = r99
		}
		p.MaxRough99 = pyMax(p.MaxRough99, r99)
	}
	return p, nil
}
