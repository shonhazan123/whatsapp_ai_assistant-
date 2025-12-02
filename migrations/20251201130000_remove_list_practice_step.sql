BEGIN;

-- Update the CHECK constraint to remove 'list_practice' step
ALTER TABLE user_onboarding_progress
  DROP CONSTRAINT IF EXISTS user_onboarding_progress_step_check;

ALTER TABLE user_onboarding_progress
  ADD CONSTRAINT user_onboarding_progress_step_check
  CHECK (step IN ('start', 'google_connect', 'iphone_calendar_sync', 'calendar_practice', 'reminder_practice', 'memory_practice', 'done'));

-- Update any users currently stuck on list_practice step to reminder_practice
UPDATE user_onboarding_progress
SET step = 'reminder_practice', completed = FALSE
WHERE step = 'list_practice';

COMMIT;

