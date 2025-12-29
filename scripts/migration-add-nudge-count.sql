-- ============================================
-- MIGRATION: Add nudge_count Column to Tasks Table
-- ============================================
-- This migration adds nudge_count tracking to limit nudge reminders
-- Run this script on your existing database to add nudge counting
--
-- Date: 2025-12-11
-- Feature: Nudge reminder limit (15 nudges max, then auto-delete)
-- ============================================

-- Add nudge_count column to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS nudge_count INTEGER DEFAULT 0;

-- Add constraint to ensure nudge_count is non-negative (only if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'check_nudge_count_non_negative'
    ) THEN
        ALTER TABLE tasks
        ADD CONSTRAINT check_nudge_count_non_negative 
        CHECK (nudge_count >= 0);
    END IF;
END $$;

-- Add comment explaining the nudge_count column
COMMENT ON COLUMN tasks.nudge_count IS 'Number of times a nudge reminder has been sent. Used to limit nudge reminders (default limit: 15). Auto-deletes task when limit reached. Only relevant for nudge-type recurring reminders.';

-- Set default value for existing tasks (should already be 0 from DEFAULT, but ensure it)
UPDATE tasks 
SET nudge_count = 0 
WHERE nudge_count IS NULL;

-- Verify column was added
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'tasks' 
    AND column_name = 'nudge_count'
    AND table_schema = 'public';

-- Check existing nudge reminders
SELECT 
    COUNT(*) as total_nudge_tasks,
    MAX(nudge_count) as max_nudge_count,
    AVG(nudge_count) as avg_nudge_count
FROM tasks
WHERE reminder_recurrence IS NOT NULL
  AND reminder_recurrence::text LIKE '%"type":"nudge"%';

-- Success message
SELECT '✅ Migration complete! nudge_count column added to tasks table.' as status;

