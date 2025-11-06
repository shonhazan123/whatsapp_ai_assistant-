# Reminder System Implementation Plan

## Status: 🔄 IN PROGRESS

This document tracks the implementation progress of the reminder system feature with support for both one-time and recurring reminders. Each phase should be marked as complete with date and any notes.

---

## Phase 1: Database Migration & Schema Update

**Status**: ✅ Complete  
**Completed**: 2025-01-29  
**Objective**: Add reminder columns (one-time and recurring) to the tasks table and create migration scripts

### Files to Modify/Create:

1. `scripts/migration-add-reminder-columns.sql` (NEW) - Migration script
2. `scripts/COMPLETE-DATABASE-SETUP.sql` - Update schema definition
3. `scripts/CLEAN-DATABASE-SETUP.sql` - Update schema definition

### Expected Changes:

- Add `reminder` column: `INTERVAL` type, nullable (for one-time reminders)
- Add `reminder_recurrence` column: `JSONB` type, nullable (for recurring reminders)
- Add `next_reminder_at` column: `TIMESTAMP WITH TIME ZONE` type, nullable (cached next reminder time)
- Create indexes for efficient reminder queries
- Add comments explaining the reminder columns

### SQL Migration Example:

```sql
-- Add reminder columns
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS reminder INTERVAL,
ADD COLUMN IF NOT EXISTS reminder_recurrence JSONB,
ADD COLUMN IF NOT EXISTS next_reminder_at TIMESTAMP WITH TIME ZONE;

-- Index for one-time reminders
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(due_date, reminder, completed)
WHERE due_date IS NOT NULL AND reminder IS NOT NULL AND reminder_recurrence IS NULL AND completed = FALSE;

-- Index for recurring reminders
CREATE INDEX IF NOT EXISTS idx_tasks_recurring_reminder ON tasks(next_reminder_at, completed)
WHERE reminder_recurrence IS NOT NULL AND next_reminder_at IS NOT NULL AND completed = FALSE;

-- Comments
COMMENT ON COLUMN tasks.reminder IS 'Time interval before due_date to send reminder (e.g., ''30 minutes'', ''1 hour''). Used for one-time reminders only.';
COMMENT ON COLUMN tasks.reminder_recurrence IS 'Recurrence pattern for recurring reminders. JSONB format: {"type": "daily"|"weekly"|"monthly", "time": "HH:mm", "days": [0-6], "until": "ISO-date"}. NULL for one-time reminders.';
COMMENT ON COLUMN tasks.next_reminder_at IS 'Cached next reminder time for recurring reminders. Calculated from reminder_recurrence. Updated after each reminder is sent. NULL for one-time reminders.';
```

### Testing Checklist:

- [x] Migration script runs successfully on test database
- [x] Existing tasks have `NULL` for all reminder columns
- [ ] New tasks can be created with one-time reminder values (Phase 2)
- [ ] New tasks can be created with recurring reminder values (Phase 2)
- [ ] Validation prevents tasks with both due_date+reminder AND reminder_recurrence (Phase 2)
- [x] Indexes are created and improve query performance
- [ ] Rollback script works if needed

### Implementation Notes:

**Completed:**

- ✅ Created `scripts/migration-add-reminder-columns.sql` with:
  - `reminder` INTERVAL column (one-time reminders)
  - `reminder_recurrence` JSONB column (recurring reminders)
  - `next_reminder_at` TIMESTAMP column (cached next reminder time)
  - Two indexes: one for one-time, one for recurring reminders
  - Column comments explaining each field
  - Verification queries
- ✅ Updated `scripts/COMPLETE-DATABASE-SETUP.sql` with new columns and indexes
- ✅ Updated `scripts/CLEAN-DATABASE-SETUP.sql` with new columns and indexes
- ✅ Migration executed successfully on database

**Next Steps:**

- Proceed to Phase 2: Update SQLCompiler + TaskService + TaskFunction

---

## Phase 2: Update SQLCompiler + TaskService + TaskFunction

**Status**: ✅ Complete  
**Completed**: 2025-01-29  
**Objective**: Extend SQLCompiler, TaskService, and TaskFunction to support reminder fields (one-time and recurring)

### Files to Modify:

#### 2.1 SQLCompiler.ts

- **File**: `src/utils/SQLCompiler.ts`
- **Changes**:
  - Add `'reminder'`, `'reminder_recurrence'` to `ALLOWED_COLUMNS.tasks` array
  - Update `compileSet()` to handle reminder interval values and JSONB values
  - Ensure reminder fields are included in WHERE clause compilation when filtering

#### 2.2 TaskService.ts

- **File**: `src/services/database/TaskService.ts`
- **Changes**:

  - Add `reminder?: string` to `Task` interface
  - Add `reminderRecurrence?: ReminderRecurrence` to `Task` interface
  - Add `nextReminderAt?: string` to `Task` interface
  - Add `reminder?: string` to `CreateTaskRequest` interface
  - Add `reminderRecurrence?: ReminderRecurrence` to `CreateTaskRequest` interface
  - Add same fields to `UpdateTaskRequest` interface

  - Create `ReminderRecurrence` interface:

    ```typescript
    interface ReminderRecurrence {
    	type: "daily" | "weekly" | "monthly";
    	time: string; // "08:00"
    	days?: number[]; // For weekly: [0-6]
    	dayOfMonth?: number; // For monthly: 1-31
    	until?: string; // Optional ISO date
    	timezone?: string;
    }
    ```

  - Update `create()` method:

    - Validate: cannot have both `dueDate + reminder` AND `reminderRecurrence`
    - For one-time: if `dueDate` exists and `reminder` not specified, set default to "30 minutes"
    - For recurring: calculate `next_reminder_at` from `reminderRecurrence`
    - Include all reminder fields in INSERT statement
    - Return reminder fields in response

  - Update `createMultiple()` method:

    - Apply same validation and default logic for each task

  - Update `update()` method:

    - Allow updating reminder fields
    - Validate: cannot set both reminder types
    - Recalculate `next_reminder_at` if `reminderRecurrence` is updated

  - Update `getById()` method:

    - Include reminder fields in SELECT statement

  - Update `getAll()` method:

    - Include reminder fields in SELECT statement
    - Support filtering for recurring vs one-time reminders

  - Add helper methods:
    - `calculateDefaultReminder(dueDate: string): string` - Returns '30 minutes' interval string
    - `calculateNextReminderAt(recurrence: ReminderRecurrence, currentTime?: Date): string` - Calculates next reminder time
    - `validateReminderFields(data: any): void` - Validates reminder fields (throws if conflict)

#### 2.3 TaskFunction.ts

- **File**: `src/agents/functions/DatabaseFunctions.ts`
- **Changes**:
  - Add `reminder` parameter to `taskOperations` function schema:
    ```typescript
    reminder: {
      type: 'string',
      description: 'Reminder interval before due date (e.g., "30 minutes", "1 hour"). Defaults to 30 minutes if dueDate is set. Cannot be used with reminderRecurrence.'
    }
    ```
  - Add `reminderRecurrence` parameter:
    ```typescript
    reminderRecurrence: {
      type: 'object',
      description: 'Recurrence pattern for recurring reminders. Cannot be used with dueDate+reminder.',
      properties: {
        type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
        time: { type: 'string', description: 'Time of day in HH:mm format' },
        days: { type: 'array', items: { type: 'number' }, description: 'For weekly: array of day numbers [0-6]' },
        dayOfMonth: { type: 'number', description: 'For monthly: day of month 1-31' },
        until: { type: 'string', description: 'Optional end date in ISO format' },
        timezone: { type: 'string', description: 'Optional timezone override' }
      }
    }
    ```
  - Update `execute()` method to pass reminder fields to TaskService operations
  - Handle reminder fields in create, createMultiple, update cases

### Expected Functions/Methods:

- `TaskService.calculateDefaultReminder(dueDate: string): string`
- `TaskService.calculateNextReminderAt(recurrence: ReminderRecurrence, currentTime?: Date): string`
- `TaskService.validateReminderFields(data: any): void`

### Testing Checklist:

- [ ] Can create task with explicit one-time reminder: `{ text: "test", dueDate: "...", reminder: "1 hour" }`
- [ ] Can create task with recurring reminder: `{ text: "vitamins", reminderRecurrence: { type: "daily", time: "08:00" } }`
- [ ] Cannot create task with both reminder types (validation error)
- [ ] Can create task without reminder but with dueDate: defaults to "30 minutes"
- [ ] Can create task without dueDate and no reminder: all reminder fields null
- [ ] Can update reminder on existing task
- [ ] Can query tasks and reminder fields are included in response
- [ ] SQLCompiler allows reminder fields in SET clauses for updates
- [ ] TaskFunction accepts reminder parameters and passes to service
- [ ] Recurring reminder calculates correct next_reminder_at

### Implementation Notes:

**Completed:**

- ✅ Updated `SQLCompiler.ts`:
  - Added `'reminder'`, `'reminder_recurrence'`, `'next_reminder_at'` to ALLOWED_COLUMNS for tasks
  - Enhanced `compileSet()` to handle JSONB values (reminder_recurrence)
- ✅ Updated `TaskService.ts`:
  - Added `ReminderRecurrence` interface
  - Added reminder fields to `Task`, `CreateTaskRequest`, `UpdateTaskRequest` interfaces
  - Implemented `validateReminderFields()` - validates no conflicts between reminder types
  - Implemented `calculateDefaultReminder()` - returns '30 minutes' default
  - Implemented `calculateNextReminderAt()` - calculates next occurrence for daily/weekly/monthly patterns
  - Updated `create()` - handles both reminder types with validation and defaults
  - Updated `createMultiple()` - applies reminder logic to each task
  - Updated `update()` - handles reminder updates and recalculation
  - Updated `getById()` - includes reminder fields in SELECT and parses JSONB
  - Updated `getAll()` - includes reminder fields in SELECT and parses JSONB for all tasks
- ✅ Updated `TaskFunction.ts`:
  - Added `reminder` parameter to function schema
  - Added `reminderRecurrence` object parameter with full schema
  - Added reminder fields to `tasks` array items for createMultiple
  - Added reminder fields to `updates` array items for updateMultiple
  - Added logger import

**Next Steps:**

- Proceed to Phase 3: ReminderService Creation

---

## Phase 3: ReminderService Creation

**Status**: ✅ Complete (2025-01-29)  
**Objective**: Create ReminderService with methods to handle both one-time and recurring reminders

### Files to Create:

1. `src/services/reminder/ReminderService.ts` (NEW)

### Files to Modify:

1. `src/services/whatsapp.ts` - Ensure WhatsApp sending function is exported/accessible
2. `src/services/database/TaskService.ts` - Ensure it's accessible for queries

### Expected Class Structure:

```typescript
export class ReminderService {
	constructor(
		private taskService: TaskService,
		private db: DatabaseConnection,
		private logger: any = logger
	) {}

	/**
	 * Send reminders for tasks that are due soon (both one-time and recurring)
	 */
	async sendUpcomingReminders(): Promise<void>;

	/**
	 * Send daily digest of today's tasks at 8:00 AM
	 * Excludes recurring reminders (they have no due_date)
	 */
	async sendMorningDigest(): Promise<void>;

	/**
	 * Helper: Calculate next reminder time from recurrence pattern
	 */
	private calculateNextRecurrence(
		recurrence: ReminderRecurrence,
		currentTime: Date
	): Date;

	/**
	 * Helper: Get all users with timezone info
	 */
	private async getAllUsers(): Promise<User[]>;

	/**
	 * Helper: Format one-time reminder message
	 */
	private formatReminderMessage(task: Task): string;

	/**
	 * Helper: Format recurring reminder message
	 */
	private formatRecurringReminderMessage(task: Task): string;

	/**
	 * Helper: Format daily digest message
	 */
	private formatDailyDigest(tasks: Task[], user: User): string;

	/**
	 * Helper: Check if recurrence has ended (until date reached)
	 */
	private hasRecurrenceEnded(recurrence: ReminderRecurrence): boolean;
}
```

### Database Queries Needed:

1. **One-Time Reminders**:

```sql
SELECT t.*, u.phone, u.timezone
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE t.due_date IS NOT NULL
  AND t.reminder IS NOT NULL
  AND t.reminder_recurrence IS NULL
  AND t.completed = FALSE
  AND NOW() >= (t.due_date - t.reminder)
  AND (t.due_date - t.reminder) <= NOW() + INTERVAL '10 minutes'
```

2. **Recurring Reminders**:

```sql
SELECT t.*, u.phone, u.timezone
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE t.reminder_recurrence IS NOT NULL
  AND t.next_reminder_at IS NOT NULL
  AND t.completed = FALSE
  AND t.next_reminder_at <= NOW()
  AND t.next_reminder_at >= NOW() - INTERVAL '10 minutes'
```

3. **After sending recurring reminder, update next_reminder_at**:

```sql
UPDATE tasks
SET next_reminder_at = $1
WHERE id = $2
```

4. **Daily Digest (only tasks with due_date, exclude recurring)**:

```sql
SELECT t.*, u.phone, u.timezone
FROM tasks t
JOIN users u ON t.user_id = u.id
WHERE DATE(t.due_date AT TIME ZONE u.timezone) = CURRENT_DATE
  AND t.due_date IS NOT NULL
  AND t.reminder_recurrence IS NULL
ORDER BY t.due_date, t.category
```

### Testing Checklist:

- [ ] `sendUpcomingReminders()` queries one-time reminders correctly
- [ ] `sendUpcomingReminders()` queries recurring reminders correctly
- [ ] Recurring reminders calculate next_reminder_at correctly after sending
- [ ] Reminder messages are sent via WhatsApp (both types)
- [ ] Recurring reminders stop when `until` date is reached
- [ ] `sendMorningDigest()` excludes recurring reminders
- [ ] `sendMorningDigest()` queries tasks for current date in user timezone
- [ ] Digest messages are formatted correctly
- [ ] Multiple users are handled correctly
- [ ] Timezone conversion works properly
- [ ] Error handling for failed WhatsApp sends
- [ ] Month-end edge cases handled (e.g., Feb 30 → Feb 28/29)

---

## Phase 4: Scheduler Setup

**Status**: ✅ Complete (2025-01-29)  
**Objective**: Set up cron jobs to run reminder checks periodically and daily digest at 8:00 AM

### Files to Create:

1. `src/services/scheduler/SchedulerService.ts` (NEW)

### Files to Modify:

1. `package.json` - Add `node-cron` dependency
2. `src/index-v2.ts` or `src/index.ts` - Initialize scheduler on app startup
3. `src/services/reminder/ReminderService.ts` - Ensure it's importable

### Expected Scheduler Implementation:

```typescript
import cron from "node-cron";
import { ReminderService } from "../reminder/ReminderService";

export class SchedulerService {
	private reminderService: ReminderService;

	start(): void {
		// Run every 5 minutes
		cron.schedule("*/5 * * * *", async () => {
			await this.reminderService.sendUpcomingReminders();
		});

		// Run daily at 8:00 AM (handle multiple timezones)
		// Run at multiple UTC times to cover different timezones
		cron.schedule("0 6 * * *", async () => {
			await this.reminderService.sendMorningDigest();
		});
		cron.schedule("0 7 * * *", async () => {
			await this.reminderService.sendMorningDigest();
		});
		cron.schedule("0 8 * * *", async () => {
			await this.reminderService.sendMorningDigest();
		});
		cron.schedule("0 9 * * *", async () => {
			await this.reminderService.sendMorningDigest();
		});
	}
}
```

### Timezone Considerations:

- Run daily digest cron at multiple times (6-9 AM UTC) and filter by user timezone in query
- ReminderService's sendMorningDigest() checks user timezone and only sends if it's 8 AM in their timezone

### Testing Checklist:

- [ ] Scheduler initializes on app startup
- [ ] Reminder check runs every 5 minutes (test with shorter interval first)
- [ ] Daily digest runs at correct time(s) for different timezones
- [ ] Multiple timezones are handled correctly
- [ ] Scheduler continues running even if one execution fails
- [ ] Logs show scheduler execution times
- [ ] Can manually trigger scheduler methods for testing

---

## Phase 5: Update System Prompts and LLM Parsing Logic

**Status**: ✅ Complete (2025-01-29)  
**Objective**: Update system prompts so LLM understands both one-time and recurring reminder parameters

### Files to Modify:

1. `src/config/system-prompts.ts` - Update `getDatabaseAgentPrompt()`

### Expected Changes:

- Add reminder parameter documentation to TASK OPERATIONS section
- Add recurring reminder parameter documentation
- Add examples showing reminder usage in natural language (English and Hebrew)
- Explain default behavior (30 minutes before if not specified)
- Explain validation rules (cannot have both types)
- Add reminder to parameter extraction examples

### Example Prompt Addition:

```typescript
## TASK CREATION RULES:

### One-Time Reminders:
- Use with tasks that have a `dueDate`
- Parameter: `reminder` (string, e.g., "30 minutes", "1 hour", "2 days")
- If user specifies "remind me X before" or "תזכיר לי X לפני", extract X as reminder
- If user specifies dueDate but no reminder, omit reminder (will default to 30 minutes)
- Format: "30 minutes", "1 hour", "2 days", "1 week"

### Recurring Reminders:
- Use for standalone recurring reminders (no dueDate)
- Parameter: `reminderRecurrence` (object)
- Cannot be used together with dueDate + reminder
- Examples:
  * "Remind me every morning at 8am" → `{ type: "daily", time: "08:00" }`
  * "Remind me every Sunday at 2pm" → `{ type: "weekly", days: [0], time: "14:00" }`
  * "Remind me every day at 9am until end of year" → `{ type: "daily", time: "09:00", until: "2025-12-31" }`

### Validation:
- Cannot create task with both dueDate+reminder AND reminderRecurrence
- One-time: requires dueDate
- Recurring: cannot have dueDate or reminder

### Multiple tasks:
- Use 'createMultiple' with tasks array (each can have reminder or reminderRecurrence)
```

### Examples to Add:

1. One-time: "Remind me tomorrow at 6pm to buy groceries, remind me 1 hour before"
   → `{ text: "buy groceries", dueDate: "...", reminder: "1 hour" }`

2. Recurring daily: "Remind me every morning at 8am to take vitamins"
   → `{ text: "take vitamins", reminderRecurrence: { type: "daily", time: "08:00" } }`

3. Recurring weekly: "תזכיר לי כל יום ראשון ב-14:00 להתקשר לאמא"
   → `{ text: "להתקשר לאמא", reminderRecurrence: { type: "weekly", days: [0], time: "14:00" } }`

4. Default: "Create a task to call John tomorrow at 5pm"
   → `{ text: "call John", dueDate: "..." }` (reminder defaults to 30 minutes)

### Testing Checklist:

- [ ] LLM extracts one-time reminder from natural language requests
- [ ] LLM extracts recurring reminder from natural language requests
- [ ] LLM correctly omits reminder when not mentioned (relies on default)
- [ ] LLM rejects attempts to create task with both reminder types
- [ ] Examples in both English and Hebrew work
- [ ] Reminder parsing handles various formats ("1 hour", "60 minutes", "2 hours before")
- [ ] Recurring reminder parsing handles daily, weekly, monthly formats
- [ ] LLM includes reminder in createMultiple operations when specified
- [ ] Update operations can modify reminder fields

---

## Phase 6: Integration Testing & Documentation

**Status**: ⏳ Pending  
**Objective**: Test end-to-end functionality and document the feature

### Files to Create:

1. `docs/reminder-system-usage.md` (User-facing documentation) - Optional
2. Update `README.md` if needed

### Testing Scenarios:

1. **Create task with one-time reminder**:

   - User: "Remind me tomorrow at 6pm to buy groceries, remind me 1 hour before"
   - Expected: Task created, reminder set to "1 hour", reminder_recurrence = NULL

2. **Create recurring reminder**:

   - User: "Remind me every morning at 8am to take vitamins"
   - Expected: Task created, reminder_recurrence set, next_reminder_at calculated

3. **Create task without reminder**:

   - User: "Task: call John tomorrow at 5pm"
   - Expected: Task created, reminder defaults to "30 minutes"

4. **Receive one-time reminder**:

   - Create task with due_date 10 minutes from now, reminder 5 minutes
   - Wait 6 minutes
   - Expected: WhatsApp message received

5. **Receive recurring reminder**:

   - Create daily reminder for current time + 2 minutes
   - Wait 3 minutes
   - Expected: WhatsApp message received, next_reminder_at updated to tomorrow

6. **Recurring reminder continues after completion**:

   - Create daily reminder, mark task as completed
   - Wait for next reminder time
   - Expected: Reminder still sent (completion doesn't stop recurrence)

7. **Recurring reminder stops when deleted**:

   - Create daily reminder, delete task
   - Wait for next reminder time
   - Expected: No reminder sent

8. **Receive daily digest**:

   - Create multiple tasks for today
   - Create recurring reminder
   - Wait until 8:00 AM
   - Expected: WhatsApp message with task list (excluding recurring reminders)

9. **Update reminder**:

   - User: "Update the grocery task reminder to 2 hours before"
   - Expected: Reminder updated successfully

10. **Validation error**:

- User: Creates task with both dueDate+reminder AND reminderRecurrence
- Expected: Error message explaining conflict

11. **Timezone handling**:

- User in different timezone receives digest at 8 AM their time

12. **Month-end edge case**:

- Create monthly reminder on Jan 31, check Feb 28/29 handling

### Testing Checklist:

- [ ] All test scenarios pass
- [ ] Error cases handled gracefully (e.g., WhatsApp API failure)
- [ ] No duplicate reminders sent
- [ ] Completed tasks don't receive one-time reminders
- [ ] Completed tasks still receive recurring reminders (until deleted)
- [ ] Tasks without due dates don't cause errors
- [ ] Recurring reminders continue correctly
- [ ] Recurring reminders stop when until date reached
- [ ] Performance is acceptable (scheduler doesn't block main app)
- [ ] Logs are informative for debugging
- [ ] List display separates recurring from regular tasks

---

## Progress Tracking

### Completed Phases:

- ✅ Phase 1: Database Migration & Schema Update (2025-01-29)
- ✅ Phase 2: Update SQLCompiler + TaskService + TaskFunction (2025-01-29)
- ✅ Phase 3: ReminderService Creation (2025-01-29)
- ✅ Phase 4: Scheduler Setup (2025-01-29)

### Current Phase:

- Phase 6: Integration Testing & Documentation

### Notes:

- **2025-01-29**: Updated design to support recurring reminders (Option 2)
- **Decisions Made**:
  - Completing a task does NOT stop recurring reminders (only deletion stops them)
  - Tasks cannot have both due_date+reminder AND reminder_recurrence
  - Recurring reminders display separately from regular tasks
  - Recurring reminders continue until user deletes the task
- Update status emoji: ⏳ Pending, 🔄 In Progress, ✅ Complete, ❌ Blocked

---

## Dependencies Added:

- `node-cron`: For scheduling cron jobs
- Optional: `luxon` or enhanced `date-fns` usage for timezone handling and recurrence calculation

## Environment Variables:

No new environment variables required (uses existing WhatsApp API credentials and database connection)
