-- Migration 056: a 段位 attempt names the scores of its songs. songs_played was how many songs
-- were played; it becomes their scores' ids in song order, so its length is still that count.
-- An element is NULL while the song's score is not known: it was never uploaded, or has not
-- arrived yet. score_keys are the Idempotency-Keys the game uploads those scores with, which is
-- how a score that arrives after its attempt is put in (POST /game/scores); empty for attempts
-- of games that do not send them.
ALTER TABLE dan_attempts DROP CONSTRAINT dan_attempts_songs_played_check;
ALTER TABLE dan_attempts ALTER COLUMN songs_played TYPE text[] USING array_fill(NULL::text, ARRAY[songs_played::int]);
ALTER TABLE dan_attempts ADD CONSTRAINT dan_attempts_songs_played_check CHECK (cardinality(songs_played) BETWEEN 0 AND 3);
ALTER TABLE dan_attempts ADD COLUMN score_keys text[] NOT NULL DEFAULT '{}'
 CHECK (cardinality(score_keys) IN (0, cardinality(songs_played)));

-- The scores an attempt's songs most likely made, for attempts without score_keys: for each
-- song played, the player's latest score on that song's chart and course that came in after the
-- player's attempt before this one (at most an hour back) and before this one: the game uploads
-- a course's scores just before its attempt. A score that came later is not looked for, since it
-- could as well be the next attempt's. NULL where there is none.
CREATE FUNCTION dan_attempt_scores(attempt text) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT COALESCE(array_agg(m.id ORDER BY g.position), '{}')
 FROM dan_attempts a
 CROSS JOIN LATERAL generate_series(0, cardinality(a.songs_played) - 1) g(position)
 LEFT JOIN LATERAL (
  SELECT sc.id FROM dan_course_songs s
  JOIN chart_difficulties d ON d.chart_id = s.chart_id AND d.course = s.course
  JOIN scores sc ON sc.difficulty_id = d.id AND sc.user_id = a.user_id
  WHERE s.course_id = a.course_id AND s.position = g.position
   AND sc.submitted_at <= a.submitted_at
   AND sc.submitted_at > GREATEST(a.submitted_at - interval '1 hour',
    COALESCE((SELECT max(b.submitted_at) FROM dan_attempts b WHERE b.user_id = a.user_id AND b.submitted_at < a.submitted_at), '-infinity'))
  ORDER BY sc.submitted_at DESC, sc.id LIMIT 1
 ) m ON true
 WHERE a.id = attempt
$$;

-- The attempts made so far: whatever scores can be found for them.
UPDATE dan_attempts SET songs_played = dan_attempt_scores(id) WHERE cardinality(songs_played) > 0;
