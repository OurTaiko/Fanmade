-- R056: OurTaikoPlay's counts of the notes outside good/ok/bad (2026-11-01): adlib is [良, 可] of the
-- hidden Ad-Lib notes hit, which no longer count in good and ok; mines is how many mines were
-- hit (a mine hit loses the full combo but is not a bad). Plays from before read zero.
ALTER TABLE scores
  ADD COLUMN adlib integer[] NOT NULL DEFAULT '{0,0}'
    CHECK (cardinality(adlib) = 2 AND array_position(adlib, NULL) IS NULL AND adlib[1] >= 0 AND adlib[2] >= 0),
  ADD COLUMN mines integer NOT NULL DEFAULT 0 CHECK (mines >= 0);
