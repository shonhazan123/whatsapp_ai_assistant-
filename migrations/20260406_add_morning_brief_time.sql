BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS morning_brief_time TIME NOT NULL DEFAULT '08:00';

COMMENT ON COLUMN users.morning_brief_time IS
  'User-preferred local time for morning digest (interpreted in users.timezone). Set via external website. Defaults to 08:00.';

COMMIT;
