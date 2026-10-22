-- 段位 courses (OurTaikoProfile plan P4): one to three chart blocks in order with the
-- conditions of the course format (.otdan.json). Any signed-in user may publish one;
-- administrators mark official ones, whose rewards.dan gives a 段位 badge through
-- OurTaikoProfile. A song names a chart, a course and the TJA hash it was set up on; a chart
-- replaced or removed later leaves the course unplayable instead of deleting it.
CREATE TABLE dan_courses (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id text NOT NULL REFERENCES users(id),
 title jsonb NOT NULL CHECK (jsonb_typeof(title)='object' AND title<>'{}'::jsonb),
 color smallint NOT NULL DEFAULT 0 CHECK (color BETWEEN 0 AND 7),
 exams jsonb NOT NULL CHECK (jsonb_typeof(exams)='array'),
 rewards jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(rewards)='object'),
 official boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'published' CHECK (status IN ('published','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dan_courses_listed ON dan_courses(official DESC,created_at DESC,id DESC) WHERE status='published';
CREATE TABLE dan_course_songs (
 course_id bigint NOT NULL REFERENCES dan_courses(id) ON DELETE CASCADE,
 position smallint NOT NULL CHECK (position BETWEEN 0 AND 2),
 chart_id text NOT NULL,
 course text NOT NULL CHECK (course IN ('Easy','Normal','Hard','Oni','Edit')),
 tja_hash text NOT NULL CHECK (tja_hash ~ '^[0-9a-f]{64}$'),
 hidden boolean NOT NULL DEFAULT false,
 PRIMARY KEY (course_id,position)
);
-- One per attempt a game reports (Idempotency-Key per user). granted is what OurTaikoProfile
-- gave; NULL until it answered, and a retry of the same attempt asks it again.
CREATE TABLE dan_attempts (
 id text PRIMARY KEY,
 course_id bigint NOT NULL REFERENCES dan_courses(id),
 user_id text NOT NULL REFERENCES users(id),
 idempotency_key text NOT NULL,
 payload_digest text NOT NULL,
 verdict smallint NOT NULL CHECK (verdict BETWEEN 0 AND 6),
 songs_played smallint NOT NULL CHECK (songs_played BETWEEN 0 AND 3),
 granted jsonb,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (user_id,idempotency_key)
);
CREATE INDEX dan_attempts_course ON dan_attempts(course_id,submitted_at DESC);
