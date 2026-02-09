## Calendar Agent (`calendarOperations`)

### High-Level Role

The calendar agent is the **single gateway to Google Calendar**. It receives natural-language requests, turns them into structured `calendarOperations` calls, and delegates to `CalendarService` to talk to Google.

It is responsible for **calendar events only** (single and recurring), including reminders attached to those events. It is _not_ responsible for standalone reminders/tasks (those belong to the database agent).

---

### What the Calendar Agent CAN Do

- **Event creation**
  - **Single events**: one-time meetings, calls, appointments.
  - **All-day events**: trips, vacations, blocks by date.
  - **Bulk events**: create multiple discrete events in a single call (`createMultiple`).
- **Recurring events**
  - **Weekly recurrence** via day names (e.g., `["Sunday","Tuesday"]`).
  - **Monthly recurrence** via day-of-month numeric strings (e.g., `["10"]` → 10th of every month).
  - Optional end date using `until`, otherwise uses a default finite series (e.g., `COUNT`).
- **Read & list events**
  - `get` a specific event by `eventId` or by `summary` + time window (using `QueryResolver`).
  - `getEvents` in a time range (for “this week”, “tomorrow”, custom windows).
  - `getRecurringInstances` for all occurrences within a recurring series.
- **Update events**
  - Modify `summary`, `start`, `end`, `description`, `location`, `attendees`, reminders.
  - Update either a **single instance** or the **whole recurring series** (via `isRecurring` / `recurringEventId`).
- **Delete events**
  - `delete` a single event by `eventId`, or via `summary` + window.
  - When deleting by summary, the adapter fetches the event first and includes event data (summary, start, end) in the response for formatting.
  - `deleteByWindow` to bulk-delete all events in a time window.
  - `deleteByWindow` includes an `events` array with full event data (start/end times) for accurate response formatting.
  - `deleteBySummary` to bulk-delete all future events matching a summary (fuzzy).
- **Utilities**
  - `checkConflicts` to detect overlapping events in a time window.
  - `truncateRecurring` to end a recurring event at a specific date in the future.

---

### What the Calendar Agent CANNOT / MUST NOT Do

- **No generic reminders or todos** – phrases like “remind me every day at 8am” without explicit calendar context must go to **database agent** as reminders/tasks.
- **No inbox/email workflows** – sending emails, summaries, or confirmations is owned by the **Gmail agent**, not the calendar agent.
- **No DB-level lists/contacts** – creating checklists, shopping lists, or managing contacts in the internal DB is out of scope.
- **No guessing IDs or emails** – must never fabricate `eventId`, `recurringEventId`, or attendee emails.
- **No claiming success without execution** – it must not say “I added/deleted/updated an event” unless a corresponding `CalendarService` call succeeded.

Whenever you see **time on the calendar** (events, meetings), it’s the calendar agent. Whenever you see **tasks/reminders/lists**, it is not.

---

### Operations & Execution Flow

#### Execution Path

1. **Routing**: Intent classifier (or MainAgent) decides calendar is the right domain.
2. **LLM call**: `CalendarAgent` calls `BaseAgent.executeWithAI`:
   - `systemPrompt = SystemPrompts.getCalendarAgentPrompt()`
   - `functions = [calendarOperations]` from `CalendarFunctions`.
3. **Tool selection**: LLM selects `calendarOperations` and emits JSON arguments.
4. **Function layer**: `CalendarFunction.execute(args, userId)`:
   - Validates required fields (e.g., summary, start, end, days).
   - Normalizes timezone (`timezone` → `timeZone`), all-day detection, reminders.
   - Delegates to `CalendarService` method (e.g., `createEvent`, `createRecurringEvent`, `deleteEvent`, etc.).
5. **Service layer**: `CalendarService` builds Google Calendar API calls using OAuth tokens from `UserService`.
6. **Second LLM pass**: The agent calls `createCompletion` again with the tool result to generate a friendly WhatsApp response.

#### Supported `operation` values (summary)

- **`create`** – create a single event.
- **`createMultiple`** – create several single events in bulk.
- **`createRecurring`** – create a recurring series.
- **`get`** – get one event, possibly via summary + time window.
- **`getEvents`** – list events in `[timeMin, timeMax]`.
- **`update`** – modify a single existing event (instance or series).
- **`updateByWindow`** – update ALL events in a time window (move to new date/time).
- **`delete`** – delete a single event by ID or by summary.
- **`deleteByWindow`** – delete ALL events in a time window (with optional summary filter and exclusions).
- **`deleteBySummary`** – delete multiple events/master series by fuzzy-matched summary (no time window needed).
- **`getRecurringInstances`** – list instances for a recurring series.
- **`checkConflicts`** – detect overlapping events.
- **`truncateRecurring`** – cut off future recurrences for a series.

---

### Parameters, Defaults & Internal Logic

#### Time & Timezone

- **Single events**

  - Use `start` and `end` as ISO strings.
  - If no explicit `timeZone`, default is `process.env.DEFAULT_TIMEZONE` or `'Asia/Jerusalem'`.

- **All-day detection**
  - If `start` and `end` are `YYYY-MM-DD` with no `T`, they are treated as dates and `allDay: true` is inferred.
  - `CalendarService` sends `date` (not `dateTime`) to Google Calendar for all-day events.

#### Recurring events

- **Weekly recurrence**

  - `days` is an array of day names, e.g. `["Sunday","Tuesday","Wednesday"]`.
  - The service finds the next occurrence of the first day and sets start/end times.
  - RRULE: `FREQ=WEEKLY;BYDAY=SU,TU,WE;...`.

- **Monthly recurrence**

  - `days` is an array of numeric strings `"1"`–`"31"` representing day-of-month.
  - Service:
    - Computes the next date with that day-of-month.
    - Adjusts for months with fewer days (e.g., 31st in February → last day of month).
  - RRULE: `FREQ=MONTHLY;BYMONTHDAY=10` (for `["10"]`).

- **`until`**
  - Optional ISO date/time to stop recurrence.
  - Converted to UTC `UNTIL=YYYYMMDDTHHMMSSZ` for RRULE.
  - If omitted, service may fall back to a `COUNT` to prevent infinite series.

- **Response Formatting for Recurring Events**
  - `CalendarServiceAdapter.createRecurringEvent()` now includes original request parameters (`days`, `startTime`, `endTime`, `recurrence`) in the returned data.
  - This ensures response formatters can generate accurate messages like "✅ אירוע חוזר נוסף!" and "כל יום שני ב 09:30 -10:30" instead of generic event messages.
  - Day names are formatted in Hebrew/English based on user language preference.

#### Reminders (`reminderMinutesBefore`)

- `undefined` → do not alter reminders.
- `null` → clear existing reminders (`useDefault: false; overrides: []`).
- Positive number → set a popup reminder that many minutes before the event.

#### Bulk operations (deleteByWindow, updateByWindow)

- **`deleteByWindow`** – explicit operation for deleting ALL events in a time window:
  - Requires `timeMin` and `timeMax` to define the window.
  - Optional `summary` for fuzzy filtering within the window.
  - Optional `excludeSummaries` to keep specific events (exceptions).
  - `CalendarEntityResolver` resolves all matching event IDs and provides `originalEvents` with full event data (including start/end times).
  - `CalendarServiceAdapter.deleteByWindow()` iterates and deletes each event.
  - Returns list of deleted IDs, summaries, and **events array with start/end times** for response formatting.
  - The events array ensures time information is always available in delete responses.

- **`updateByWindow`** – explicit operation for updating ALL events in a time window:
  - Requires `timeMin` and `timeMax` to define the window.
  - Uses `updateFields` for the changes (e.g., new start date).
  - `CalendarEntityResolver` resolves all matching event IDs and includes original events.
  - `CalendarServiceAdapter.updateByWindow()` calculates new times preserving duration.
  - Returns list of updated events for response formatting.

#### Delete/update with exclusions

- When `deleteByWindow` or `updateByWindow` is called with **excludeSummaries**:
  - Fetches all events in the time window.
  - `excludeSummaries`: Filters OUT events whose summary contains any of the keywords (case-insensitive) - these are the **exceptions** that should be preserved.
  - Operates on all remaining events in the window.
  - Example: "delete all events this week except ultrasound" → deletes everything except events with "ultrasound" in the title.

---

### Typical Scenarios & Flows

#### 1. Simple meeting

- **User**: “תוסיף לי ביומן מחר ב-14:00 פגישה עם דנה”
- **Flow**:
  - Intent classifier → `calendar`, no multi-step plan.
  - CalendarAgent → `calendarOperations` with `operation: "create"`, `summary: "פגישה עם דנה"`, parsed `start`/`end`.
  - Service creates event; agent replies with title, time window, and a Google Calendar link.

#### 2. Weekly recurring work block

- **User**: “תסגור לי את השעות 9–18 לעבודה בימים א', ג', ד' כל שבוע”
- **Flow**:
  - CalendarAgent → `createRecurring`:
    - `summary: "עבודה"`, `startTime: "09:00"`, `endTime: "18:00"`, `days: ["Sunday","Tuesday","Wednesday"]`.
  - `CalendarService.createRecurringEvent` builds RRULE: `FREQ=WEEKLY;BYDAY=SU,TU,WE;...`.

#### 3. Monthly reminder on the 10th

- **User**: “תוסיף לי ליומן בכל 10 לחודש לבדוק משכורת”
- **Flow**:
  - CalendarAgent → `createRecurring`:
    - `summary: "בדיקת משכורת"`, `startTime: "10:00"`, `endTime: "11:00"`, `days: ["10"]`.
  - Service interprets as monthly: `FREQ=MONTHLY;BYMONTHDAY=10;...`.

#### 4. Clear week except specific event (deleteByWindow with exclusions)

- **User**: "תפנה את כל האירועים שיש לי השבוע חוץ מהאולטרסאונד"
- **Flow**:
  - Planner → action: `delete_events_by_window`, capability: `calendar`.
  - CalendarMutateResolver → `operation: "deleteByWindow"`:
    - Extracts time window: "השבוע" → `timeMin`/`timeMax`
    - Extracts exception: "אולטרסאונד" → `excludeSummaries: ["אולטרסאונד"]`
  - CalendarEntityResolver resolves all matching event IDs (excluding ultrasound).
  - CalendarServiceAdapter.deleteByWindow() iterates and deletes each event.
  - Reply: "✅ ניקיתי את השבוע ביומן! אלה האירועים שהסרת: ..."

#### 5. Postpone all morning events (updateByWindow)

- **User**: "הזז את כל האירועים של הבוקר מחר לשבת"
- **Flow**:
  - Planner → action: `update_events_by_window`, capability: `calendar`.
  - CalendarMutateResolver → `operation: "updateByWindow"`:
    - `timeMin`/`timeMax` for tomorrow morning (06:00-12:00)
    - `updateFields: { start: "Saturday..." }`
  - CalendarEntityResolver resolves all matching event IDs.
  - CalendarServiceAdapter.updateByWindow() updates each event, preserving duration.
  - Reply: "✅ הזזתי 3 אירועים לשבת!"

#### 6. Delete all tomorrow's events (deleteByWindow)

- **User**: "תמחק את כל האירועים של מחר"
- **Flow**:
  - Planner → action: `delete_events_by_window`, capability: `calendar`.
  - CalendarMutateResolver → `operation: "deleteByWindow"`:
    - `timeMin`: tomorrow 00:00, `timeMax`: tomorrow 23:59
  - CalendarEntityResolver resolves all event IDs in window.
  - CalendarServiceAdapter.deleteByWindow() deletes each event.
  - Reply: "✅ ניקיתי את מחר ביומן!"

---

### When NOT to Use Calendar Agent

- **Generic habits / reminders** (“Remind me every morning at 8 to drink water”) → database agent with `reminderRecurrence`.
- **Unstructured meeting notes** (“write down what happened in today’s meeting”) → second-brain agent.
- **Plain emails** not tied to an event (“Send John an email to thank him”) → Gmail agent.
