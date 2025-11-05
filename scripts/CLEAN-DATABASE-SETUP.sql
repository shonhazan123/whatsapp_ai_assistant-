-- ============================================
-- CLEAN DATABASE SETUP - Safe for Existing Tables
-- ============================================
-- This script safely sets up the database even if some tables already exist

-- ============================================
-- STEP 1: Drop dependent tables first (if starting fresh)
-- ============================================
-- Uncomment these if you want to completely reset:
-- DROP TABLE IF EXISTS conversation_memory CASCADE;
-- DROP TABLE IF EXISTS subtasks CASCADE;
-- DROP TABLE IF EXISTS tasks CASCADE;
-- DROP TABLE IF EXISTS contact_list CASCADE;
-- DROP TABLE IF EXISTS lists CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- STEP 2: Create tables in order
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone TEXT NOT NULL UNIQUE,
    timezone TEXT DEFAULT 'Asia/Jerusalem',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
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

-- Subtasks table
CREATE TABLE IF NOT EXISTS subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Contact list table
CREATE TABLE IF NOT EXISTS contact_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_list_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255),
    phone_number VARCHAR(20),
    email VARCHAR(255),
    address TEXT,
    contact_list_name VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lists table
CREATE TABLE IF NOT EXISTS lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    list_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    list_name VARCHAR(50) CHECK (list_name IN ('note', 'checklist')),
    content JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversation memory table
CREATE TABLE IF NOT EXISTS conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- STEP 3: Create indexes (with IF NOT EXISTS)
-- ============================================

-- Tasks indexes
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date) WHERE completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(due_date, reminder, completed)
WHERE due_date IS NOT NULL AND reminder IS NOT NULL AND reminder_recurrence IS NULL AND completed = FALSE;
CREATE INDEX IF NOT EXISTS idx_tasks_recurring_reminder ON tasks(next_reminder_at, completed)
WHERE reminder_recurrence IS NOT NULL AND next_reminder_at IS NOT NULL AND completed = FALSE;

-- Subtasks indexes
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);

-- Contact list indexes
CREATE INDEX IF NOT EXISTS idx_contact_user ON contact_list(contact_list_id);

-- Lists indexes
CREATE INDEX IF NOT EXISTS idx_lists_user ON lists(list_id);

-- Conversation memory indexes
CREATE INDEX IF NOT EXISTS idx_conversation_user_time ON conversation_memory(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_created ON conversation_memory(created_at);

-- ============================================
-- STEP 4: Create helper functions
-- ============================================

-- Get or create user function
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

-- Cleanup old conversations
CREATE OR REPLACE FUNCTION cleanup_old_conversations()
RETURNS void AS $$
BEGIN
    DELETE FROM conversation_memory 
    WHERE created_at < NOW() - INTERVAL '7 days';
    
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

-- Auto-update task timestamp trigger
CREATE OR REPLACE FUNCTION update_task_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_task_timestamp_trigger ON tasks;
CREATE TRIGGER update_task_timestamp_trigger
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_task_timestamp();

-- ============================================
-- STEP 5: Verify setup
-- ============================================

-- Check tables
SELECT 
    'Tables' as type,
    table_name as name,
    'OK' as status
FROM information_schema.tables
WHERE table_name IN ('users', 'tasks', 'subtasks', 'contact_list', 'lists', 'conversation_memory')
    AND table_schema = 'public'
ORDER BY table_name;

-- Check functions
SELECT 
    'Functions' as type,
    routine_name as name,
    'OK' as status
FROM information_schema.routines
WHERE routine_name IN ('get_or_create_user', 'cleanup_old_conversations', 'update_task_timestamp')
    AND routine_schema = 'public';

-- Test get_or_create_user function
SELECT 
    'Test' as type,
    'get_or_create_user' as name,
    CASE 
        WHEN get_or_create_user('+1234567890') IS NOT NULL THEN 'OK'
        ELSE 'FAILED'
    END as status;

-- Final success message
SELECT '🎉 Setup Complete! All tables, indexes, and functions are ready.' as message;


