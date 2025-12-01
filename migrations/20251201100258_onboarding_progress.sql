BEGIN;

-- Create user_onboarding_progress table for tracking onboarding steps
CREATE TABLE IF NOT EXISTS user_onboarding_progress (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step TEXT NOT NULL DEFAULT 'start' CHECK (step IN ('start', 'google_connect', 'calendar_practice', 'reminder_practice', 'list_practice', 'memory_practice', 'done')),
  completed BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_user_id ON user_onboarding_progress(user_id);

-- Add trigger for updated_at auto-update
DROP TRIGGER IF EXISTS set_onboarding_updated_at ON user_onboarding_progress;
CREATE TRIGGER set_onboarding_updated_at
  BEFORE UPDATE ON user_onboarding_progress
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMIT;

