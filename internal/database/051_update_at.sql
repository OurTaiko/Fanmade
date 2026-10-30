-- charts.update_at as on OurTaiko Database (R010): when the chart or anything about it last
-- changed, not only its metadata, so metadata_updated_at goes. Triggers keep it: any real change
-- of the row except the derived preview clip, a change of a file record it references, and a
-- block, vote or comment of the chart (a comment's votes and replies change the comment). It
-- never moves backwards.
ALTER TABLE charts ADD COLUMN update_at timestamptz;

-- Until now no one kept this, so it starts at the latest change the database still remembers:
-- metadata edits, uploads and replacements, votes, comments and their votes, and co-owners.
UPDATE charts c SET update_at = greatest(c.created_at, c.metadata_updated_at,
  (SELECT max(r.created_at) FROM upload_requests r WHERE r.chart_id = c.id),
  (SELECT max(v.voted_at) FROM chart_votes v WHERE v.chart_id = c.id),
  (SELECT max(greatest(m.created_at, m.edited_at, m.deleted_at, m.removed_at)) FROM comments m WHERE m.chart_id = c.id),
  (SELECT max(v.voted_at) FROM comment_votes v JOIN comments m ON m.id = v.comment_id WHERE m.chart_id = c.id),
  (SELECT max(greatest(k.created_at, k.responded_at)) FROM chart_collaborations k WHERE k.chart_id = c.id));

ALTER TABLE charts ALTER COLUMN update_at SET DEFAULT now(), ALTER COLUMN update_at SET NOT NULL,
  DROP COLUMN metadata_updated_at;

CREATE FUNCTION charts_touch_update_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) - 'update_at' - 'preview_file' IS DISTINCT FROM to_jsonb(OLD) - 'update_at' - 'preview_file' THEN
    NEW.update_at := greatest(OLD.update_at, clock_timestamp());
  ELSE
    -- Only update_at or the preview clip was written: a related row touching the chart.
    NEW.update_at := greatest(OLD.update_at, NEW.update_at);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER charts_touch_update_at BEFORE UPDATE ON charts
  FOR EACH ROW EXECUTE FUNCTION charts_touch_update_at();

-- A changed shared file record refreshes every chart that references it.
CREATE FUNCTION chart_resources_touch_charts() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    UPDATE charts SET update_at = greatest(update_at, clock_timestamp())
     WHERE NEW.id IN (tja_file, audio_file, cover_file, movie_file);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER chart_resources_touch_charts AFTER UPDATE ON chart_resources
  FOR EACH ROW EXECUTE FUNCTION chart_resources_touch_charts();

-- Related rows also count as changes of the chart. A comment on a 段位 course has no chart.
CREATE FUNCTION touch_related_chart() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target text;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD.chart_id; ELSE target := NEW.chart_id; END IF;
  UPDATE charts SET update_at = greatest(update_at, clock_timestamp()) WHERE id = target;
  RETURN NULL;
END;
$$;
CREATE TRIGGER chart_difficulties_touch_chart AFTER INSERT OR UPDATE OR DELETE ON chart_difficulties
  FOR EACH ROW EXECUTE FUNCTION touch_related_chart();
CREATE TRIGGER chart_votes_touch_chart AFTER INSERT OR UPDATE OR DELETE ON chart_votes
  FOR EACH ROW EXECUTE FUNCTION touch_related_chart();
CREATE TRIGGER comments_touch_chart AFTER INSERT OR UPDATE OR DELETE ON comments
  FOR EACH ROW EXECUTE FUNCTION touch_related_chart();
