package httpapi

import (
	"context"
	"log"
	"time"

	"ourtaiko.dev/sitekit/constants"
)

// RunDifficultyConstants keeps difficulty_constants complete and rated: the startup backfill
// first (hashes and raw values), then a calibration when one is due (none yet, other formulas
// or raw values, or the last over a week old) or else the rating of rows stored before the
// latest one, then the weekly recalibration (constants.NextCalibration); a failed run is tried
// again an hour later. A changed calibration takes effect at once and is logged with what
// changed.
func (s *Server) RunDifficultyConstants(ctx context.Context) {
	s.RunContentHashBackfill(ctx)
	latest, ok, err := constants.Latest(ctx, s.DB)
	if err != nil {
		log.Printf("difficulty constants: %v", err)
	}
	run := constants.RateStale
	if err == nil && constants.Due(latest, ok, time.Now()) {
		run = constants.Recalibrate
	}
	for ctx.Err() == nil {
		next := constants.NextCalibration(time.Now())
		if result, err := run(ctx, s.DB); err != nil {
			if ctx.Err() == nil {
				log.Printf("difficulty constants: %v", err)
			}
			next = time.Now().Add(time.Hour) // try again soon rather than next week
		} else {
			run = constants.Recalibrate
			if result.New || result.Rated > 0 || result.Removed > 0 {
				log.Printf("difficulty constants: %s", result)
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Until(next)):
		}
	}
}
