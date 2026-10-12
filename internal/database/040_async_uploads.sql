-- An upload is accepted before its files are decoded and stored. Its receipt
-- exists from acceptance; title lets a failure be reported after a restart.
ALTER TABLE upload_requests
 ADD COLUMN status text NOT NULL DEFAULT 'done' CHECK(status IN ('processing','done')),
 ADD COLUMN title text NOT NULL DEFAULT '';
