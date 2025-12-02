BEGIN;

-- Update the CHECK constraint to include 'iphone_calendar_sync' step
ALTER TABLE user_onboarding_progress
  DROP CONSTRAINT IF EXISTS user_onboarding_progress_step_check;

ALTER TABLE user_onboarding_progress
  ADD CONSTRAINT user_onboarding_progress_step_check
  CHECK (step IN ('start', 'google_connect', 'iphone_calendar_sync', 'calendar_practice', 'reminder_practice', 'list_practice', 'memory_practice', 'done'));

COMMIT;

