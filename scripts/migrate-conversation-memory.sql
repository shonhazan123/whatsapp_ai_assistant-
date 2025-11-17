-- ============================================
-- Migration Script: Add Foreign Key to conversation_memory
-- ============================================
-- This script safely migrates existing conversation_memory table
-- to use foreign key relationship with users table

-- Step 1: Check if old table exists and drop it (CAREFUL!)
-- Uncomment ONLY if you want to delete existing conversation history
-- DROP TABLE IF EXISTS conversation_memory CASCADE;

-- Step 2: Ensure users table exists
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

-- Step 3: Drop old conversation_memory table if it exists (with old structure)
-- This will delete all existing conversation history!
DROP TABLE IF EXISTS conversation_memory CASCADE;

-- Step 4: Create new conversation_memory table with proper foreign key
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 5: Create indexes for fast queries
CREATE INDEX idx_conversation_user_time 
ON conversation_memory(user_id, created_at DESC);

CREATE INDEX idx_conversation_created 
ON conversation_memory(created_at);

-- Step 6: Add comments for documentation
COMMENT ON TABLE conversation_memory IS 'Stores conversation history for WhatsApp AI Assistant';
COMMENT ON COLUMN conversation_memory.id IS 'Unique identifier for each message';
COMMENT ON COLUMN conversation_memory.user_id IS 'Foreign key to users table';
COMMENT ON COLUMN conversation_memory.role IS 'Message role: user, assistant, or system';
COMMENT ON COLUMN conversation_memory.content IS 'Message content/text';
COMMENT ON COLUMN conversation_memory.created_at IS 'Timestamp when message was created';

-- Step 7: Helper function to get or create user by phone
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

-- Step 8: Cleanup function
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

-- Step 9: Verify the setup
SELECT 
    'users' as table_name,
    COUNT(*) as row_count
FROM users
UNION ALL
SELECT 
    'conversation_memory' as table_name,
    COUNT(*) as row_count
FROM conversation_memory;

-- Step 10: Verify foreign key exists
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

-- Success message
SELECT '✅ Migration completed successfully!' as status;

