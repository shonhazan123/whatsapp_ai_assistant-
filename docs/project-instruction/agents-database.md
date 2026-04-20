## Database Agent (`taskOperations`, `listOperations`, `contactOperations`)

> **Memo_v2 runtime**: `database` steps go to **`DatabaseTaskResolver`** / **`DatabaseListResolver`** (`Memo_v2/src/graph/resolvers/DatabaseResolvers.ts`), then **`DatabaseEntityResolver`** when IDs are required, then **`TaskServiceAdapter`** / **`ListServiceAdapter`**. The behavioral rules below still apply.

### High-Level Role

The database agent owns **structured, non-calendar data**:

- Tasks and reminders.
- Recurring reminder patterns.
- Lists and checklist items.

It talks to `TaskService`, `ListService`, `UserDataService`, and `OnboardingService` through `DatabaseFunctions`.

**Not database**: Changing the **morning brief / daily digest send time** (scheduled WhatsApp summary) is **account settings** on the website — the planner routes that to **`general`**, not `database`.

**CRITICAL**: NO confirmations needed for ANY deletions (tasks, lists, items) - delete immediately.

---

### What the Database Agent CAN Do

#### Tasks & Reminders (`taskOperations`)

- Create, update, delete **tasks / reminders** - **NO confirmation needed**
- Attach:
  - One-time due dates (`dueDate`).
  - Recurring reminder patterns (`reminderRecurrence`).
- Bulk operations:
  - `createMultiple` - Create multiple tasks at once.
  - `deleteMultiple` - Delete specific tasks by text (e.g. "delete task A and task B").
  - `deleteAll` - Delete all tasks matching filter (overdue/today/all) - **No confirmation**.
  - `updateMultiple` - Update specific tasks (e.g. "change both tasks to 10am").
  - `updateAll` - Update all tasks matching filter (e.g. "move all overdue to tomorrow").
- Fetch and filter:
  - `getAll` with filters (category, completion state, date windows).
  - "Overdue", "upcoming", "completed", "work only", etc.

#### Lists (`listOperations`)

- Create/delete named lists - **NO confirmation needed**
  - Checklists (with items, each with completion state).
  - Non-checklist notes (e.g., "Reminders" list).
- Manage items:
  - Add/update/delete items in a list - **NO confirmation needed**
  - Mark checklist items complete/incomplete.

---

### What the Database Agent CANNOT / MUST NOT Do

- **No calendar events** – scheduling in Google Calendar is strictly calendar agent.
- **No Gmail operations** – cannot send emails or modify mailbox state.
- **No vector/semantic memory** – unstructured long-term thoughts/notes go to second-brain.
- **No guessing IDs or sensitive data** – must not invent IDs, emails, or phone numbers.
- **No direct WhatsApp I/O** – it returns structured responses; the WhatsApp service formats messages.

---

### Operations & Execution Flow

#### Execution Path (Memo_v2)

1. **PlannerNode** emits a `PlanStep` with `capability: 'database'` and an action hint (e.g. `list_tasks`, `create_list`).
2. **ResolverRouterNode** selects **`DatabaseTaskResolver`** or **`DatabaseListResolver`** via `ResolverSchema` / `selectResolver()`.
3. The resolver LLM returns semantic args → **`resolverResults`**.
4. **EntityResolutionNode** resolves text to IDs when needed → **`executorArgs`** (or disambiguation HITL).
5. **ExecutorNode** calls **`TaskServiceAdapter(userPhone, userTimezone)`** / **`ListServiceAdapter(userPhone)`** (same underlying services as V1). `userTimezone` is the user profile IANA zone (`state.user.timezone`); the task adapter injects it into `reminderRecurrence.timezone` when the resolver omitted it, so recurring/nudge math and `ReminderService` match calendar behavior.
6. **ResponseFormatterNode** / **ResponseWriterNode** produce the user-facing message.

---

### Timezone and timestamps (tasks / reminders)

- **User time** comes from the profile / graph (`ContextAssemblyNode` → `user.timezone`), not the server host clock.
- **Calendar** normalizes datetimes with the same `userTimezone` helpers (`normalizeToISOWithOffset`, day bounds).
- **Tasks**: `TaskService` / `ReminderService` use `reminder_recurrence.timezone` (defaulting to `Asia/Jerusalem` only if absent). The adapter fills `timezone` from the user profile when missing so non–Jerusalem users get correct `next_reminder_at`.
- **Storage**: local wall times are resolved to **UTC ISO (`Z`)** in `Memo_v2/src/utils/userTimezone.ts` for Postgres-safe `timestamptz` values.

### Nudge / “every X minutes” (planner HITL)

- If the user asks only for **repeated nudges** (every X minutes/hours) with **no** stated start (“from 5pm”, “starting tomorrow”), the planner should **not** set `reminder_time_required`; the resolver uses `reminderRecurrence.type: 'nudge'` and may omit `dueDate` (first fire = now + interval in user TZ).

---

### Date and weekday resolution (CRITICAL — same rules as calendar resolver)

The database resolver receives **"[Current time: Weekday, YYYY-MM-DD HH:mm, Timezone: ...]"** in the user message. Use it to set `dueDate` correctly.

- **Weekday name → exact date**: When the user says a weekday (e.g. ביום רביעי, on Wednesday), the **next** occurrence of that weekday from today is the target date. Example: today Monday 2026-03-16 → "ביום רביעי" = **2026-03-18** (not tomorrow 2026-03-17).
- **"This [weekday]" vs "Next [weekday]"**: "Next Monday" / "יום שני הבא" = Monday of **next week**. "This Wednesday" / "ביום רביעי הזה" = next Wednesday from today.
- **"X weeks from now" + weekday**: "Sunday two weeks from now" = the second upcoming Sunday from today. Count forward by 7 days per week.

See `agents-calendar.md` for the full date/weekday resolution rules (calendar and database resolvers share the same logic).

#### Time-of-day descriptors (morning / afternoon / evening / night)

When the user gives a **day + time-of-day** for a reminder without a specific hour (e.g. "remind me tomorrow morning", "תזכיר לי מחר בערב"), the planner does **not** trigger HITL. The database resolver must set `dueDate` to a **concrete time** within that period:

| Descriptor (EN) | Hebrew  | Hour range  | Default hour for dueDate |
|-----------------|---------|-------------|---------------------------|
| morning         | בוקר   | 08:00–11:00 | 09:00                     |
| afternoon       | צהריים | 12:00–17:00 | 14:00                     |
| evening         | ערב    | 17:00–21:00 | 18:00                     |
| night           | לילה   | 20:00–23:00 | 21:00                     |

- **Examples:** "remind me tomorrow morning to call" → `dueDate` = tomorrow 09:00. "תזכיר לי ביום רביעי בערב" → Wednesday 18:00.

---

### IMPORTANT: TASK vs REMINDER Terminology

**The database stores "tasks" but the terminology depends on whether it has a due date:**

- **משימה (Task)** = A task with NO `due_date` - general to-do item
- **תזכורת (Reminder)** = A task WITH a `due_date` - will notify at that time

**Database fields:**

- `due_date` = WHEN the reminder fires (this IS the reminder time)
- `reminder` = Advance notice interval (OPTIONAL) - e.g., "30 minutes" before due_date
- `next_reminder_at` = Calculated notification time (due_date minus reminder interval)
- `reminder_recurrence` = For recurring reminders (daily/weekly/monthly/nudge)

**Response formatting rules:**

- If `due_date` exists → show "זמן: [date/time]"
- If `reminder` field has value → show "תזכורת: X לפני"
- If `reminder` field is null → OMIT the "תזכורת" line (reminder fires at due_date)
- If no `due_date` → show "💡 לא ציינת מתי להזכיר לך..."

---

### Tasks & Reminders – Parameters & Behavior

- **Core fields**

  - `text`: task title/description.
  - `dueDate`: ISO date/time for one-time reminders (if null, it's a general task).
  - `reminder`: Optional advance notice interval (e.g., "30 minutes").
  - `category`: user-defined grouping (e.g., work, personal).
  - `completed`: boolean.

- **Recurring reminders (`reminderRecurrence`)**

  - `type`: `"daily" | "weekly" | "monthly" | "nudge"`.
  - For `daily`: `{ type: "daily", time: "HH:mm" }`.
  - For `weekly`: `{ type: "weekly", days: [0-6], time: "HH:mm" }` (0=Sunday).
  - For `monthly`: `{ type: "monthly", dayOfMonth: 1-31, time: "HH:mm" }`.
  - For `nudge`: `{ type: "nudge", interval: "10 minutes" }` - repeats every X minutes/hours.
    - Default interval: **10 minutes**
    - Minimum: **1 minute**
    - NO seconds allowed
    - Examples: "5 minutes", "1 hour", "2 hours"
    - Starts immediately (sends first reminder NOW)
    - Continues until task is deleted
  - Optional: `until` ISO date; `timezone`.
  - `ReminderService` and `SchedulerService` interpret these to compute next runs.

- **Proactive WhatsApp reminders (`ReminderService.sendUpcomingReminders`)**
  - One-time and recurring due rows are **merged**, then grouped by **user + local calendar hour** (from `next_reminder_at` / `due_date`). The user gets **one message per group**, not separate sends per reminder type.
  - Multi-item payloads start with **`DONNA_DB_REMINDER_BATCH`** so `SystemPrompts.getMessageEnhancementPrompt()` formats them as **task reminders** (Type C), not the morning-brief / calendar layout.

- **Bulk operations**

  - **`deleteAll`**: Delete all tasks matching a filter
    - `where.window`: `"today" | "this_week" | "overdue" | "upcoming" | "all"`
    - `where.reminderRecurrence`: `"none" | "any" | "daily" | "weekly" | "monthly"`
    - **NO preview or confirmation** - deletes immediately
    - Response: "✅ נמחקו X משימות" / "✅ Deleted X tasks"

  - **`deleteMultiple`**: Delete specific tasks by text
    - `tasks`: Array of `{ text: "task description" }` objects
    - Entity resolution matches each text to task IDs
    - Response: "✅ נמחקו X משימות" with optional "לא נמצאו: [list]" for failures

  - **`updateMultiple`**: Update specific tasks
    - `updates`: Array of `{ text: "task to find", reminderDetails: { dueDate: "..." } }`
    - Entity resolution matches each text to task IDs
    - Response: "✅ עודכנו X משימות"

  - **`updateAll`**: Update all tasks matching a filter
    - `where.window`: Same time-bucket model as deleteAll (`today`, `this_week`, `overdue`, `upcoming`, `all`, and **`"null"`** — string — for tasks with **no `due_date`** / `due_date IS NULL`).
    - `patch`: Object with fields to update (`dueDate`, `reminder`, `category`, `completed`, etc.). For “remind me about unplanned tasks at 5:30 PM”, use `where: { window: "null" }` + `patch`, not `create` with bucket text.
    - Example: Move all overdue tasks to tomorrow
    - Response: "✅ עודכנו X משימות"

- **Recent tasks context**
  - Some flows store a “recent task snapshot” in `ConversationWindow` (e.g., “update the task I just created”).
  - The agent uses that to fill in IDs when the user refers to “these two tasks” or “that one”.

---

### Lists – Parameters & Behavior

- **List creation**

  - `listName`: user-chosen name.
  - `isChecklist`: `true` for checklists, `false` for plain notes.
  - For checklists: `items: string[]`.
  - For notes: `content: string`.

- **Item management**

  - Supports adding, renaming, removing items.
  - Mark items as done/undone.

- **Disambiguation & Fuzzy Matching**
  - When multiple lists share a name:
    - `QueryResolver` + examples in `SystemPrompts` instruct the LLM to ask the user which one they mean by number (1/2/3).
  - Hebrew query normalization:
    - Removes common prefixes ("רשימת", "הרשימה", "רשימה") before fuzzy matching.
    - Example: "רשימת הקניות" matches list named "קניות".
  - Low-confidence matching (0.1-0.6 score):
    - If no high-confidence match found but low-confidence candidate exists, asks user to confirm.
    - Example: "האם התכוונת לרשימה 'נושאים לפוסט'? (כן/לא)"

---

### Task Completion & Deletion Behavior

#### When User Indicates Task is Done

- **No confirmation needed** - Delete immediately
- User signals completion with:
  - Words: "done", "finished", "עשיתי", "סיימתי", "completed", "בוצע"
  - Symbols: "✓", "✅", "v"
  - Context: Replying to a reminder message
- **Response**: Very short congratulatory message
  - Single task: "✅ כל הכבוד!" / "✅ Nice work!"
  - Multiple tasks: "✅ כל הכבוד! סיימת הכל!" / "✅ Great job! All done!"

#### Detecting Completion from Context

- If user replies to a message containing task information, assume they're marking those tasks as done
- Extract task text from conversation context
- Delete all mentioned tasks without asking for confirmation

#### All Deletions - NO Confirmation

- **Single task**: Delete immediately
- **Multiple tasks**: Delete immediately
- **Bulk operations** (`deleteAll`): Delete immediately
- **Lists**: Delete immediately
- **List items**: Delete immediately
- Response: Brief "✅ נמחק" / "✅ Deleted"

### Error Handling & Safeguards

- DB services return uniform `IResponse` objects.
- The agent must handle:
  - Missing entities ("no such task/list/contact").
  - Ambiguous results (multiple matches) → disambiguation prompts.
  - Validation errors (e.g., invalid recurrence, missing required text).
- Destructive operations (deleteAll for bulk) use **preview flows** where specified in `SystemPrompts`.

### Task Resolution & Hebrew Normalization

- **Hebrew query normalization** (for both tasks and lists):
  - Task prefixes removed: "המשימה", "התזכורת", "משימת", "תזכורת"
  - List prefixes removed: "רשימת", "הרשימה", "רשימה"
  - Article "ה" prefix removed from first word
  - Example: "המשימה לקנות חלב" → "לקנות חלב"

- **Low-confidence matching flow**:
  - Standard threshold: 0.6+ for automatic match
  - Low-confidence range: 0.1-0.6 triggers confirmation prompt
  - Below 0.1: "not found" response
  - Confirmation message: "האם התכוונת ל-X? (כן/לא)"

### Entity Resolution Data Flow

The entity resolution system ensures resolved IDs flow correctly from fuzzy matching to execution:

1. **DatabaseListResolver/DatabaseTaskResolver** extracts args from user message (e.g., `listName`)
2. **EntityResolutionNode** calls **DatabaseEntityResolver** which:
   - Normalizes Hebrew queries
   - Fuzzy matches against user's entities
   - Returns resolved `listId`/`taskId` in the args
3. **EntityResolutionNode** stores resolved args in `executorArgs` (not `resolverResults`)
4. **ExecutorNode** reads from `executorArgs` (resolved) with fallback to `resolverResults` (original)
5. **ListServiceAdapter/TaskServiceAdapter** prefers UUID over name lookup

**Key files:**
- `EntityResolutionNode.ts` - Stores resolved args in `executorArgs`
- `ExecutorNode.ts` - Reads from `executorArgs` first
- `ListServiceAdapter.ts` - Uses `listId` for addItem/toggleItem/deleteItem
- `TaskServiceAdapter.ts` - Uses `taskId` for update/delete/complete

---

### Example Flows

- **"Remind me every day at 8am to take vitamins"**

  - `taskOperations.create` with `text: "take vitamins"`, `reminderRecurrence: { type: "daily", time: "08:00" }`.

- **"Remind me to call John, nudge me every 10 minutes"**

  - `taskOperations.create` with `text: "call John"`, `reminderRecurrence: { type: "nudge", interval: "10 minutes" }`.
  - Sends reminder immediately, then every 10 minutes until deleted.

- **"Change nudge to 15 minutes" (replying to reminder)**

  - `taskOperations.update` with `text: "call John"`, `reminderRecurrence: { type: "nudge", interval: "15 minutes" }`.

- **User marks task as done (replying to reminder)**

  - System sent: "תזכורת: לקנות חלב"
  - User: "עשיתי"
  - Agent: `taskOperations.delete` with `text: "לקנות חלב"`
  - Response: "✅ כל הכבוד!"

- **User marks multiple tasks as done**

  - System sent reminder with 3 tasks
  - User: "done all"
  - Agent: `taskOperations.deleteMultiple` for all 3 tasks
  - Response: "✅ כל הכבוד! סיימת הכל!"

- **"Delete all non-recurring tasks"**

  - `deleteAll` with `where: { reminderRecurrence: "none" }` - deletes immediately
  - Response: "✅ נמחקו X משימות"

- **"Delete the milk task and the bread task"**

  - `deleteMultiple` with `tasks: [{ text: "milk" }, { text: "bread" }]`
  - Entity resolver matches each to task IDs
  - Response: "✅ נמחקו 2 משימות"

- **"Move all overdue tasks to tomorrow at 10am"**

  - `updateAll` with `where: { window: "overdue" }, patch: { dueDate: "2025-01-16T10:00:00+02:00" }`
  - Response: "✅ עודכנו X משימות"

- **"Create a shopping list with milk, bread, apples"**

  - `listOperations.create` with `listName: "Shopping"`, `isChecklist: true`, `items: ["milk","bread","apples"]`.

- **"What tasks do I have this week?"**
  - `taskOperations.getAll` with `filters` specifying a date range and `completed: false`.

---

### When NOT to Use Database Agent

- Anything that must appear on Google Calendar (time-blocked events) → calendar agent.
- Email actions (send, reply, archive) → Gmail agent.
- Free-form journaling / idea dumps with semantic search expectations → second-brain agent.
