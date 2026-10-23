-- Migration 046: a chart block's identity is what it plays, not the file it came in.
-- chart_difficulties.content_hash is TJAParser's hash of the block as played ("v1:" + 64 hex,
-- the algorithm version in the prefix); the server fills it on upload, replacement and, for
-- stored charts, a startup backfill (NULL until then). Scores stop being the latest when
-- their block's hash changes; a replaced file whose blocks play the same keeps them. Audio
-- changes still retire the whole chart (retireChart). 段位 songs name a side and carry a
-- valid flag the same trigger clears; the old tja_hash (the file's hash) goes.
ALTER TABLE chart_difficulties ADD COLUMN content_hash text CHECK (content_hash ~ '^v[0-9]+:[0-9a-f]{64}$');

CREATE FUNCTION chart_difficulties_retire_scores() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE scores SET is_latest=false WHERE is_latest AND difficulty_id=NEW.id;
 UPDATE dan_course_songs SET valid=false WHERE chart_id=NEW.chart_id AND course=NEW.course AND side=NEW.side;
 RETURN NULL;
END $$;
-- OLD NULL is the backfill filling a hash in for the first time: nothing changed.
CREATE TRIGGER chart_difficulties_retire_scores AFTER UPDATE OF content_hash ON chart_difficulties
 FOR EACH ROW WHEN (OLD.content_hash IS NOT NULL AND OLD.content_hash IS DISTINCT FROM NEW.content_hash)
 EXECUTE FUNCTION chart_difficulties_retire_scores();

CREATE FUNCTION chart_difficulties_invalidate_dan_songs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE dan_course_songs SET valid=false WHERE chart_id=OLD.chart_id AND course=OLD.course AND side=OLD.side;
 RETURN NULL;
END $$;
CREATE TRIGGER chart_difficulties_invalidate_dan_songs AFTER DELETE ON chart_difficulties
 FOR EACH ROW EXECUTE FUNCTION chart_difficulties_invalidate_dan_songs();

ALTER TABLE dan_course_songs
 ADD COLUMN side text NOT NULL DEFAULT 'single' CHECK (side IN ('single','p1','p2')),
 ADD COLUMN valid boolean NOT NULL DEFAULT true;
ALTER TABLE dan_course_songs ALTER COLUMN side DROP DEFAULT;
-- Existing songs are pinned to the single block; a course without one is unplayable until its
-- maker picks a side.
UPDATE dan_course_songs s SET valid=false
 WHERE NOT EXISTS (SELECT 1 FROM chart_difficulties d WHERE d.chart_id=s.chart_id AND d.course=s.course AND d.side='single');
ALTER TABLE dan_course_songs DROP COLUMN tja_hash;
