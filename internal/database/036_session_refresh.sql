-- Legacy sessions keep their original deadline; new logins can renew for seven days.
ALTER TABLE sessions ADD COLUMN upstream_refresh_token bytea,
 ADD COLUMN upstream_expires_at timestamptz;
