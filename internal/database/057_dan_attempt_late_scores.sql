-- Migration 057: the scores of an attempt's songs are looked for up to half a minute after the
-- attempt too. The game starts uploading as soon as the first song's score is queued, so that
-- pass takes the first score and then the attempt; the other songs' scores follow in the next
-- pass, a few seconds after the attempt. 056 only looked before the attempt, and found the first
-- song's score alone. A song takes longer than half a minute, so the next attempt's scores are
-- not within reach; for the same reason an attempt does not look into the half minute after the
-- attempt before it.
CREATE OR REPLACE FUNCTION dan_attempt_scores(attempt text) RETURNS text[] LANGUAGE sql STABLE AS $$
 SELECT COALESCE(array_agg(m.id ORDER BY g.position), '{}')
 FROM dan_attempts a
 CROSS JOIN LATERAL generate_series(0, cardinality(a.songs_played) - 1) g(position)
 LEFT JOIN LATERAL (
  SELECT sc.id FROM dan_course_songs s
  JOIN chart_difficulties d ON d.chart_id = s.chart_id AND d.course = s.course
  JOIN scores sc ON sc.difficulty_id = d.id AND sc.user_id = a.user_id
  WHERE s.course_id = a.course_id AND s.position = g.position
   AND sc.submitted_at <= a.submitted_at + interval '30 seconds'
   AND sc.submitted_at > GREATEST(a.submitted_at - interval '1 hour',
    COALESCE((SELECT max(b.submitted_at) FROM dan_attempts b WHERE b.user_id = a.user_id AND b.submitted_at < a.submitted_at) + interval '30 seconds', '-infinity'))
  ORDER BY sc.submitted_at DESC, sc.id LIMIT 1
 ) m ON true
 WHERE a.id = attempt
$$;

-- Again for the attempts whose scores were looked for by time (those with keys have theirs).
UPDATE dan_attempts SET songs_played = dan_attempt_scores(id) WHERE cardinality(songs_played) > 0 AND cardinality(score_keys) = 0;
