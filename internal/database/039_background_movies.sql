-- A chart may reference a background movie (BGMOVIE) stored like its other
-- files, with MOVIEOFFSET in seconds.
ALTER TABLE charts
 ADD COLUMN movie_file bigint REFERENCES chart_resources(id),
 ADD COLUMN movie_offset double precision NOT NULL DEFAULT 0 CHECK(movie_offset BETWEEN -1200 AND 1200);
CREATE INDEX charts_movie_file ON charts(movie_file);
CREATE OR REPLACE FUNCTION retire_chart_files() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 INSERT INTO retired_files(storage_key) SELECT storage_key FROM chart_resources
  WHERE id IN (OLD.tja_file,OLD.audio_file,OLD.cover_file,OLD.preview_file,OLD.movie_file)
   AND (TG_OP='DELETE' OR NOT id=ANY(array_remove(ARRAY[NEW.tja_file,NEW.audio_file,NEW.cover_file,NEW.preview_file,NEW.movie_file],NULL)))
  ON CONFLICT DO NOTHING;
 RETURN NULL;
END;
$$;
DROP TRIGGER charts_retire_files ON charts;
CREATE TRIGGER charts_retire_files AFTER DELETE OR UPDATE OF tja_file,audio_file,cover_file,preview_file,movie_file ON charts
 FOR EACH ROW EXECUTE FUNCTION retire_chart_files();
