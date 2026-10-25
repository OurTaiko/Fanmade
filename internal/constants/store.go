package constants

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// How the two stages are kept (Fanmade 048, OurTaikoDatabase 012; this file is the same in
// both servers). difficulty_constants holds one row per content hash and route: a block's
// constants follow from what it plays, so blocks that play the same share a row, a replaced
// file whose block plays the same keeps it, and chart_difficulties itself is not touched. The
// raw values are written when a block is stored (Store) and by the startup backfill; the eight
// published values under the calibration in calibration_version. constants_calibrations keeps
// every calibration: Recalibrate computes one from every route of the live charts, records it
// only when it differs from the latest, and rates every row by the latest.

// DB is a pgx pool or transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Calibration is a row of constants_calibrations.
type Calibration struct {
	Version          int
	Params           Params
	RatingVersion    int
	ConstantsVersion int
	Routes           int
	ComputedAt       time.Time
}

// Current reports whether it was computed by this code's formulas from this code's raw values.
func (c Calibration) Current() bool {
	return c.RatingVersion == RatingVersion && c.ConstantsVersion == Version
}

// Latest is the newest calibration; ok is false before the first.
func Latest(ctx context.Context, db DB) (c Calibration, ok bool, err error) {
	var params []byte
	err = db.QueryRow(ctx, `SELECT version,params,rating_version,constants_version,route_count,computed_at FROM constants_calibrations ORDER BY version DESC LIMIT 1`).
		Scan(&c.Version, &params, &c.RatingVersion, &c.ConstantsVersion, &c.Routes, &c.ComputedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, false, nil
	}
	if err == nil {
		c.Params, err = ParseParams(params)
	}
	return c, err == nil, err
}

const ratingColumns = `sub_constant_1,main_constant,sub_constant_2,stamina,handspeed,burst,complex,rhythm`

func ratingValues(r Rating) []any {
	return []any{r.SubConstant1, r.MainConstant, r.SubConstant2, r.Stamina, r.Handspeed, r.Burst, r.Complex, r.Rhythm}
}

// Store writes a block's routes under its content hash. A row from an older constants Version
// is replaced; a current one is kept, since the same hash and version give the same values.
// New rows are rated by the latest calibration, when there is one.
func Store(ctx context.Context, db DB, hash string, routes Routes) error {
	if hash == "" || len(routes) == 0 {
		return nil
	}
	calibration, calibrated, err := Latest(ctx, db)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(routes))
	for route := range routes {
		names = append(names, route)
	}
	sort.Strings(names)
	for _, route := range names {
		raw := routes[route]
		args := []any{hash, route, Version, raw.NoteCount, raw.Stamina, raw.Handspeed, raw.Burst, raw.Complex, raw.ComplexRatio, raw.Rhythm, raw.RhythmRatio}
		if calibrated {
			args = append(append(args, calibration.Version), ratingValues(Rate(raw, calibration.Params))...)
		} else {
			args = append(args, make([]any, 9)...)
		}
		if _, err = db.Exec(ctx, `INSERT INTO difficulty_constants(content_hash,route,constants_version,note_count,raw_stamina,raw_handspeed,raw_burst,
 raw_complex,raw_complex_ratio,raw_rhythm,raw_rhythm_ratio,calibration_version,`+ratingColumns+`)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
 ON CONFLICT(content_hash,route) DO UPDATE SET constants_version=EXCLUDED.constants_version,note_count=EXCLUDED.note_count,
 raw_stamina=EXCLUDED.raw_stamina,raw_handspeed=EXCLUDED.raw_handspeed,raw_burst=EXCLUDED.raw_burst,raw_complex=EXCLUDED.raw_complex,
 raw_complex_ratio=EXCLUDED.raw_complex_ratio,raw_rhythm=EXCLUDED.raw_rhythm,raw_rhythm_ratio=EXCLUDED.raw_rhythm_ratio,
 calibration_version=EXCLUDED.calibration_version,sub_constant_1=EXCLUDED.sub_constant_1,main_constant=EXCLUDED.main_constant,
 sub_constant_2=EXCLUDED.sub_constant_2,stamina=EXCLUDED.stamina,handspeed=EXCLUDED.handspeed,burst=EXCLUDED.burst,
 complex=EXCLUDED.complex,rhythm=EXCLUDED.rhythm
 WHERE difficulty_constants.constants_version<>EXCLUDED.constants_version`, args...); err != nil {
			return err
		}
	}
	return nil
}

// Result is what a Recalibrate or RateStale run did, for the log.
type Result struct {
	Calibration Calibration
	// Previous is the calibration before this run's; New reports a calibration recorded now.
	Previous    *Calibration
	New         bool
	Rated       int // rows given new values
	MainChanged int // of those, rows whose main constant moved by more than 0.01
	Removed     int // rows no block refers to any more
}

func (r Result) String() string {
	s := fmt.Sprintf("calibration %d over %d routes", r.Calibration.Version, r.Calibration.Routes)
	if r.New {
		s += " (new"
		if r.Previous != nil {
			s += fmt.Sprintf(", replacing %d: %s", r.Previous.Version, ParamsDiff(r.Previous.Params, r.Calibration.Params))
		}
		s += ")"
	}
	return s + fmt.Sprintf("; %d rows rated, %d main constants moved by more than 0.01; %d unused rows removed", r.Rated, r.MainChanged, r.Removed)
}

// ParamsDiff names the values that differ between two calibrations.
func ParamsDiff(a, b Params) string {
	var ma, mb map[string]float64
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	json.Unmarshal(ja, &ma)
	json.Unmarshal(jb, &mb)
	keys := make([]string, 0, len(ma))
	for k := range ma {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	s := ""
	for _, k := range keys {
		if ma[k] != mb[k] {
			if s != "" {
				s += ", "
			}
			s += fmt.Sprintf("%s %v → %v", k, ma[k], mb[k])
		}
	}
	if s == "" {
		return "formulas or raw values changed"
	}
	return s
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Recalibrate computes a calibration from every route of every live chart (as rating.py's
// batch calibrates over all difficulties and branches), records it when it differs from the
// latest (or the latest is from other formulas or raw values), and rates every row by it.
// Rows no block refers to go first. With no rows it does nothing.
func Recalibrate(ctx context.Context, pool beginner) (Result, error) {
	return run(ctx, pool, true)
}

// RateStale rates rows not rated by the latest calibration (stored before there was one, or
// before it), without calibrating; before the first calibration, or when the latest is from
// other formulas or raw values, it calibrates instead.
func RateStale(ctx context.Context, pool beginner) (Result, error) {
	return run(ctx, pool, false)
}

func run(ctx context.Context, pool beginner, calibrate bool) (Result, error) {
	var result Result
	tx, err := pool.Begin(ctx)
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	// One run at a time, and none while it reads the rows it rates.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('ourtaiko:difficulty_constants',0))`); err != nil {
		return result, err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM difficulty_constants k WHERE NOT EXISTS (SELECT 1 FROM chart_difficulties d WHERE d.content_hash=k.content_hash)`)
	if err != nil {
		return result, err
	}
	result.Removed = int(tag.RowsAffected())
	latest, ok, err := Latest(ctx, tx)
	if err != nil {
		return result, err
	}
	if ok {
		result.Previous = &latest
	}
	calibration := latest
	if calibrate || !ok || !latest.Current() {
		rows, err := tx.Query(ctx, `SELECT note_count,raw_stamina,raw_handspeed,raw_burst,raw_complex,raw_complex_ratio,raw_rhythm,raw_rhythm_ratio
 FROM difficulty_constants k WHERE k.constants_version=$1 AND EXISTS (SELECT 1 FROM chart_difficulties d JOIN charts c ON c.id=d.chart_id
 WHERE d.content_hash=k.content_hash AND c.status<>'deleted') ORDER BY content_hash,route`, Version)
		if err != nil {
			return result, err
		}
		raws, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Raw, error) {
			var r Raw
			return r, row.Scan(&r.NoteCount, &r.Stamina, &r.Handspeed, &r.Burst, &r.Complex, &r.ComplexRatio, &r.Rhythm, &r.RhythmRatio)
		})
		if err != nil {
			return result, err
		}
		if len(raws) == 0 {
			return result, tx.Commit(ctx)
		}
		params, err := Calibrate(raws)
		if err != nil {
			return result, err
		}
		if !ok || !latest.Current() || params != latest.Params {
			encoded, err := json.Marshal(params)
			if err != nil {
				return result, err
			}
			calibration = Calibration{Version: latest.Version + 1, Params: params, RatingVersion: RatingVersion, ConstantsVersion: Version, Routes: len(raws)}
			if err = tx.QueryRow(ctx, `INSERT INTO constants_calibrations(version,params,rating_version,constants_version,route_count) VALUES($1,$2,$3,$4,$5) RETURNING computed_at`,
				calibration.Version, encoded, RatingVersion, Version, len(raws)).Scan(&calibration.ComputedAt); err != nil {
				return result, err
			}
			result.New = true
		}
	}
	result.Calibration = calibration
	rows, err := tx.Query(ctx, `SELECT content_hash,route,note_count,raw_stamina,raw_handspeed,raw_burst,raw_complex,raw_complex_ratio,raw_rhythm,raw_rhythm_ratio,main_constant
 FROM difficulty_constants WHERE constants_version=$1 AND calibration_version IS DISTINCT FROM $2`, Version, calibration.Version)
	if err != nil {
		return result, err
	}
	var hashes, routes []string
	var columns [8][]float64
	for rows.Next() {
		var hash, route string
		var r Raw
		var main *float64
		if err = rows.Scan(&hash, &route, &r.NoteCount, &r.Stamina, &r.Handspeed, &r.Burst, &r.Complex, &r.ComplexRatio, &r.Rhythm, &r.RhythmRatio, &main); err != nil {
			rows.Close()
			return result, err
		}
		rating := Rate(r, calibration.Params)
		if main != nil && math.Abs(rating.MainConstant-*main) > 0.01 {
			result.MainChanged++
		}
		hashes, routes = append(hashes, hash), append(routes, route)
		for i, v := range []float64{rating.SubConstant1, rating.MainConstant, rating.SubConstant2, rating.Stamina, rating.Handspeed, rating.Burst, rating.Complex, rating.Rhythm} {
			columns[i] = append(columns[i], v)
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return result, err
	}
	if len(hashes) > 0 {
		args := []any{calibration.Version, hashes, routes}
		for _, c := range columns {
			args = append(args, c)
		}
		if _, err = tx.Exec(ctx, `UPDATE difficulty_constants k SET calibration_version=$1,sub_constant_1=u.s1,main_constant=u.m,sub_constant_2=u.s2,
 stamina=u.st,handspeed=u.hs,burst=u.bu,complex=u.co,rhythm=u.rh
 FROM unnest($2::text[],$3::text[],$4::float8[],$5::float8[],$6::float8[],$7::float8[],$8::float8[],$9::float8[],$10::float8[],$11::float8[])
  AS u(hash,route,s1,m,s2,st,hs,bu,co,rh)
 WHERE k.content_hash=u.hash AND k.route=u.route`, args...); err != nil {
			return result, err
		}
	}
	result.Rated = len(hashes)
	return result, tx.Commit(ctx)
}

// NextCalibration is the weekly recalibration after t: Sunday 05:30 Tokyo time, after the
// servers' 04:00–05:00 backups.
func NextCalibration(t time.Time) time.Time {
	tokyo := time.FixedZone("JST", 9*60*60) // Japan keeps no daylight saving
	local := t.In(tokyo)
	next := time.Date(local.Year(), local.Month(), local.Day(), 5, 30, 0, 0, tokyo)
	next = next.AddDate(0, 0, (7-int(next.Weekday()))%7)
	if !next.After(local) {
		next = next.AddDate(0, 0, 7)
	}
	return next
}

// Due reports whether a calibration should run now rather than wait for the weekly one: none
// yet, one from other formulas or raw values, or one older than a week (a server that was down
// over Sunday).
func Due(c Calibration, ok bool, now time.Time) bool {
	return !ok || !c.Current() || now.Sub(c.ComputedAt) > 7*24*time.Hour
}
