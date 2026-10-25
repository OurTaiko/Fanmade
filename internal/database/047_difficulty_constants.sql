-- Migration 047: the raw values behind OurTaiko's difficulty constants (定数) for each block,
-- computed by the server from the notes TJAParser plays (internal/constants, a port of the
-- constants repository's algorithms; the calibration and the final 0–15.5 constants stay
-- there). A branching block stores its master route. raw_handspeed is the repository's speed;
-- raw_complex_ratio and raw_rhythm_ratio are what its final conversion reads; note_count is
-- totalNotes, the route's don and ka notes. constants_version is the algorithm's version: the
-- startup backfill fills NULL rows and recomputes older ones. All nine are set together.
ALTER TABLE chart_difficulties
 ADD COLUMN constants_version smallint CHECK (constants_version > 0),
 ADD COLUMN raw_stamina double precision,
 ADD COLUMN raw_handspeed double precision,
 ADD COLUMN raw_burst double precision,
 ADD COLUMN raw_complex double precision,
 ADD COLUMN raw_complex_ratio double precision,
 ADD COLUMN raw_rhythm double precision,
 ADD COLUMN raw_rhythm_ratio double precision,
 ADD COLUMN note_count integer CHECK (note_count >= 0),
 ADD CONSTRAINT chart_difficulties_constants_complete CHECK (num_nulls(constants_version, raw_stamina, raw_handspeed,
  raw_burst, raw_complex, raw_complex_ratio, raw_rhythm, raw_rhythm_ratio, note_count) IN (0, 9));
