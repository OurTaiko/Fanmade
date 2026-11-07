-- Migration 055: an owner can revoke a pending co-creator invitation. The record stays,
-- marked revoked with who revoked it (responded_at is when), so owners still see it in the
-- chart's invitation history; the recipient's notice then shows it was revoked.
ALTER TABLE chart_collaborations DROP CONSTRAINT chart_collaborations_status_check;
ALTER TABLE chart_collaborations ADD CONSTRAINT chart_collaborations_status_check
 CHECK(status IN ('pending','accepted','declined','revoked'));
ALTER TABLE chart_collaborations ADD COLUMN revoked_by text REFERENCES users(id);
ALTER TABLE chart_collaborations ADD CONSTRAINT chart_collaborations_revoked_by
 CHECK((status='revoked')=(revoked_by IS NOT NULL));
