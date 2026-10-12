-- Files become independent records that charts reference by ID. New objects are
-- stored as {sha256}.{extension}; the server rewrites existing keys afterwards,
-- so the key format is not yet enforced here. Download ZIPs are no longer
-- stored: the server builds them on request.
-- Settle deferred checks queued earlier in this transaction before their
-- triggers and table are replaced.
SET CONSTRAINTS ALL IMMEDIATE;
DROP TRIGGER charts_require_resources ON charts;
DROP TRIGGER resources_keep_required ON chart_resources;
DROP TRIGGER retire_chart_resource ON chart_resources;
DROP FUNCTION require_chart_resources();
DROP FUNCTION retire_resource_object();
CREATE TEMP TABLE resources_038 ON COMMIT DROP AS SELECT * FROM chart_resources;
DROP TABLE chart_resources;
INSERT INTO retired_files(storage_key) SELECT storage_key FROM resources_038 WHERE kind='archive' ON CONFLICT DO NOTHING;
CREATE TABLE chart_resources (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 storage_key text NOT NULL UNIQUE CHECK(storage_key<>''),
 original_filename text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size>0),
 extension text NOT NULL CHECK(extension ~ '^[a-z0-9]+$')
);
INSERT INTO chart_resources(storage_key,original_filename,sha256,byte_size,extension)
 SELECT DISTINCT ON (storage_key) storage_key,original_filename,sha256,byte_size,
  CASE kind WHEN 'tja' THEN 'tja' WHEN 'cover' THEN 'webp' WHEN 'preview' THEN 'ogg'
   ELSE COALESCE(CASE media_type WHEN 'audio/ogg' THEN 'ogg' WHEN 'audio/mpeg' THEN 'mp3' END,
    lower(substring(original_filename from '\.([A-Za-z0-9]+)$')),'bin') END
 FROM resources_038 WHERE kind<>'archive' ORDER BY storage_key,chart_id,kind;
ALTER TABLE charts
 ADD COLUMN tja_file bigint REFERENCES chart_resources(id),
 ADD COLUMN audio_file bigint REFERENCES chart_resources(id),
 ADD COLUMN cover_file bigint REFERENCES chart_resources(id),
 ADD COLUMN preview_file bigint REFERENCES chart_resources(id);
UPDATE charts c SET
 tja_file=(SELECT n.id FROM resources_038 o JOIN chart_resources n USING(storage_key) WHERE o.chart_id=c.id AND o.kind='tja'),
 audio_file=(SELECT n.id FROM resources_038 o JOIN chart_resources n USING(storage_key) WHERE o.chart_id=c.id AND o.kind='audio'),
 cover_file=(SELECT n.id FROM resources_038 o JOIN chart_resources n USING(storage_key) WHERE o.chart_id=c.id AND o.kind='cover'),
 preview_file=(SELECT n.id FROM resources_038 o JOIN chart_resources n USING(storage_key) WHERE o.chart_id=c.id AND o.kind='preview');
-- Stored TJA files name their audio themselves; see tja.SetWave.
ALTER TABLE charts ALTER COLUMN tja_file SET NOT NULL, ALTER COLUMN audio_file SET NOT NULL, DROP COLUMN wave_filename;
CREATE INDEX charts_tja_file ON charts(tja_file);
CREATE INDEX charts_audio_file ON charts(audio_file);
CREATE INDEX charts_cover_file ON charts(cover_file);
CREATE INDEX charts_preview_file ON charts(preview_file);
-- Files are shared, so releasing a reference only queues the file. The server
-- deletes it once no chart refers to it.
CREATE FUNCTION retire_chart_files() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
 INSERT INTO retired_files(storage_key) SELECT storage_key FROM chart_resources
  WHERE id IN (OLD.tja_file,OLD.audio_file,OLD.cover_file,OLD.preview_file)
   AND (TG_OP='DELETE' OR NOT id=ANY(array_remove(ARRAY[NEW.tja_file,NEW.audio_file,NEW.cover_file,NEW.preview_file],NULL)))
  ON CONFLICT DO NOTHING;
 RETURN NULL;
END;
$$;
CREATE TRIGGER charts_retire_files AFTER DELETE OR UPDATE OF tja_file,audio_file,cover_file,preview_file ON charts
 FOR EACH ROW EXECUTE FUNCTION retire_chart_files();
SET CONSTRAINTS ALL DEFERRED;
