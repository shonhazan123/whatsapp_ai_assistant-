-- ============================================
-- Conversation Memory Table for Supabase
-- ============================================
-- This script creates the conversation_memory table
-- with proper foreign key relationship to users table

-- First, ensure users table exists (if not already created)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whatsapp_number TEXT NOT NULL UNIQUE,
    plan_type TEXT NOT NULL DEFAULT 'standard' CHECK (plan_type IN ('free', 'standard', 'pro')),
    timezone TEXT DEFAULT 'Asia/Jerusalem',
    settings JSONB DEFAULT '{}',
    google_email TEXT,
    onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_last_prompt_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    scope TEXT[],
    token_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, provider)
);

-- Create the conversation_memory table with foreign key
CREATE TABLE IF NOT EXISTS conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast queries
-- Index on user_id and created_at for efficient history retrieval
CREATE INDEX IF NOT EXISTS idx_conversation_user_time 
ON conversation_memory(user_id, created_at DESC);

-- Index on created_at for cleanup operations
CREATE INDEX IF NOT EXISTS idx_conversation_created 
ON conversation_memory(created_at);

-- Add comments for documentation
COMMENT ON TABLE conversation_memory IS 'Stores conversation history for WhatsApp AI Assistant';
COMMENT ON COLUMN conversation_memory.id IS 'Unique identifier for each message';
COMMENT ON COLUMN conversation_memory.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN conversation_memory.role IS 'Message role: user, assistant, or system';
COMMENT ON COLUMN conversation_memory.content IS 'Message content/text';
COMMENT ON COLUMN conversation_memory.created_at IS 'Timestamp when message was created';

-- Helper function to get or create user by phone
CREATE OR REPLACE FUNCTION get_or_create_user(phone_number TEXT)
RETURNS UUID AS $$
DECLARE
    user_uuid UUID;
BEGIN
    -- Try to find existing user
    SELECT id INTO user_uuid FROM users WHERE whatsapp_number = phone_number;
    
    -- If not found, create new user
    IF user_uuid IS NULL THEN
        INSERT INTO users (whatsapp_number) VALUES (phone_number) RETURNING id INTO user_uuid;
    END IF;
    
    RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a function to automatically clean up old messages
CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS void AS $$
BEGIN
    -- Delete messages older than 7 days
    DELETE FROM conversation_memory 
    WHERE created_at < NOW() - INTERVAL '7 days';
    
    -- Delete excess messages per user (keep only last 50)
    DELETE FROM conversation_memory 
    WHERE id IN (
        SELECT id FROM (
            SELECT id, 
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
            FROM conversation_memory
        ) sub
        WHERE rn > 50
    );
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to run cleanup daily
-- Note: This requires pg_cron extension in Supabase
-- You can enable it in: Database > Extensions > pg_cron
-- Then uncomment the following:

-- SELECT cron.schedule(
--     'cleanup-old-conversations',
--     '0 2 * * *', -- Run at 2 AM daily
--     'SELECT cleanup_old_conversations();'
-- );

-- Grant permissions (adjust if needed for your Supabase setup)
-- GRANT ALL ON conversation_memory TO authenticated;
-- GRANT ALL ON conversation_memory TO service_role;

-- Verify the tables were created
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('users', 'conversation_memory')
ORDER BY table_name, ordinal_position;

-- Verify foreign key relationship
SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name = 'conversation_memory';

