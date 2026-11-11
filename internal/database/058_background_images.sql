-- A chart may reference a background image (BGIMAGE), stored as WebP like its cover. The
-- triggers that retire replaced files and refresh update_at learn the new column.
ALTER TABLE charts ADD COLUMN bgimage_file bigint REFERENCES chart_resources(id);
CREATE INDEX charts_bgimage_file ON charts(bgimage_file);
CREATE OR REPLACE FUNCTION retire_chart_files() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 INSERT INTO retired_files(storage_key) SELECT storage_key FROM chart_resources
  WHERE id IN (OLD.tja_file,OLD.audio_file,OLD.cover_file,OLD.preview_file,OLD.movie_file,OLD.bgimage_file)
   AND (TG_OP='DELETE' OR NOT id=ANY(array_remove(ARRAY[NEW.tja_file,NEW.audio_file,NEW.cover_file,NEW.preview_file,NEW.movie_file,NEW.bgimage_file],NULL)))
  ON CONFLICT DO NOTHING;
 RETURN NULL;
END;
$$;
DROP TRIGGER charts_retire_files ON charts;
CREATE TRIGGER charts_retire_files AFTER DELETE OR UPDATE OF tja_file,audio_file,cover_file,preview_file,movie_file,bgimage_file ON charts
 FOR EACH ROW EXECUTE FUNCTION retire_chart_files();
CREATE OR REPLACE FUNCTION chart_resources_touch_charts() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    UPDATE charts SET update_at = greatest(update_at, clock_timestamp())
     WHERE NEW.id IN (tja_file, audio_file, cover_file, movie_file, bgimage_file);
  END IF;
  RETURN NULL;
END;
$$;
