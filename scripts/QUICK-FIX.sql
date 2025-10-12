-- ============================================
-- QUICK FIX: Drop and Recreate conversation_memory
-- ============================================
-- ⚠️ WARNING: This will DELETE all existing conversation history!
-- Run this if you're okay with starting fresh

-- Drop old table
DROP TABLE IF EXISTS conversation_memory CASCADE;

-- Ensure users table exists
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    timezone TEXT DEFAULT 'Asia/Jerusalem',
    settings JSONB DEFAULT '{}'
);

-- Create new table with proper structure
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_conversation_user_time ON conversation_memory(user_id, created_at DESC);
CREATE INDEX idx_conversation_created ON conversation_memory(created_at);

-- Helper function
CREATE OR REPLACE FUNCTION get_or_create_user(phone_number TEXT)
RETURNS UUID AS $$
DECLARE
    user_uuid UUID;
BEGIN
    SELECT id INTO user_uuid FROM users WHERE phone = phone_number;
    IF user_uuid IS NULL THEN
        INSERT INTO users (phone) VALUES (phone_number) RETURNING id INTO user_uuid;
    END IF;
    RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;

-- Verify
SELECT 'Setup complete! ✅' as status;

