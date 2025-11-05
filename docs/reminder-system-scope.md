# Reminder System Feature Scope

## Overview

This feature adds an automatic reminder system for tasks in the WhatsApp AI Assistant's Database Agent architecture. The system enables:

1. **One-time reminders** - Reminders before task due dates
2. **Recurring reminders** - Standalone recurring reminders (daily, weekly, monthly)
3. **Daily digest** - Summary of today's tasks at 8:00 AM

## Feature Requirements

### 1. Database Schema Extension

#### New Columns for Tasks Table:

- **`reminder`** (INTERVAL, nullable)

  - Time interval before `due_date` to send reminder (e.g., "30 minutes", "1 hour")
  - Used for one-time reminders only
  - Default: 30 minutes before `due_date` if not specified

- **`reminder_recurrence`** (JSONB, nullable)

  - Recurrence pattern for recurring reminders
  - NULL = one-time reminder, has value = recurring reminder
  - Structure:
    ```json
    {
      "type": "daily" | "weekly" | "monthly",
      "time": "08:00",        // Time of day (HH:mm format)
      "days": [0, 3],         // For weekly: [0=Sunday, 1=Monday, ..., 6=Saturday]
      "dayOfMonth": 15,       // For monthly: 1-31
      "until": "2025-12-31",  // Optional end date (ISO date string)
      "timezone": "Asia/Jerusalem" // Optional timezone override
    }
    ```

- **`next_reminder_at`** (TIMESTAMP WITH TIME ZONE, nullable)
  - Cached next reminder time for recurring reminders
  - Calculated from `reminder_recurrence` pattern
  - Updated after each reminder is sent
  - NULL for one-time reminders

#### Important Constraints:

- A task **cannot** have both `due_date + reminder` AND `reminder_recurrence`
- One-time reminders: `due_date` + `reminder` (reminder_recurrence = NULL)
- Recurring reminders: `reminder_recurrence` (due_date = NULL, reminder = NULL)
- Completing a task does **not** stop recurring reminders - only deletion stops them

### 2. Task Creation & Update Logic

#### One-Time Reminders:

- **LLM Parsing**: "Remind me 1 hour before" or "תזכיר לי 30 דקות לפני"
- **Default Behavior**: If `dueDate` is set but `reminder` not specified, default to "30 minutes"
- **Storage**: Store as INTERVAL in `reminder` column

#### Recurring Reminders:

- **LLM Parsing**:
  - "Remind me every morning at 8am to take vitamins"
  - "Remind me every Sunday at 2pm to call mom"
  - "תזכיר לי כל יום ב-8:00 לקחת ויטמינים"
- **Storage**: Store JSONB in `reminder_recurrence`, calculate and store `next_reminder_at`

### 3. SQL Compiler Updates

- **Allowed Columns**: Add `reminder`, `reminder_recurrence` to `ALLOWED_COLUMNS.tasks`
- **WHERE Compilation**: Support filtering by reminder conditions
- **SET Compilation**: Support updating reminder fields in bulk operations
- **Query Building**: Include reminder fields in SELECT, INSERT, UPDATE operations

### 4. Service Layer Updates

#### TaskService:

- Handle `reminder` in create, update, getAll, getById
- Handle `reminder_recurrence` and `next_reminder_at` for recurring reminders
- Calculate default reminder when not specified (one-time only)
- Calculate `next_reminder_at` when creating/updating recurring reminders
- Validate: cannot have both due_date+reminder AND reminder_recurrence

#### TaskFunction:

- Add `reminder` parameter for one-time reminders
- Add `reminderRecurrence` parameter for recurring reminders
- Pass through to TaskService operations

### 5. Reminder Service (New)

Create `ReminderService.ts` with methods:

#### `sendUpcomingReminders()`

**Purpose**: Send WhatsApp reminders for both one-time and recurring reminders

**Logic**:

1. **One-time reminders** (existing tasks):

   ```sql
   SELECT * FROM tasks
   WHERE due_date IS NOT NULL
     AND reminder IS NOT NULL
     AND reminder_recurrence IS NULL
     AND completed = FALSE
     AND NOW() >= (due_date - reminder)
     AND (due_date - reminder) <= NOW() + INTERVAL '10 minutes'
   ```

2. **Recurring reminders**:

   ```sql
   SELECT * FROM tasks
   WHERE reminder_recurrence IS NOT NULL
     AND next_reminder_at IS NOT NULL
     AND completed = FALSE
     AND next_reminder_at <= NOW()
     AND next_reminder_at >= NOW() - INTERVAL '10 minutes'
   ```

3. For each recurring reminder sent:
   - Calculate next occurrence from `reminder_recurrence`
   - Update `next_reminder_at` with new calculated time
   - If `until` date reached, delete or deactivate the task

**Execution**: Run periodically (every 5-10 minutes)

#### `sendMorningDigest()`

**Purpose**: Send daily summary of today's tasks at 8:00 AM

**Logic**:

- Query all tasks where `due_date` is today (at user's timezone)
- **Exclude recurring reminders** (they have no due_date)
- Include both completed and incomplete tasks
- Group by category if applicable
- Send formatted WhatsApp message with task list

**Execution**: Run daily at 8:00 AM (user's timezone)

### 6. Scheduler Implementation

- **Technology**: Use `node-cron` for scheduling
- **Jobs**:
  1. **Reminder Check**: Every 5-10 minutes, call `sendUpcomingReminders()`
  2. **Morning Digest**: Daily at 8:00 AM, call `sendMorningDigest()`
- **Timezone Support**: Respect user's timezone from `users.timezone` field
- **Error Handling**: Log errors, continue execution

### 7. System Prompt Updates

#### Database Agent Prompt:

- Explain one-time vs recurring reminders
- Add examples in natural language (English and Hebrew)
- Examples:
  - One-time: "Remind me 1 hour before to buy groceries"
  - Recurring: "Remind me every morning at 8am to take vitamins"
  - Recurring weekly: "Remind me every Sunday at 2pm to call mom"

### 8. Display & List Separation

- **Regular Task List**: Show tasks with `due_date` (one-time tasks)
- **Recurring Reminders List**: Show tasks with `reminder_recurrence` (no due_date)
- Display format:
  - Tasks: "Buy groceries - Due: tomorrow at 6pm"
  - Recurring: "Take vitamins - Every day at 8:00 AM"

## Data Flow

### One-Time Reminder Creation:

1. User: "Remind me tomorrow at 6pm to buy groceries, remind me 1 hour before"
2. LLM parses: `{ text: "buy groceries", dueDate: "2025-01-30T18:00:00Z", reminder: "1 hour" }`
3. TaskService validates: no reminder_recurrence set
4. Task stored: `due_date`, `reminder = '1 hour'`, `reminder_recurrence = NULL`

### Recurring Reminder Creation:

1. User: "Remind me every morning at 8am to take vitamins"
2. LLM parses: `{ text: "take vitamins", reminderRecurrence: { type: "daily", time: "08:00" } }`
3. TaskService validates: no due_date or reminder set
4. TaskService calculates: `next_reminder_at = tomorrow 8am`
5. Task stored: `due_date = NULL`, `reminder = NULL`, `reminder_recurrence = {...}`, `next_reminder_at = ...`

### One-Time Reminder Execution:

1. Scheduler triggers `sendUpcomingReminders()` every 5 minutes
2. Query tasks where `NOW() >= (due_date - reminder)`
3. Send WhatsApp message
4. No update needed (one-time reminder)

### Recurring Reminder Execution:

1. Scheduler triggers `sendUpcomingReminders()` every 5 minutes
2. Query tasks where `NOW() >= next_reminder_at`
3. Send WhatsApp message
4. Calculate next occurrence: `next_reminder_at = calculateNextRecurrence(reminder_recurrence)`
5. Update task: `UPDATE tasks SET next_reminder_at = ... WHERE id = ...`

## Rendering Considerations

### One-Time Reminder Message Format:

```
🔔 Reminder
Task: [task text]
Due: [formatted due date/time]
[Category: [category name]]
```

### Recurring Reminder Message Format:

```
🔔 Reminder
[task text]
[Recurrence info: Every day at 8:00 AM]
```

### Daily Digest Format:

```
📋 Your Tasks for Today ([date])

📌 Incomplete:
- [task text] at [time]
- [task text] at [time]

✅ Completed:
- [task text]

Total: [X] incomplete, [Y] completed

Note: Recurring reminders are shown separately
```

## Edge Cases & Considerations

1. **Validation**: Cannot have both `due_date + reminder` AND `reminder_recurrence` - reject at creation/update
2. **No Due Date**: Tasks without `due_date` cannot have one-time reminders
3. **Past Due Dates**: Don't send reminders for tasks that are already overdue
4. **Completed Tasks**: Don't send reminders for completed tasks, BUT recurring reminders continue if task is completed (user must delete to stop)
5. **Multiple Users**: ReminderService must handle multiple users, each with their own timezone
6. **Timezone**: All time operations must respect user's timezone
7. **Missing Reminder**: If reminder was not set for one-time, use default 30 minutes before due_date
8. **Recurrence End Date**: When `until` date is reached, stop sending reminders (mark as inactive or delete)
9. **Recurrence Calculation**: Handle month-end edge cases (Feb 30th → Feb 28th/29th)
10. **List Display**: Separate recurring reminders list from regular tasks list

## Dependencies

- **node-cron**: For scheduling (to be added to package.json)
- **date-fns** or **luxon**: For timezone-aware date operations and recurrence calculation
- Existing: `pg`, `axios` (for WhatsApp API)

## Migration Strategy

1. Add `reminder` column with `NULL` default
2. Add `reminder_recurrence` JSONB column with `NULL` default
3. Add `next_reminder_at` TIMESTAMP column with `NULL` default
4. Run migration script on existing database
5. Deploy new code with backward compatibility
6. Existing tasks remain unchanged (all reminder fields = NULL)
