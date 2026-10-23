-- Migration 045: 段位 codes: every course has a six-character code of capital letters and digits, unique
-- across the server, which the game's 外伝 entry takes to challenge a course that is not
-- listed (the lists only carry official courses). Makers may choose one; otherwise random.
ALTER TABLE dan_courses ADD COLUMN code text;
DO $$
DECLARE r record; candidate text; alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
BEGIN
 FOR r IN SELECT id FROM dan_courses WHERE code IS NULL ORDER BY id LOOP
  LOOP
   candidate := '';
   FOR i IN 1..6 LOOP candidate := candidate || substr(alphabet, 1 + floor(random()*36)::int, 1); END LOOP;
   EXIT WHEN NOT EXISTS(SELECT 1 FROM dan_courses WHERE code=candidate);
  END LOOP;
  UPDATE dan_courses SET code=candidate WHERE id=r.id;
 END LOOP;
END $$;
ALTER TABLE dan_courses ALTER COLUMN code SET NOT NULL, ADD CONSTRAINT dan_courses_code_check CHECK (code ~ '^[A-Z0-9]{6}$');
CREATE UNIQUE INDEX dan_courses_code ON dan_courses(code);
