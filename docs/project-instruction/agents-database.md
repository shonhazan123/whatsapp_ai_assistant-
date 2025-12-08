## Database Agent (`taskOperations`, `listOperations`, `contactOperations`)

### High-Level Role

The database agent owns **structured, non-calendar data**:

- Tasks and reminders.
- Recurring reminder patterns.
- Lists and checklist items.
- Contacts (names, emails, phones) in the internal DB.

It talks to `TaskService`, `ListService`, `ContactService`, `UserDataService`, and `OnboardingService` through `DatabaseFunctions`.

---

### What the Database Agent CAN Do

#### Tasks & Reminders (`taskOperations`)

- Create, update, delete **tasks / reminders**.
- Attach:
  - One-time due dates (`dueDate`).
  - Recurring reminder patterns (`reminderRecurrence`).
- Bulk operations:
  - `createMultiple` tasks.
  - `updateMultiple` (e.g. “update these two tasks”).
  - `deleteAll` with filters (overdue, non-recurring, by category, etc.) using preview/confirm.
- Fetch and filter:
  - `getAll` with filters (category, completion state, date windows).
  - “Overdue”, “upcoming”, “completed”, “work only”, etc.

#### Lists (`listOperations`)

- Create/delete named lists:
  - Checklists (with items, each with completion state).
  - Non-checklist notes (e.g., “Reminders” list).
- Manage items:
  - Add/update/delete items in a list.
  - Mark checklist items complete/incomplete.

#### Contacts (`contactOperations`)

- Search contacts by name.
- Retrieve stored email/phone for a person.
- Provide contact details to other workflows (e.g., calendar/gmail) via orchestrator or MultiTaskService.

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
   - `functions = [taskOperations, listOperations, contactOperations]` from `DatabaseFunctions`.
3. LLM chooses one of these tools and fills arguments.
4. `DatabaseFunctions.execute`:
   - Validates required parameters.
   - Applies helper logic (e.g., `reminderRecurrence` normalization, preview flows).
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
  - `type`: `"daily" | "weekly" | "monthly"`.
  - For `daily`: `{ type: "daily", time: "HH:mm" }`.
  - For `weekly`: `{ type: "weekly", days: [0-6], time: "HH:mm" }` (0=Sunday).
  - For `monthly`: `{ type: "monthly", dayOfMonth: 1-31, time: "HH:mm" }`.
  - Optional: `until` ISO date; `timezone`.
  - `ReminderService` and `SchedulerService` interpret these to compute next runs.

- **Bulk deletion (`deleteAll`)**
  - `where` filter: `window: "overdue" | ...`, `reminderRecurrence: "none" | "any" | "daily" | "weekly" | "monthly"`, etc.
  - `preview: true`:
    - First show user what would be deleted.
  - `preview: false`:
    - Then perform the same deletion with identical `where` filter.

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

### Contacts – Parameters & Behavior

- **Search**
  - `name`: search string (Hebrew/English).
  - Service returns best matches; presentation includes name and email (and possibly phone).
- **Resolution**
  - When something like “email John” is requested:
    - Orchestrator/Database agent can perform `contactOperations.search` and then pass the email to Gmail/Calendar flows.

---

### Error Handling & Safeguards

- DB services return uniform `IResponse` objects.
- The agent must handle:
  - Missing entities (“no such task/list/contact”).
  - Ambiguous results (multiple matches) → disambiguation prompts.
  - Validation errors (e.g., invalid recurrence, missing required text).
- Destructive operations (delete/deleteAll) are expected to use **preview flows** where specified in `SystemPrompts`.

---

### Example Flows

- **“Remind me every day at 8am to take vitamins”**
  - `taskOperations.create` with `text: "take vitamins"`, `reminderRecurrence: { type: "daily", time: "08:00" }`.

- **“Delete all non-recurring tasks”**
  - `deleteAll` with `where: { reminderRecurrence: "none" }`, `preview: true`.
  - User confirms → same call with `preview: false`.

- **“Create a shopping list with milk, bread, apples”**
  - `listOperations.create` with `listName: "Shopping"`, `isChecklist: true`, `items: ["milk","bread","apples"]`.

- **“What tasks do I have this week?”**
  - `taskOperations.getAll` with `filters` specifying a date range and `completed: false`.

---

### When NOT to Use Database Agent

- Anything that must appear on Google Calendar (time-blocked events) → calendar agent.
- Email actions (send, reply, archive) → Gmail agent.
- Free-form journaling / idea dumps with semantic search expectations → second-brain agent.


