BEGIN;

-- Rename primary phone column to explicit whatsapp identifier
ALTER TABLE users
  RENAME COLUMN phone TO whatsapp_number;

ALTER TABLE users
  ADD CONSTRAINT users_whatsapp_number_unique UNIQUE (whatsapp_number);

-- Extend users table with plan metadata and onboarding flags
ALTER TABLE users
  ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'standard' CHECK (plan_type IN ('free', 'standard', 'pro')),
  ADD COLUMN google_email TEXT,
  ADD COLUMN onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN onboarding_last_prompt_at TIMESTAMPTZ,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure timestamps are initialized
UPDATE users SET updated_at = NOW() WHERE updated_at IS NULL;

-- Shared trigger function for updated_at maintenance
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Store OAuth tokens per user/provider
CREATE TABLE IF NOT EXISTS user_google_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT[],
  token_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

DROP TRIGGER IF EXISTS set_user_google_tokens_updated_at ON user_google_tokens;
CREATE TRIGGER set_user_google_tokens_updated_at
  BEFORE UPDATE ON user_google_tokens
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Align contact and list ownership with user_id naming
ALTER TABLE contact_list
  RENAME COLUMN contact_list_id TO user_id;

ALTER TABLE lists
  RENAME COLUMN list_id TO user_id;

DROP INDEX IF EXISTS idx_contact_user;
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact_list(user_id);

DROP INDEX IF EXISTS idx_lists_user;
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);

-- Ensure helper function uses whatsapp identifier
CREATE OR REPLACE FUNCTION get_or_create_user(phone_number TEXT)
RETURNS UUID AS $$
DECLARE
  user_uuid UUID;
BEGIN
  SELECT id INTO user_uuid FROM users WHERE whatsapp_number = phone_number;

  IF user_uuid IS NULL THEN
    INSERT INTO users (whatsapp_number) VALUES (phone_number) RETURNING id INTO user_uuid;
  END IF;

  RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;

COMMIT;

