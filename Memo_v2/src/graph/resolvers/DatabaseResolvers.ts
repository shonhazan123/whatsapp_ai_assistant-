/**
 * Database Resolvers
 * 
 * Converts database-related PlanSteps into task/list operation arguments.
 * 
 * Each resolver uses its OWN LLM call with domain-specific prompts to:
 * 1. Determine the specific operation (create, update, delete, etc.)
 * 2. Extract all required fields from the user's natural language
 * 
 * Based on V1: src/agents/functions/DatabaseFunctions.ts
 *              src/config/system-prompts.ts (getDatabaseAgentPrompt)
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// DATABASE TASK RESOLVER
// ============================================================================

/**
 * DatabaseTaskResolver - Reminder/Task CRUD operations
 * 
 * Uses LLM to determine operation and extract fields from natural language.
 */
export class DatabaseTaskResolver extends LLMResolver {
  readonly name = 'database_task_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'task_operation',  // Generic - LLM will determine specific operation
    'create_task',
    'get_task',
    'list_tasks',
    'update_task',
    'delete_task',
    'complete_task',
    'create_multiple_tasks',
    'add_subtask',
    'update_multiple_tasks',
    'update_all_tasks',
    'delete_multiple_tasks',
    'delete_all_tasks',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A DATABASE-INTEGRATED AGENT FOR REMINDER AND TASK MANAGEMENT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into structured JSON for the taskOperations function.
You handle REMINDERS and to-do items - NOT calendar events.

## ⚠️ CRITICAL RULES ⚠️

### NUDGE vs DAILY - KEY RULE
**"כל X דקות/שעות" or "every X minutes/hours" → type: "nudge" + interval field**
**"כל יום ב-X" or "every day at X" → type: "daily" + time field**

### OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to CREATE something new → "create" or "createMultiple"
- User wants to SEE/LIST items → "getAll"
- User wants to FIND specific item → "get"
- User asks "מה יש לי"/"what do I have" → "getAll"
- User says "סיימתי"/"done"/"עשיתי" → "delete" (completion = deletion for reminders)
- User wants to UPDATE/CHANGE → "update"
- User wants to DELETE/REMOVE/CANCEL → "delete" or "deleteAll"
- Multiple items mentioned → use "createMultiple" or "deleteMultiple"

## CONTEXT EXTRACTION RULES

### CRITICAL: Always Extract Task Context from Enhanced Message and Recent Conversation

The user message you receive may be enhanced with context:
- The message may start with "[Replying to: ...]" indicating the user is replying to a previous message
- Recent conversation history is provided below the user message

**When user says completion words without task name** ("סיימתי", "done", "עשיתי", "כן"):
1. Check if message starts with "[Replying to: ...]" - extract task name from the replied-to content
2. Check recent conversation for assistant messages mentioning tasks
3. Look for task lists, reminders, or task mentions in recent messages
4. Extract the task text and populate the "text" field

**Examples of context extraction**:
- User message contains: "[Replying to: \"תזכורת: לבדוק את הפיצ'ר\"]" followed by "סיימתי"
  → Extract: { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

- Recent conversation shows assistant said: "יש לך 2 משימות: 1. לקנות חלב 2. לנקות הבית"
  User message: "סיימתי את שתיהן"
  → Extract: { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

- User message contains: "[Replying to: \"האם התכוונת למשימה...\"]" followed by "כן"
  → Extract task name from the replied-to message and use: { "operation": "delete", "text": "extracted task name" }

**If no context found**: Still populate "text" field with empty string or best guess, let EntityResolver handle disambiguation.

## AVAILABLE OPERATIONS:
- **create**: Create a single task/reminder
- **createMultiple**: Create multiple tasks at once (use when user mentions multiple items)
- **get**: Get a specific task by text
- **getAll**: List all tasks with optional filters
- **update**: Update task properties or add reminder
- **updateMultiple**: Update multiple tasks at once (use "updates" array with "text" to identify each task)
- **updateAll**: Update all tasks matching a filter (use for bulk changes like "move all overdue to tomorrow")
- **delete**: Delete a single task
- **deleteMultiple**: Delete multiple specific tasks (use "tasks" array with "text" to identify each)
- **deleteAll**: Delete all tasks matching a filter (with optional "where" filter)
- **complete**: Mark task as complete (same as delete for reminders)

## OUTPUT FORMAT:
{
  "operation": "create",
  "text": "Task description",
  "category": "optional category",
  "dueDate": "ISO datetime if specified",
  "reminder": "0 minutes | 30 minutes | 1 hour | 2 days",
  "reminderRecurrence": { 
    "type": "daily | weekly | monthly | nudge",
    "time": "HH:mm",
    "days": [0-6],
    "interval": "5 minutes"
  }
}

## REMINDER DETECTION RULES (CHECK IN THIS ORDER):

### 1. Explicit time specified → reminder: "0 minutes"
Pattern: "תזכיר לי [date] בשעה [time]" / "remind me at [time]"
Meaning: Fire the reminder AT that exact time
Examples:
- "תזכיר לי היום בשעה 20:10 לעבור לאחותי" → { dueDate: "...20:10...", reminder: "0 minutes" }
- "Remind me tomorrow at 6pm to buy groceries" → { dueDate: "...18:00...", reminder: "0 minutes" }

### 2. "X before" specified → reminder: exact interval
Pattern: "תזכיר לי X לפני" / "remind me X before"
Examples:
- "remind me 30 minutes before" → { reminder: "30 minutes" }
- "תזכיר לי שעה לפני" → { reminder: "1 hour" }

### 3. Date only, no time → dueDate 08:00 AM, reminder: "0 minutes"
Pattern: "תזכיר לי מחר" / "remind me tomorrow" (no time mentioned)
Examples:
- "תזכיר לי מחר לקנות חלב" → { dueDate: "...T08:00:00...", reminder: "0 minutes" }

### 4. "In X minutes/hours" (relative from now) → dueDate = current time + X, reminder: "0 minutes"
Pattern: "תזכיר לי עוד X דקות/שעות" / "remind me in X minutes/hours"
Meaning: Fire the reminder at (now + X). You MUST output dueDate as ISO with timezone (use [Current time] from context and add the interval).
Examples:
- "תזכירי לי עוד חמש דקות לעשות בדיקה" → { dueDate: "<now+5min ISO>", text: "לעשות בדיקה", reminder: "0 minutes" }
- "Remind me in 30 minutes to call John" → { dueDate: "<now+30min ISO>", text: "to call John", reminder: "0 minutes" }
- "תזכיר לי בעוד שעה לשלוח מייל" → { dueDate: "<now+1hour ISO>", text: "לשלוח מייל", reminder: "0 minutes" }

## DATE INFERENCE RULES (CRITICAL - READ CAREFULLY):

### Time without date → ALWAYS assume TODAY
When user specifies only a time (e.g., "בשמונה", "בשבע וארבעים", "at 8pm") WITHOUT explicitly mentioning a date:
- **ALWAYS assume TODAY**, never tomorrow
- The user will say "מחר" (tomorrow) or a specific date if they mean a different day
- This applies even if the time seems ambiguous

### Time ambiguity resolution (morning vs evening):
- For times like "בשמונה" (at 8) or "בשבע" (at 7) without AM/PM:
  - If current time is afternoon/evening (after 12:00) → assume EVENING (PM) for hours 1-11
  - If current time is morning (before 12:00) → assume the nearest upcoming occurrence
  - "בערב" (evening) or "בבוקר" (morning) makes it explicit
- Times 13:00+ (1pm+) are unambiguous (24-hour format)

### Examples of correct date inference:
- Current time: 17:22 → "בשבע וארבעים" = TODAY at 19:47 (7:47 PM)
- Current time: 17:22 → "בשמונה וחצי" = TODAY at 20:30 (8:30 PM)
- Current time: 09:00 → "בשמונה" = TODAY at 08:00 if not passed, else 20:00
- Current time: 14:00 → "בחמש" = TODAY at 17:00 (5:00 PM)

### NEVER default to tomorrow unless:
- User explicitly says "מחר" (tomorrow)
- User specifies a specific date like "ביום שני" (on Monday)
- User says "מחר בבוקר" (tomorrow morning)

### WEEKDAY NAME → EXACT DATE (CRITICAL — USE [Current time] EVERY TIME):
The user message includes **"[Current time: Weekday, YYYY-MM-DD HH:mm, Timezone: ...]"**. When the user says a **weekday name** (e.g. ביום רביעי, יום רביעי הזה, on Wednesday, this Wednesday):
1. **Today** = the YYYY-MM-DD in that line; today's weekday is the Weekday shown.
2. The user means the **next** occurrence of that weekday (on or after today).
3. **Compute that date**: e.g. today Monday 2026-03-16 → Wednesday = 2026-03-18 (add days until weekday matches). Weekday order: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6 (Israeli week).
4. Output **dueDate** as that computed date + the user's time (ISO with timezone). **Do NOT** use tomorrow's date unless the user said מחר/tomorrow.

Hebrew weekday names: ראשון=Sunday, שני=Monday, שלישי=Tuesday, רביעי=Wednesday, חמישי=Thursday, שישי=Friday, שבת=Saturday.

### "THIS [weekday]" vs "NEXT [weekday]" (Hebrew: ביום X vs יום X הבא):
- **"This Wednesday" / "ביום רביעי" / "ביום רביעי הזה"** = the **next** Wednesday from today (this week if still ahead, or next week). Use [Current time] to compute the date.
- **"Next Monday" / "יום שני הבא"** = the Monday of **next week** (the Monday after this one). If today is Monday, "next Monday" = 7 days from today. If today is Tuesday, "next Monday" = 6 days from today. Never use "this Monday" for "next Monday".
- **"This Monday"** = the Monday of the **current** week. If today is Wednesday, "this Monday" is in the past; if user says "this Monday" in that case, use the **coming** Monday (same as "next Monday"). When in doubt: "this [day]" = next occurrence of that day; "next [day]" / "X הבא" = that day in the **following** week.

### "X WEEKS FROM NOW" + WEEKDAY (e.g. "Sunday two weeks from now"):
- **"Sunday two weeks from now"** = find the Sunday that falls in the week that is **2 weeks from today**. If today is Wednesday: "this Sunday" = the coming Sunday (1 week away); "Sunday two weeks from now" = the Sunday **after** that (2 weeks away).
- Rule: "**[weekday] N weeks from now**" = start from today, move forward N full weeks (7*N days), then take the **Sunday** (or the named weekday) of that target week. For "two weeks from now" + Sunday: target date = today + 14 days, then go to the Sunday of that week (or if "Sunday two weeks from now" = the Sunday that is 2 weeks out from today's weekday perspective: e.g. today Wed → next Sun = +4 days, "Sunday in 2 weeks" = next Sun + 7 = +11 days).
- Simpler rule: "Sunday in two weeks" = the second upcoming Sunday from today. "Monday in three weeks" = the third upcoming Monday from today. Count forward by 7 days for each "week".

## ⚠️ ONE-TIME vs RECURRING — CRITICAL DECISION RULE ⚠️

**Use reminderRecurrence ONLY when the user uses explicit recurrence words:**
- Hebrew: כל (every), כל יום, כל בוקר, כל ערב, כל שבוע, כל יום ראשון, מדי יום, באופן קבוע, קבוע
- English: every, daily, weekly, monthly, recurring

**If the user names a single day/date/time WITHOUT "every"/"כל", it is ONE-TIME:**
- Use dueDate + reminder ONLY
- Do NOT include reminderRecurrence
- Examples of ONE-TIME wording: "ביום ראשון בשמונה", "מחר בבוקר", "on Sunday at 8", "tomorrow morning", "בבוקר ביום ראשון בשעה שמונה"

**Key distinction:**
- "תזכירי לי ביום ראשון בשמונה בבוקר" → ONE-TIME (no "כל") → dueDate only
- "תזכירי לי כל יום ראשון בשמונה בבוקר" → RECURRING weekly (has "כל") → reminderRecurrence only

## RECURRING REMINDERS (reminderRecurrence):

### Daily: "כל יום ב-X" / "every day at X"
{ "type": "daily", "time": "08:00" }

### Weekly: "כל יום ראשון ב-X" / "every Sunday at X"  
{ "type": "weekly", "days": [0], "time": "14:00" }
Note: days array = [0=Sunday, 1=Monday, ..., 6=Saturday]

### Monthly: "בכל 10 לחודש" / "every 10th of the month"
{ "type": "monthly", "dayOfMonth": 10, "time": "09:00" }

### NUDGE: "כל X דקות/שעות" / "every X minutes/hours"
{ "type": "nudge", "interval": "10 minutes" }
Detection patterns (Hebrew): "נדנד אותי", "תציק לי", "תחפור לי", "כל X דקות"
Detection patterns (English): "nudge me", "keep reminding", "every X minutes"
Default: 10 minutes if not specified

## VALIDATION RULES:
- ❌ Cannot use dueDate+reminder AND reminderRecurrence together (EXCEPT for nudge)
- ✅ NUDGE CAN have dueDate (nudge starts from that time)
- ❌ Daily/weekly/monthly reminders cannot have dueDate
- ✅ Tasks without dueDate MUST NOT include reminder parameter

## EXAMPLES:

Example 1 - One-time reminder with explicit time:
User: "תזכיר לי היום בשעה 20:10 לעבור לאחותי"
Current time: Thursday, 02/01/2025 14:00
→ { "operation": "create", "text": "לעבור לאחותי", "dueDate": "2025-01-02T20:10:00+02:00", "reminder": "0 minutes" }

Example 2 - Multiple tasks at SAME time:
User: "תזכיר לי היום בשמונה לנתק חשמל ולשלוח מייל"
→ {
  "operation": "createMultiple",
  "tasks": [
    { "text": "לנתק חשמל", "dueDate": "2025-01-02T20:00:00+02:00", "reminder": "0 minutes" },
    { "text": "לשלוח מייל", "dueDate": "2025-01-02T20:00:00+02:00", "reminder": "0 minutes" }
  ]
}

Example 3 - Nudge reminder:
User: "תזכיר לי בשמונה בערב ותציק לי על זה כל עשר דקות"
→ {
  "operation": "create",
  "text": "...",
  "dueDate": "2025-01-02T20:00:00+02:00",
  "reminderRecurrence": { "type": "nudge", "interval": "10 minutes" }
}

Example 4 - "In X minutes" (relative from now):
User: "תזכירי לי עוד חמש דקות לעשות בדיקה"
Current time: Thursday, 02/01/2025 14:00 (2025-01-02T14:00:00+02:00)
→ { "operation": "create", "text": "לעשות בדיקה", "dueDate": "2025-01-02T14:05:00+02:00", "reminder": "0 minutes" }

Example 5 - Daily recurring (note "כל בוקר" = every morning):
User: "תזכיר לי כל בוקר ב-9 לעשות ספורט"
→ { "operation": "create", "text": "לעשות ספורט", "reminderRecurrence": { "type": "daily", "time": "09:00" } }

Example 6 - Weekly recurring (note "כל יום ראשון" = every Sunday):
User: "תזכיר לי כל יום ראשון ב-14:00 להתקשר לאמא"
→ { "operation": "create", "text": "להתקשר לאמא", "reminderRecurrence": { "type": "weekly", "days": [0], "time": "14:00" } }

Example 6x - ⚠️ ONE-TIME on a weekday (NO "כל" = single occurrence, NOT recurring):
User: "תזכירי לי בבוקר ביום ראשון בשעה שמונה לדבר עם אורל"
Current time: Thursday, 02/19/2026 08:46
→ { "operation": "create", "text": "לדבר עם אורל", "dueDate": "2026-02-22T08:00:00+02:00", "reminder": "0 minutes" }
Note: "ביום ראשון" (on Sunday) WITHOUT "כל" = this coming Sunday only. "בבוקר...בשעה שמונה" = 08:00. No reminderRecurrence!

Example 6x2 - ⚠️ ONE-TIME "ביום רביעי" = WEDNESDAY (not tomorrow!):
User: "תזכירי ביום רביעי בשעה 13:00 פגישה בשיימלס"
Current time: Monday, 2026-03-16 14:58, Timezone: Asia/Jerusalem
→ { "operation": "create", "text": "פגישה בשיימלס", "dueDate": "2026-03-18T13:00:00+02:00", "reminder": "0 minutes" }
Note: Today is Monday 2026-03-16. "ביום רביעי" = Wednesday = next Wednesday = 2026-03-18. Do NOT use 2026-03-17 (tomorrow/Tuesday).

Example 6x3 - "Next Monday" (יום שני הבא) = the Monday of NEXT week:
User: "תזכיר לי ביום שני הבא בשעה 9 להתקשר לרופא"
Current time: Wednesday, 2026-03-18 10:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "text": "להתקשר לרופא", "dueDate": "2026-03-23T09:00:00+02:00", "reminder": "0 minutes" }
Note: Today Wednesday 2026-03-18. "יום שני הבא" = next week's Monday = 2026-03-23 (not this week's Monday 2026-03-16 which is in the past).

Example 6x4 - "Sunday two weeks from now":
User: "Remind me Sunday two weeks from now at 10am to submit the report"
Current time: Wednesday, 2026-03-18 14:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "text": "submit the report", "dueDate": "2026-03-29T10:00:00+02:00", "reminder": "0 minutes" }
Note: Today Wed 2026-03-18. Next Sunday = 2026-03-22 (1 week). Sunday two weeks from now = 2026-03-29 (2nd upcoming Sunday).

Example 6y - ⚠️ ONE-TIME "tomorrow morning" (NOT daily):
User: "תזכירי לי מחר בבוקר בשמונה להתקשר לרופא"
Current time: Thursday, 02/19/2026 20:00
→ { "operation": "create", "text": "להתקשר לרופא", "dueDate": "2026-02-20T08:00:00+02:00", "reminder": "0 minutes" }
Note: "מחר בבוקר" = tomorrow morning. No "כל" → one-time only. No reminderRecurrence!

Example 5a - Time only WITHOUT date (MUST be TODAY):
User: "תזכיר לי בשבע וארבעים למשוך כסף"
Current time: Monday, 02/02/2025 17:22
→ { "operation": "create", "text": "למשוך כסף", "dueDate": "2025-02-02T19:47:00+02:00", "reminder": "0 minutes" }
Note: No date mentioned → assume TODAY. Time is 19:47 (evening, since current time is afternoon)

Example 5b - Multiple reminders with time only (all TODAY):
User: "תזכיר לי בשבע וארבעים למשוך כסף ובשמונה וחצי להתקין את הממיר"
Current time: Monday, 02/02/2025 17:22
→ {
  "operation": "createMultiple",
  "tasks": [
    { "text": "למשוך כסף", "dueDate": "2025-02-02T19:47:00+02:00", "reminder": "0 minutes" },
    { "text": "להתקין את הממיר", "dueDate": "2025-02-02T20:30:00+02:00", "reminder": "0 minutes" }
  ]
}
Note: Both times are TODAY evening - NEVER assume tomorrow when date not specified

Example 6a - Complete/delete a task (with task name in message):
User: "סיימתי לבדוק את הפיצ'ר"
→ { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

Example 6b - Complete/delete a task (extracting from reply context):
User message: "[Replying to: \"תזכורת: לבדוק את הפיצ'ר\"]\n\nסיימתי"
→ { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

Example 6c - Complete multiple tasks (extracting from recent conversation):
Recent conversation: assistant: "יש לך 2 משימות: 1. לקנות חלב 2. לנקות הבית"
User: "סיימתי את שתיהן"
→ { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

Example 6d - Confirm disambiguation (extracting from reply context):
User message: "[Replying to: \"האם התכוונת למשימה \\\"לבדוק אם אלי דלתות מגיע ולפנות את החדר עבודה (one-time)\"? (כן/לא)\"]\n\nכן"
→ { "operation": "delete", "text": "לבדוק אם אלי דלתות מגיע ולפנות את החדר עבודה" }

Example 7 - List tasks for today:
User: "מה התזכורות שלי להיום?"
→ { "operation": "getAll", "filters": { "window": "today" } }

Example 7a - List tasks for tomorrow:
User: "מה יש לי מחר?"
→ { "operation": "getAll", "filters": { "window": "tomorrow" } }

Example 7b - List recurring reminders:
User: "מה התזכורות החוזרות שלי?"
→ { "operation": "getAll", "filters": { "type": "recurring" } }

Example 7c - List tasks without dates:
User: "מה המשימות שלי ללא תאריך?"
→ { "operation": "getAll", "filters": { "type": "unplanned" } }

Example 7d - List overdue tasks:
User: "מה עבר את הזמן?"
→ { "operation": "getAll", "filters": { "window": "overdue" } }

Example 7e - List all tasks (no filter):
User: "מה המשימות שלי?"
→ { "operation": "getAll" }

Example 8 - Delete all overdue:
User: "תמחק את כל המשימות שזמנם עבר"
→ { "operation": "deleteAll", "where": { "window": "overdue" }, "preview": false }

Example 9 - Update task:
User: "תשנה את התזכורת לקנות חלב ל-10 בבוקר"
→ { "operation": "update", "text": "לקנות חלב", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } }

Example 10 - Simple reminder without time:
User: "תזכיר לי לקנות מתנה"
→ { "operation": "create", "text": "לקנות מתנה" }

Example 11 - Update multiple tasks:
User: "תשנה את שתי המשימות האלה: לקנות חלב ולנקות הבית ל-10 בבוקר"
→ {
  "operation": "updateMultiple",
  "updates": [
    { "text": "לקנות חלב", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } },
    { "text": "לנקות הבית", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } }
  ]
}

Example 12 - Delete multiple specific tasks:
User: "תמחק את המשימה לקנות חלב ואת המשימה לנקות הבית"
→ { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

Example 13 - Delete all tasks (no filter):
User: "תמחק את כל המשימות שלי"
→ { "operation": "deleteAll", "where": {}, "preview": false }

Example 14 - Update all overdue tasks:
User: "תזיז את כל המשימות שעברו לשעה 10 מחר"
→ { "operation": "updateAll", "where": { "window": "overdue" }, "patch": { "dueDate": "2025-01-03T10:00:00+02:00" } }

Example 15 - Delete all overdue tasks:
User: "תמחק את כל המשימות שעברו"
→ { "operation": "deleteAll", "where": { "window": "overdue" }, "preview": false }

Example 16 - Update all unplanned tasks (no date) to tomorrow morning:
User: "תעדכן את המשימות הלא מתוכננות למחר בבוקר"
→ { "operation": "updateAll", "where": { "type": "unplanned" }, "patch": { "dueDate": "2025-01-03T08:00:00+02:00" } }

Example 17 - Delete all recurring reminders:
User: "תמחק את כל התזכורות החוזרות"
→ { "operation": "deleteAll", "where": { "type": "recurring" }, "preview": false }

Example 18 - Update all overdue tasks to tomorrow:
User: "תזיז את כל המשימות שעברו למחר"
→ { "operation": "updateAll", "where": { "window": "overdue" }, "patch": { "dueDate": "2025-01-03T08:00:00+02:00" } }

## LANGUAGE RULE:
Output only the JSON, no explanation. NEVER include IDs you don't have.`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'taskOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'updateAll',
                   'delete', 'deleteMultiple', 'deleteAll', 'complete', 'addSubtask'],
          },
          taskId: { type: 'string', description: 'Task ID (only if known from prior lookup)' },
          text: { type: 'string', description: 'Task text/description' },
          category: { type: 'string', description: 'Task category' },
          dueDate: { type: 'string', description: 'Due date/time (ISO format)' },
          reminder: { 
            type: 'string', 
            description: 'Reminder interval before dueDate: "0 minutes", "30 minutes", "1 hour", "2 days"' 
          },
          reminderRecurrence: {
            type: 'object',
            description: 'Recurring reminder settings',
            properties: {
              type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
              time: { type: 'string', description: 'HH:mm format for daily/weekly/monthly' },
              interval: { type: 'string', description: 'Interval for nudge: "5 minutes", "1 hour"' },
              days: { type: 'array', items: { type: 'number' }, description: 'Days for weekly: [0-6]' },
              dayOfMonth: { type: 'number', description: 'Day of month for monthly: 1-31' },
              until: { type: 'string', description: 'End date for recurrence (ISO)' },
            },
          },
          reminderDetails: {
            type: 'object',
            description: 'For updates: new reminder settings to apply',
            properties: {
              dueDate: { type: 'string' },
              reminder: { type: 'string' },
              reminderRecurrence: { type: 'object' },
            },
          },
          filters: {
            type: 'object',
            description: 'Filters for getAll - use to narrow down results by time window or type',
            properties: {
              completed: { type: 'boolean' },
              category: { type: 'string' },
              window: { 
                type: 'string', 
                enum: ['today', 'tomorrow', 'this_week', 'overdue', 'upcoming'],
                description: 'Time window: today, tomorrow, this_week, overdue, upcoming'
              },
              type: {
                type: 'string',
                enum: ['recurring', 'unplanned', 'reminder'],
                description: 'Task type: recurring (has recurrence), unplanned (no date), reminder (has due date)'
              },
            },
          },
          tasks: {
            type: 'array',
            description: 'Array of tasks for createMultiple OR deleteMultiple. For deleteMultiple, each object must have "text" to identify the task.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Task text - used to identify for delete, or content for create' },
                category: { type: 'string' },
                dueDate: { type: 'string' },
                reminder: { type: 'string' },
                reminderRecurrence: { type: 'object' },
              },
            },
          },
          updates: {
            type: 'array',
            description: 'Array of updates for updateMultiple. Each object must have "text" to identify the task and "reminderDetails" with new values.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Task text to identify which task to update' },
                reminderDetails: { type: 'object', description: 'New values: { dueDate, reminder, reminderRecurrence }' },
              },
            },
          },
          where: {
            type: 'object',
            description: 'Filter for deleteAll/updateAll bulk operations',
            properties: {
              window: { 
                type: 'string', 
                enum: ['today', 'this_week', 'overdue', 'upcoming', 'all'],
                description: 'Time window filter: today, this_week, overdue, upcoming, all' 
              },
              type: {
                type: 'string',
                enum: ['recurring', 'unplanned', 'reminder'],
                description: 'Task type filter: recurring (has recurrence), unplanned (no date), reminder (has due date)'
              },
              reminderRecurrence: { type: 'string' },
            },
          },
          patch: {
            type: 'object',
            description: 'Fields to update for updateAll bulk operation',
            properties: {
              dueDate: { type: 'string', description: 'New due date (ISO format)' },
              category: { type: 'string' },
              completed: { type: 'boolean' },
              reminder: { type: 'string' },
              reminderRecurrence: { type: 'object' },
            },
          },
          preview: { type: 'boolean', description: 'Always false - no confirmation needed' },
          subtaskText: { type: 'string', description: 'Subtask text for addSubtask' },
        },
        required: ['operation'],
      },
    };
  }
  
  // ── Keyword hint arrays for pre-LLM operation analysis ──────────────────

  private static readonly RECURRING_KEYWORDS: Array<{ pattern: RegExp; weight: number; label: string }> = [
    // Hebrew - "every" prefix is the strongest recurring signal
    { pattern: /כל\s*יום/i, weight: 3, label: 'כל יום' },
    { pattern: /כל\s*בוקר/i, weight: 3, label: 'כל בוקר' },
    { pattern: /כל\s*ערב/i, weight: 3, label: 'כל ערב' },
    { pattern: /כל\s*שבוע/i, weight: 3, label: 'כל שבוע' },
    { pattern: /כל\s*חודש/i, weight: 3, label: 'כל חודש' },
    { pattern: /כל\s*יום\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/i, weight: 3, label: 'כל יום [weekday]' },
    { pattern: /באופן\s*קבוע/i, weight: 2, label: 'באופן קבוע' },
    { pattern: /קבוע/i, weight: 1.5, label: 'קבוע' },
    { pattern: /חוזר(ת)?/i, weight: 2, label: 'חוזר/ת' },
    { pattern: /מדי\s*(יום|שבוע|חודש|בוקר|ערב)/i, weight: 2.5, label: 'מדי [period]' },
    { pattern: /בכל\s*\d+\s*לחודש/i, weight: 3, label: 'בכל X לחודש' },
    // English
    { pattern: /every\s*(day|morning|evening|week|month)/i, weight: 3, label: 'every [period]' },
    { pattern: /every\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i, weight: 3, label: 'every [weekday]' },
    { pattern: /\b(daily|weekly|monthly)\b/i, weight: 2.5, label: 'daily/weekly/monthly' },
    { pattern: /\brecurring\b/i, weight: 2, label: 'recurring' },
  ];

  private static readonly NUDGE_KEYWORDS: Array<{ pattern: RegExp; weight: number; label: string }> = [
    // Hebrew - nudge-specific verbs
    { pattern: /תציק(י)?/i, weight: 3, label: 'תציק/י' },
    { pattern: /נדנד(י)?/i, weight: 3, label: 'נדנד/י' },
    { pattern: /נודניק/i, weight: 3, label: 'נודניק' },
    { pattern: /תחפור(י)?/i, weight: 2.5, label: 'תחפור/י' },
    // Short-interval recurrence (< 1 day) = nudge
    { pattern: /כל\s*\d+\s*דקות/i, weight: 3, label: 'כל X דקות' },
    { pattern: /כל\s*\d+\s*שעות/i, weight: 2.5, label: 'כל X שעות' },
    { pattern: /כל\s*(חצי\s*שעה|רבע\s*שעה)/i, weight: 3, label: 'כל חצי/רבע שעה' },
    // English
    { pattern: /\bnudge\b/i, weight: 3, label: 'nudge' },
    { pattern: /keep\s*remind/i, weight: 2.5, label: 'keep reminding' },
    { pattern: /\bpester\b/i, weight: 2, label: 'pester' },
    { pattern: /\bnag\b/i, weight: 2, label: 'nag' },
    { pattern: /every\s*\d+\s*minutes?/i, weight: 3, label: 'every X minutes' },
    { pattern: /every\s*\d+\s*hours?/i, weight: 2.5, label: 'every X hours' },
  ];

  private static readonly ONE_TIME_KEYWORDS: Array<{ pattern: RegExp; weight: number; label: string }> = [
    // Hebrew - specific single-occurrence time references
    { pattern: /מחר\b/i, weight: 2, label: 'מחר' },
    { pattern: /היום\b/i, weight: 2, label: 'היום' },
    { pattern: /בעוד\s*\d+/i, weight: 2.5, label: 'בעוד X' },
    { pattern: /עוד\s*\d+\s*(דקות|שעות)/i, weight: 2.5, label: 'עוד X דקות/שעות' },
    { pattern: /בשעה\b/i, weight: 1.5, label: 'בשעה' },
    // "ביום ראשון" WITHOUT preceding "כל" = one specific day
    { pattern: /(?<!כל\s)ביום\s*(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)/i, weight: 2, label: 'ביום [weekday] (single)' },
    { pattern: /בבוקר\b/i, weight: 1, label: 'בבוקר (time-of-day)' },
    { pattern: /בערב\b/i, weight: 1, label: 'בערב (time-of-day)' },
    { pattern: /מחר\s*בבוקר/i, weight: 2.5, label: 'מחר בבוקר' },
    { pattern: /מחר\s*בערב/i, weight: 2.5, label: 'מחר בערב' },
    // English
    { pattern: /\btomorrow\b/i, weight: 2, label: 'tomorrow' },
    { pattern: /\btoday\b/i, weight: 2, label: 'today' },
    { pattern: /\bat\s+\d/i, weight: 1.5, label: 'at [time]' },
    { pattern: /\bin\s+\d+\s*(minutes?|hours?)/i, weight: 2.5, label: 'in X minutes/hours' },
    { pattern: /(?<!every\s)\bon\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i, weight: 2, label: 'on [weekday] (single)' },
    { pattern: /\bthis\s*(morning|evening|afternoon)/i, weight: 2, label: 'this morning/evening' },
    { pattern: /\bnext\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i, weight: 2, label: 'next [weekday]' },
  ];

  private static readonly CRUD_KEYWORDS: Array<{ pattern: RegExp; weight: number; label: string; operation: string }> = [
    // Create
    { pattern: /תזכיר(י)?/i, weight: 2, label: 'תזכיר/י', operation: 'create' },
    { pattern: /תזכורת/i, weight: 1.5, label: 'תזכורת', operation: 'create' },
    { pattern: /\bremind\b/i, weight: 2, label: 'remind', operation: 'create' },
    { pattern: /תוסיפ(י)?/i, weight: 2, label: 'תוסיפ/י', operation: 'create' },
    { pattern: /\b(create|add)\b/i, weight: 2, label: 'create/add', operation: 'create' },
    // Delete / complete
    { pattern: /מחק(י)?/i, weight: 2, label: 'מחק/י', operation: 'delete' },
    { pattern: /בטל(י)?/i, weight: 2, label: 'בטל/י', operation: 'delete' },
    { pattern: /הסר(י)?/i, weight: 2, label: 'הסר/י', operation: 'delete' },
    { pattern: /סיימתי/i, weight: 2, label: 'סיימתי', operation: 'delete' },
    { pattern: /עשיתי/i, weight: 2, label: 'עשיתי', operation: 'delete' },
    { pattern: /בוצע/i, weight: 2, label: 'בוצע', operation: 'delete' },
    { pattern: /\b(delete|remove|cancel|done|complete)\b/i, weight: 2, label: 'delete/done', operation: 'delete' },
    // List
    { pattern: /מה יש לי/i, weight: 2, label: 'מה יש לי', operation: 'getAll' },
    { pattern: /מה התזכורות/i, weight: 2, label: 'מה התזכורות', operation: 'getAll' },
    { pattern: /הראה|הראי/i, weight: 1.5, label: 'הראה/י', operation: 'getAll' },
    { pattern: /\b(show|list|what.*remind)/i, weight: 2, label: 'show/list', operation: 'getAll' },
    // Update
    { pattern: /שנ(ה|י)|עדכנ(י)?/i, weight: 2, label: 'שנה/עדכן', operation: 'update' },
    { pattern: /הזז(י)?/i, weight: 2, label: 'הזז/י', operation: 'update' },
    { pattern: /\b(update|change|move|modify|reschedule)\b/i, weight: 2, label: 'update/change', operation: 'update' },
  ];

  /**
   * Analyze message keywords and return scored operation hints.
   * Returns { reminderType, crudHint, matchDetails } for LLM guidance.
   */
  private analyzeOperationHints(message: string): {
    reminderType: { type: string; score: number; matched: string[] }[];
    crudHint: { operation: string; score: number; matched: string[] } | null;
  } {
    const scoreGroup = (
      keywords: Array<{ pattern: RegExp; weight: number; label: string }>,
    ): { score: number; matched: string[] } => {
      let score = 0;
      const matched: string[] = [];
      for (const kw of keywords) {
        if (kw.pattern.test(message)) {
          score += kw.weight;
          matched.push(kw.label);
        }
      }
      return { score, matched };
    };

    const recurring = scoreGroup(DatabaseTaskResolver.RECURRING_KEYWORDS);
    const nudge = scoreGroup(DatabaseTaskResolver.NUDGE_KEYWORDS);
    const oneTime = scoreGroup(DatabaseTaskResolver.ONE_TIME_KEYWORDS);

    const reminderType: { type: string; score: number; matched: string[] }[] = [];
    if (recurring.score > 0) reminderType.push({ type: 'recurring', ...recurring });
    if (nudge.score > 0) reminderType.push({ type: 'nudge', ...nudge });
    if (oneTime.score > 0) reminderType.push({ type: 'one_time', ...oneTime });
    reminderType.sort((a, b) => b.score - a.score);

    // CRUD hint
    const crudScores = new Map<string, { score: number; matched: string[] }>();
    for (const kw of DatabaseTaskResolver.CRUD_KEYWORDS) {
      if (kw.pattern.test(message)) {
        const existing = crudScores.get(kw.operation) || { score: 0, matched: [] };
        existing.score += kw.weight;
        existing.matched.push(kw.label);
        crudScores.set(kw.operation, existing);
      }
    }
    let crudHint: { operation: string; score: number; matched: string[] } | null = null;
    for (const [op, data] of crudScores) {
      if (!crudHint || data.score > crudHint.score) {
        crudHint = { operation: op, ...data };
      }
    }

    return { reminderType, crudHint };
  }

  /**
   * Format operation hints into a readable section for the LLM user message.
   */
  private formatOperationHints(hints: ReturnType<DatabaseTaskResolver['analyzeOperationHints']>): string {
    const lines: string[] = [];
    lines.push('## Pre-Analysis Hints (keyword-based, use as recommendation only)');

    if (hints.reminderType.length > 0) {
      lines.push('Reminder type signals detected:');
      for (const rt of hints.reminderType) {
        lines.push(`- **${rt.type}**: score=${rt.score.toFixed(1)}, matched: "${rt.matched.join('", "')}"`);
      }
      const top = hints.reminderType[0];
      if (top.type === 'one_time' && top.score > 0) {
        lines.push('→ Strongest signal is ONE-TIME. Use dueDate+reminder only. Do NOT add reminderRecurrence unless you are certain the user wants a recurring reminder (look for "כל"/"every").');
      } else if (top.type === 'recurring') {
        lines.push('→ Strongest signal is RECURRING. Use reminderRecurrence (daily/weekly/monthly). Do NOT include dueDate+reminder.');
      } else if (top.type === 'nudge') {
        lines.push('→ Strongest signal is NUDGE. Use reminderRecurrence with type "nudge". dueDate is allowed with nudge only.');
      }
    } else {
      lines.push('No strong reminder-type signals detected.');
    }

    if (hints.crudHint) {
      lines.push(`CRUD signal: **${hints.crudHint.operation}** (score=${hints.crudHint.score.toFixed(1)}, matched: "${hints.crudHint.matched.join('", "')}")`);
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Override buildUserMessage to inject keyword-based operation hints
   */
  protected override buildUserMessage(step: PlanStep, state: MemoState): string {
    const message = state.input.enhancedMessage || state.input.message;
    const timeContext = state.now.formatted;

    let userMessage = `${timeContext}\n\n`;

    // Inject pre-analysis hints
    const hints = this.analyzeOperationHints(message);
    const hasHints = hints.reminderType.length > 0 || hints.crudHint !== null;
    if (hasHints) {
      userMessage += this.formatOperationHints(hints);
      console.log(
        `[${this.name}] Operation hints: reminder=${hints.reminderType.map(r => `${r.type}(${r.score})`).join(',')}` +
        (hints.crudHint ? `, crud=${hints.crudHint.operation}(${hints.crudHint.score})` : ''),
      );
    }

    // Include user's clarification response from canonical hitlResults
    const clarification = this.findClarificationResult(state);
    if (clarification) {
      userMessage += `## User Clarification\n`;
      userMessage += `The user was asked for more information and responded: "${clarification}"\n`;
      userMessage += `This clarification applies to the original request below. Extract all relevant info from BOTH messages.\n\n`;
    }

    if (state.recentMessages.length > 0) {
      userMessage += `Recent conversation:\n`;
      const recent = state.recentMessages.slice(-3);
      for (const msg of recent) {
        userMessage += `${msg.role}: ${msg.content.substring(0, 100)}...\n`;
      }
      userMessage += '\n';
    }

    userMessage += `User wants to: ${step.action}\n`;
    if (Object.keys(step.constraints).length > 0) {
      userMessage += `Constraints: ${JSON.stringify(step.constraints)}\n`;
    }
    if (Object.keys(step.changes).length > 0) {
      userMessage += `Changes: ${JSON.stringify(step.changes)}\n`;
    }

    userMessage += `\nUser message: ${message}`;

    return userMessage;
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Always use LLM to extract operation and fields from natural language
    try {
      console.log(`[${this.name}] Calling LLM to extract task operation from: "${step.constraints.rawMessage?.substring(0, 50)}..."`);
      
      const args = await this.callLLM(step, state);
      
      // Validate that we got an operation (required for TaskServiceAdapter)
      if (!args.operation) {
        const listActions = ['list tasks', 'list_tasks', 'list reminders', 'list_reminders'];
        const action = (step.action || '').toLowerCase().replace(/\s+/g, '_');
        if (listActions.includes(step.action || '') || listActions.includes(action)) {
          args.operation = 'getAll';
          console.log(`[${this.name}] No operation from LLM; step action "${step.action}" → operation getAll`);
        } else {
          console.warn(`[${this.name}] LLM did not return operation, defaulting to 'getAll'`);
          args.operation = 'getAll';
        }
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      // Normalize reminderRecurrence if present
      if (args.reminderRecurrence) {
        args.reminderRecurrence = this.normalizeReminderRecurrence(args.reminderRecurrence);
      }
      
      // Normalize tasks array if present
      if (args.tasks && Array.isArray(args.tasks)) {
        args.tasks = args.tasks.map((task: any) => {
          if (task.reminderRecurrence) {
            task.reminderRecurrence = this.normalizeReminderRecurrence(task.reminderRecurrence);
          }
          return task;
        });
      }
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          ...args,
          _entityType: 'task',  // Explicit entity type for downstream routing
        },
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback: try to infer basic operation from raw message
      return this.createFallbackArgs(step, state);
    }
  }
  
  /**
   * Fallback when LLM fails - basic inference from keywords
   */
  private createFallbackArgs(step: PlanStep, state: MemoState): ResolverOutput {
    const message = step.constraints.rawMessage || state.input.message || '';
    const lowerMessage = message.toLowerCase();
    
    let operation = 'getAll';
    
    // Basic keyword detection
    if (/מחק|בטל|הסר|delete|remove|cancel/i.test(message)) {
      operation = 'delete';
    } else if (/סיימתי|עשיתי|בוצע|done|complete|finish/i.test(message)) {
      operation = 'delete'; // Completion = deletion for reminders
    } else if (/מה יש|מה התזכורות|מה יש בתזכורות|הראה|show|list|what.*remind/i.test(message)) {
      operation = 'getAll';
    } else if (/תזכיר|תזכורת|remind|create|add/i.test(message)) {
      operation = 'create';
    } else if (/שנה|עדכן|update|change|move/i.test(message)) {
      operation = 'update';
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args: {
        operation,
        text: message,
        _fallback: true,
        _entityType: 'task',  // Explicit entity type for downstream routing
      },
    };
  }
  
  /**
   * Normalize reminder recurrence to consistent format
   */
  private normalizeReminderRecurrence(recurrence: any): any {
    if (!recurrence) return undefined;
    
    const normalized: any = { type: recurrence.type };
    
    switch (recurrence.type) {
      case 'daily':
        normalized.time = recurrence.time || '08:00';
        break;
      case 'weekly':
        normalized.days = this.normalizeDaysArray(recurrence.days) || [0];
        normalized.time = recurrence.time || '08:00';
        break;
      case 'monthly':
        normalized.dayOfMonth = recurrence.dayOfMonth || 1;
        normalized.time = recurrence.time || '09:00';
        break;
      case 'nudge':
        normalized.interval = recurrence.interval || '10 minutes';
        break;
    }
    
    if (recurrence.until) normalized.until = recurrence.until;
    
    return normalized;
  }

  /** Ensure days is always a numeric array [0-6] regardless of LLM output format. */
  private normalizeDaysArray(days: any): number[] | null {
    if (!days) return null;

    const dayNameMap: Record<string, number> = {
      sunday: 0, sun: 0, ראשון: 0,
      monday: 1, mon: 1, שני: 1,
      tuesday: 2, tue: 2, שלישי: 2,
      wednesday: 3, wed: 3, רביעי: 3,
      thursday: 4, thu: 4, חמישי: 4,
      friday: 5, fri: 5, שישי: 5,
      saturday: 6, sat: 6, שבת: 6,
    };

    const toNum = (v: any): number | null => {
      if (typeof v === 'number' && v >= 0 && v <= 6) return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 0 && n <= 6) return n;
        const mapped = dayNameMap[v.toLowerCase().trim()];
        if (mapped !== undefined) return mapped;
      }
      return null;
    };

    if (Array.isArray(days)) {
      const result = days.map(toNum).filter((n): n is number => n !== null);
      return result.length > 0 ? result : null;
    }

    if (typeof days === 'string') {
      const parts = days.split(/[,;\s]+/).filter(Boolean);
      const result = parts.map(toNum).filter((n): n is number => n !== null);
      return result.length > 0 ? result : null;
    }

    const single = toNum(days);
    return single !== null ? [single] : null;
  }
  
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'database';
  }
}

// ============================================================================
// DATABASE LIST RESOLVER
// ============================================================================

/**
 * DatabaseListResolver - List CRUD operations
 * 
 * Uses LLM to determine operation and extract fields.
 * 
 * CRITICAL RULE: ONLY use listOperations when user explicitly says "list" (EN) or "רשימה" (HE)
 */
export class DatabaseListResolver extends LLMResolver {
  readonly name = 'database_list_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'list_operation',  // Generic - LLM will determine specific operation
    'create_list',
    'get_list',
    'list_lists',
    'update_list',
    'delete_list',
    'add_item',
    'toggle_item',
    'delete_item',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A LIST MANAGEMENT AGENT.

## CRITICAL RULE - LIST KEYWORD DETECTION:
ONLY use listOperations when user EXPLICITLY says "list" (English) or "רשימה" (Hebrew).

## OPERATION SELECTION
Analyze the user's intent:
- User wants to CREATE a new list → "create"
- User wants to SEE all lists → "getAll"
- User wants to ADD item to existing list → "addItem"
- User wants to MARK item as done → "toggleItem"
- User wants to DELETE list → "delete"
- User wants to DELETE item from list → "deleteItem"

Examples that SHOULD create lists:
- "create a list for groceries" → "create"
- "תיצור רשימה חדשה" → "create"
- "תוסיף לרשימה את הפריט" → "addItem"
- "make a list and add..." → "create"

Examples that should NOT be handled by this resolver:
- "אני רוצה ללמוד את הדברים הבאים: 1. ... 2. ..." → Route to TaskResolver
- "things to do: item1, item2" → Route to TaskResolver
- Any enumeration WITHOUT the word "list"/"רשימה" → Route to TaskResolver

## AVAILABLE OPERATIONS:
- **create**: Create a new list with optional items
- **get**: Get a specific list by name
- **getAll**: List all user's lists
- **update**: Update list name or items
- **delete**: Delete a list
- **addItem**: Add item to existing list
- **toggleItem**: Toggle item completed status
- **deleteItem**: Remove item from list

## OUTPUT FORMAT for create:
{
  "operation": "create",
  "name": "List name",
  "items": ["item 1", "item 2"],
  "isChecklist": true
}

## OUTPUT FORMAT for addItem:
{
  "operation": "addItem",
  "listName": "list name to find",
  "item": "new item text"
}

## NO CONFIRMATION FOR DELETIONS:
All delete operations execute immediately without confirmation.

## EXAMPLES:

Example 1 - Create shopping list:
User: "תיצור רשימה לקניות: חלב, לחם, ביצים"
→ { "operation": "create", "name": "קניות", "items": ["חלב", "לחם", "ביצים"], "isChecklist": true }

Example 2 - Add to existing list:
User: "תוסיף לרשימת הקניות חמאה"
→ { "operation": "addItem", "listName": "קניות", "item": "חמאה" }

Example 3 - Delete list:
User: "תמחק את רשימת הקניות"
→ { "operation": "delete", "listName": "קניות" }

Example 4 - Get all lists:
User: "אילו רשימות יש לי?"
→ { "operation": "getAll" }

Example 5 - Toggle item:
User: "סמן את החלב ברשימת הקניות כקנוי"
→ { "operation": "toggleItem", "listName": "קניות", "itemIndex": 0 }

Example 6 - Create list with items:
User: "create a list called 'movies to watch' with Inception, Matrix, and Interstellar"
→ { "operation": "create", "name": "movies to watch", "items": ["Inception", "Matrix", "Interstellar"], "isChecklist": true }

Output only the JSON, no explanation.`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'listOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'get', 'getAll', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem'],
          },
          listId: { type: 'string', description: 'List ID (only if known)' },
          listName: { type: 'string', description: 'List name for lookup' },
          name: { type: 'string', description: 'List name (for create/update)' },
          items: { type: 'array', items: { type: 'string' }, description: 'List items' },
          item: { type: 'string', description: 'Single item text' },
          itemIndex: { type: 'number', description: 'Item index for toggle/delete' },
          isChecklist: { type: 'boolean', description: 'Whether list has checkboxes (default: true)' },
          selectedIndex: { type: 'number', description: 'For disambiguation selection' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Check if this should actually be a list operation
    const message = step.constraints.rawMessage || state.input.message || '';
    
    // If no explicit list keyword, this might be routed incorrectly
    if (!/list|רשימה/i.test(message)) {
      console.log(`[${this.name}] Message doesn't contain 'list'/'רשימה', might be wrong resolver`);
    }
    
    // Use LLM to extract operation and fields
    try {
      console.log(`[${this.name}] Calling LLM to extract list operation`);
      
      const args = await this.callLLM(step, state);
      
      // Validate operation
      if (!args.operation) {
        args.operation = 'getAll';
      }
      
      // Default isChecklist to true
      if (args.operation === 'create' && args.isChecklist === undefined) {
        args.isChecklist = true;
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          ...args,
          _entityType: 'list',  // Explicit entity type for downstream routing
        },
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'getAll',
          _fallback: true,
          _entityType: 'list',  // Explicit entity type for downstream routing
        },
      };
    }
  }
  
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'database';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createDatabaseTaskResolver() {
  const resolver = new DatabaseTaskResolver();
  return resolver.asNodeFunction();
}

export function createDatabaseListResolver() {
  const resolver = new DatabaseListResolver();
  return resolver.asNodeFunction();
}
