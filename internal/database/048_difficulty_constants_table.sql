-- Migration 048: the difficulty constants move to their own tables (internal/constants/store.go).
-- A block's constants follow from what it plays, so difficulty_constants is keyed by the
-- block's content hash and route (unbranched, or normal, expert and master): blocks that play
-- the same share a row, and a replaced file whose block plays the same keeps it. It holds the
-- raw values (the first stage, constants_version) and the eight published values (the second
-- stage, rating.py) under a calibration. constants_calibrations keeps every calibration: the 13
-- global minima and maxima, computed from the live charts at start-up when due and weekly, and
-- recorded only when they change. The columns 047 put on chart_difficulties go; the startup
-- backfill fills the new table (every route) and the calibration rates it.
CREATE TABLE constants_calibrations (
 version integer PRIMARY KEY CHECK (version > 0),
 params jsonb NOT NULL,
 rating_version smallint NOT NULL CHECK (rating_version > 0),
 constants_version smallint NOT NULL CHECK (constants_version > 0),
 route_count integer NOT NULL CHECK (route_count > 0),
 computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE difficulty_constants (
 content_hash text NOT NULL CHECK (content_hash ~ '^v[0-9]+:[0-9a-f]{64}$'),
 route text NOT NULL CHECK (route IN ('unbranched','normal','expert','master')),
 constants_version smallint NOT NULL CHECK (constants_version > 0),
 note_count integer NOT NULL CHECK (note_count >= 0),
 raw_stamina double precision NOT NULL,
 raw_handspeed double precision NOT NULL,
 raw_burst double precision NOT NULL,
 raw_complex double precision NOT NULL,
 raw_complex_ratio double precision NOT NULL,
 raw_rhythm double precision NOT NULL,
 raw_rhythm_ratio double precision NOT NULL,
 calibration_version integer REFERENCES constants_calibrations(version),
 sub_constant_1 double precision,
 main_constant double precision,
 sub_constant_2 double precision,
 stamina double precision,
 handspeed double precision,
 burst double precision,
 complex double precision,
 rhythm double precision,
 PRIMARY KEY (content_hash, route),
 CONSTRAINT difficulty_constants_rating_complete CHECK (num_nulls(calibration_version, sub_constant_1, main_constant, sub_constant_2,
  stamina, handspeed, burst, complex, rhythm) IN (0, 9))
);
CREATE INDEX difficulty_constants_calibration ON difficulty_constants (calibration_version);
CREATE INDEX chart_difficulties_content_hash ON chart_difficulties (content_hash);

ALTER TABLE chart_difficulties
 DROP CONSTRAINT chart_difficulties_constants_complete,
 DROP COLUMN constants_version,
 DROP COLUMN raw_stamina,
 DROP COLUMN raw_handspeed,
 DROP COLUMN raw_burst,
 DROP COLUMN raw_complex,
 DROP COLUMN raw_complex_ratio,
 DROP COLUMN raw_rhythm,
 DROP COLUMN raw_rhythm_ratio,
 DROP COLUMN note_count;
