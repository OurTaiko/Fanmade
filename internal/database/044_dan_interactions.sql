-- Migration 044: 段位 courses take votes and comments as songs do (034).
-- A course keeps its own tallies; comments hang on either a song or a course.
ALTER TABLE dan_courses
 ADD COLUMN upvotes integer NOT NULL DEFAULT 0 CHECK(upvotes>=0),
 ADD COLUMN downvotes integer NOT NULL DEFAULT 0 CHECK(downvotes>=0),
 ADD COLUMN comment_count integer NOT NULL DEFAULT 0 CHECK(comment_count>=0);
CREATE INDEX dan_courses_score ON dan_courses((upvotes-downvotes) DESC) WHERE status='published';

CREATE TABLE dan_votes (
 dan_id bigint NOT NULL REFERENCES dan_courses(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id),
 value smallint NOT NULL CHECK(value IN (-1,1)),
 voted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dan_id,user_id)
);
CREATE INDEX dan_votes_user ON dan_votes(user_id);

CREATE FUNCTION count_dan_vote() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE target bigint; up integer:=0; down integer:=0;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN
  target:=OLD.dan_id;
  IF OLD.value=1 THEN up:=up-1; ELSE down:=down-1; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') THEN
  target:=NEW.dan_id;
  IF NEW.value=1 THEN up:=up+1; ELSE down:=down+1; END IF;
 END IF;
 UPDATE dan_courses SET upvotes=upvotes+up,downvotes=downvotes+down WHERE id=target;
 RETURN NULL;
END;
$$;
CREATE TRIGGER dan_votes_count AFTER INSERT OR UPDATE OF value OR DELETE ON dan_votes FOR EACH ROW EXECUTE FUNCTION count_dan_vote();

ALTER TABLE comments
 ALTER COLUMN chart_id DROP NOT NULL,
 ADD COLUMN dan_id bigint REFERENCES dan_courses(id) ON DELETE CASCADE,
 ADD CHECK((chart_id IS NULL)<>(dan_id IS NULL));
CREATE INDEX comments_dan_roots ON comments(dan_id,created_at DESC) WHERE parent_id IS NULL AND dan_id IS NOT NULL;

CREATE OR REPLACE FUNCTION count_comment() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE delta integer; rec comments;
BEGIN
 IF TG_OP='INSERT' THEN delta:=1; rec:=NEW; ELSE delta:=-1; rec:=OLD; END IF;
 IF rec.parent_id IS NOT NULL THEN
  UPDATE comments SET reply_count=reply_count+delta WHERE id=rec.parent_id;
 END IF;
 IF rec.dan_id IS NOT NULL THEN
  UPDATE dan_courses SET comment_count=comment_count+delta WHERE id=rec.dan_id;
 ELSIF EXISTS(SELECT 1 FROM charts WHERE id=rec.chart_id) THEN
  INSERT INTO chart_stats(chart_id,comment_count) VALUES(rec.chart_id,greatest(delta,0))
  ON CONFLICT(chart_id) DO UPDATE SET comment_count=chart_stats.comment_count+delta;
 END IF;
 RETURN NULL;
END;
$$;

ALTER TABLE notifications ADD COLUMN dan_id bigint REFERENCES dan_courses(id) ON DELETE CASCADE;
