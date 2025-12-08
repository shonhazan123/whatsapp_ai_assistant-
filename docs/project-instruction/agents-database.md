## Database Agent (`taskOperations`, `listOperations`, `contactOperations`)

### High-Level Role

The database agent owns **structured, non-calendar data**:

- Tasks and reminders.
- Recurring reminder patterns.
- Lists and checklist items.

It talks to `TaskService`, `ListService`, `UserDataService`, and `OnboardingService` through `DatabaseFunctions`.

**CRITICAL**: NO confirmations needed for ANY deletions (tasks, lists, items) - delete immediately.

---

### What the Database Agent CAN Do

#### Tasks & Reminders (`taskOperations`)

- Create, update, delete **tasks / reminders** - **NO confirmation needed**
- Attach:
  - One-time due dates (`dueDate`).
  - Recurring reminder patterns (`reminderRecurrence`).
- Bulk operations:
  - `createMultiple` tasks.
  - `updateMultiple` (e.g. "update these two tasks").
  - `deleteAll` with filters - **Delete immediately, no confirmation**
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

#### Execution Path

1. Intent classifier or orchestrator chooses `database` as the agent.
2. `DatabaseAgent` calls `executeWithAI` with:
   - `systemPrompt = SystemPrompts.getDatabaseAgentPrompt()`.
   - `functions = [taskOperations, listOperations]` from `DatabaseFunctions`.
3. LLM chooses one of these tools and fills arguments.
4. `DatabaseFunctions.execute`:
   - Validates required parameters.
   - Applies helper logic (e.g., `reminderRecurrence` normalization).
   - **Deletes immediately without confirmation**.
   - Calls the appropriate DB service.
5. The service performs SQL operations via `BaseService` and returns `IResponse`.
6. Database agent performs a second LLM pass (where appropriate) to produce user-facing text (Heb/En).

---

### Tasks & Reminders – Parameters & Behavior

- **Core fields**

  - `text`: task title/description.
  - `dueDate`: ISO date/time for one-time reminders.
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

- **Bulk deletion (`deleteAll`)**

  - `where` filter: `window: "overdue" | ...`, `reminderRecurrence: "none" | "any" | "daily" | "weekly" | "monthly"`, etc.
  - **NO preview or confirmation** - deletes immediately
  - Response: Brief confirmation "✅ נמחק X משימות" / "✅ Deleted X tasks"

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

- **Disambiguation**
  - When multiple lists share a name:
    - `QueryResolver` + examples in `SystemPrompts` instruct the LLM to ask the user which one they mean by number (1/2/3).

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

- **"Create a shopping list with milk, bread, apples"**

  - `listOperations.create` with `listName: "Shopping"`, `isChecklist: true`, `items: ["milk","bread","apples"]`.

- **"What tasks do I have this week?"**
  - `taskOperations.getAll` with `filters` specifying a date range and `completed: false`.

---

### When NOT to Use Database Agent

- Anything that must appear on Google Calendar (time-blocked events) → calendar agent.
- Email actions (send, reply, archive) → Gmail agent.
- Free-form journaling / idea dumps with semantic search expectations → second-brain agent.
