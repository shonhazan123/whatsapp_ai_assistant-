-- ============================================
-- COMPLETE DATABASE SETUP FOR WHATSAPP AI ASSISTANT
-- ============================================
-- Run this entire script in Supabase SQL Editor
-- This creates all tables, indexes, and functions

-- ============================================
-- 1. USERS TABLE
-- ============================================
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

-- ============================================
-- 2. TASKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    category VARCHAR(50),
    due_date TIMESTAMP WITH TIME ZONE,
    reminder INTERVAL,
    reminder_recurrence JSONB,
    next_reminder_at TIMESTAMP WITH TIME ZONE,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. SUBTASKS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. CONTACT LIST TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS contact_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    phone_number VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    contact_list_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. LISTS TABLE (Notes & Checklists)
-- ============================================
CREATE TABLE IF NOT EXISTS lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_name VARCHAR(50) CHECK (list_name IN ('note', 'checklist')),
    content JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. CONVERSATION MEMORY TABLE
-- ============================================
DROP TABLE IF EXISTS conversation_memory CASCADE;

CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(due_date, reminder, completed)
WHERE due_date IS NOT NULL AND reminder IS NOT NULL AND reminder_recurrence IS NULL AND completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_recurring_reminder ON tasks(next_reminder_at, completed)
WHERE reminder_recurrence IS NOT NULL AND next_reminder_at IS NOT NULL AND completed = FALSE;

-- Subtasks indexes
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

-- Contact list indexes
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact_list(user_id);

-- Lists indexes
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(user_id);

-- Conversation memory indexes
CREATE INDEX IF NOT EXISTS idx_conversation_user_time ON conversation_memory(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation_memory(created_at);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get or create user by phone
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

DROP TRIGGER IF EXISTS set_user_google_tokens_updated_at ON user_google_tokens;
CREATE TRIGGER set_user_google_tokens_updated_at
    BEFORE UPDATE ON user_google_tokens
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- Function to clean up old conversations
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

-- Function to update task timestamp
CREATE OR REPLACE FUNCTION update_task_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update task timestamp
DROP TRIGGER IF EXISTS update_task_timestamp_trigger ON tasks;
CREATE TRIGGER update_task_timestamp_trigger
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_task_timestamp();

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check all tables exist
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_name IN ('users', 'user_google_tokens', 'tasks', 'subtasks', 'contact_list', 'lists', 'conversation_memory')
    AND table_schema = 'public'
ORDER BY table_name;

-- Check all functions exist
SELECT 
    routine_name,
    routine_type
FROM information_schema.routines
WHERE routine_name IN ('get_or_create_user', 'cleanup_old_conversations', 'update_task_timestamp')
    AND routine_schema = 'public';

-- Check foreign keys
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
    AND tc.table_name IN ('tasks', 'subtasks', 'contact_list', 'lists', 'conversation_memory')
ORDER BY tc.table_name;

-- Success message
SELECT '✅ Database setup complete! All tables, indexes, and functions created.' as status;

-- ============================================
-- TEST QUERIES (Optional - run to verify)
-- ============================================

-- Test user creation
-- SELECT get_or_create_user('+1234567890');

-- Test cleanup function
-- SELECT cleanup_old_conversations();

-- Check table sizes
-- SELECT 
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

