-- ============================================
-- MIGRATION: Add Reminder Columns to Tasks Table
-- ============================================
-- This migration adds reminder support (one-time and recurring) to the tasks table
-- Run this script on your existing database to add reminder functionality
--
-- Date: 2025-01-29
-- Feature: Reminder System (with recurring support)
-- ============================================

-- Add reminder columns to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS reminder INTERVAL,
ADD COLUMN IF NOT EXISTS reminder_recurrence JSONB,
ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMP WITH TIME ZONE;

-- Index for one-time reminders (due_date + reminder)
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(due_date, reminder, completed)
WHERE due_date IS NOT NULL 
  AND reminder IS NOT NULL 
  AND reminder_recurrence IS NULL 
  AND completed = FALSE;

-- Index for recurring reminders (next_reminder_at)
CREATE INDEX IF NOT EXISTS idx_tasks_recurring_reminder ON tasks(next_reminder_at, completed)
WHERE reminder_recurrence IS NOT NULL 
  AND next_reminder_at IS NOT NULL 
  AND completed = FALSE;

-- Add comments explaining the reminder columns
COMMENT ON COLUMN tasks.reminder IS 'Time interval before due_date to send reminder (e.g., ''30 minutes'', ''1 hour'', ''2 days''). Used for one-time reminders only. NULL if no reminder or if recurring reminder is set.';
COMMENT ON COLUMN tasks.reminder_recurrence IS 'Recurrence pattern for recurring reminders. JSONB format: {"type": "daily"|"weekly"|"monthly", "time": "HH:mm", "days": [0-6] (for weekly), "dayOfMonth": 1-31 (for monthly), "until": "ISO-date" (optional), "timezone": "timezone" (optional)}. NULL for one-time reminders.';
COMMENT ON COLUMN tasks.next_reminder_at IS 'Cached next reminder time for recurring reminders. Calculated from reminder_recurrence pattern. Updated after each reminder is sent. NULL for one-time reminders.';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify columns were added
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'tasks' 
    AND column_name IN ('reminder', 'reminder_recurrence', 'next_reminder_at')
    AND table_schema = 'public'
ORDER BY column_name;

-- Verify indexes were created
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'tasks' 
    AND indexname IN ('idx_tasks_reminder', 'idx_tasks_recurring_reminder')
    AND schemaname = 'public'
ORDER BY indexname;

-- Check existing tasks (should have NULL for all reminder columns)
SELECT 
    COUNT(*) as total_tasks,
    COUNT(reminder) as tasks_with_reminder,
    COUNT(reminder_recurrence) as tasks_with_recurrence,
    COUNT(next_reminder_at) as tasks_with_next_reminder
FROM tasks;

-- Success message
SELECT '✅ Migration complete! Reminder columns added to tasks table.' as status;

