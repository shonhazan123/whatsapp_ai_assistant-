## Calendar Agent (`calendarOperations`)

> **Memo_v2 runtime**: `calendar` steps go to **`CalendarFindResolver`** / **`CalendarMutateResolver`** (`Memo_v2/src/graph/resolvers/CalendarResolvers.ts`), then entity resolution if needed, then **`CalendarServiceAdapter`**. The behavioral rules below still apply.

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
  - `getEvents` in a time range (for “this week”, “tomorrow”, custom windows). Default window when user gives no time context: **today + 30 days**.
  - When searching for a specific event (find event), the adapter returns **all** events in the window plus `searchCriteria` and `timeWindow`. The response writer performs semantic matching and answers informatively.
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
   - **All times are in the user’s timezone** (from `state.user.timezone`). Start/end without offset are normalized via `normalizeToISOWithOffset`; default windows and recurring event start/end use `Memo_v2/src/utils/userTimezone.ts` (never server local time).
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

#### Planner context summary

Each `PlanStep` may include a `contextSummary` string — a plain-language sentence written by the planner that resolves ambiguities (references like "it"/"זה", relative time "after pilates", "next week"). The resolver LLM receives this summary at the top of its input to improve date and operation accuracy. See `Memo_v2/src/graph/resolvers/BaseResolver.ts`.

#### Date and weekday resolution (CRITICAL — calendar and database resolvers)

All resolvers receive **"[Current time: Weekday, YYYY-MM-DD HH:mm, Timezone: ...]"** in the user message. Use it to resolve weekday names and relative dates.

- **Weekday name → exact date**
  - When the user says a weekday (e.g. ביום רביעי, יום רביעי הזה, on Wednesday, this Wednesday), the **next** occurrence of that weekday from today is the target date.
  - Example: today Monday 2026-03-16 → "ביום רביעי" = Wednesday = **2026-03-18** (not 2026-03-17 / tomorrow).
  - Hebrew: ראשון=Sun, שני=Mon, שלישי=Tue, רביעי=Wed, חמישי=Thu, שישי=Fri, שבת=Sat. Israeli week: Sunday=0 … Saturday=6.

- **"This [weekday]" vs "Next [weekday]"**
  - "This Wednesday" / "ביום רביעי" / "ביום רביעי הזה" = next Wednesday from today.
  - "Next Monday" / "יום שני הבא" = the Monday of **next week** (the Monday after this one). If today is Monday, "next Monday" = 7 days from today.
  - "This Monday" = Monday of the current week; if already passed, use the coming Monday.

- **"X weeks from now" + weekday**
  - "Sunday two weeks from now" = the **second** upcoming Sunday from today. Example: today Wednesday 2026-03-18 → first Sunday = 2026-03-22 (+4d), second Sunday = 2026-03-29 (+11d).
  - "[Weekday] N weeks from now" = the Nth upcoming occurrence of that weekday (add 7 days per week).

- **"Next week" / "next weekend"**
  - "Next week" / "השבוע הבא" = the calendar week **after** the current one (Israel: Sunday–Saturday).
  - "יום חמישי הבא" / "next Thursday" = the Thursday of **next** week, not the upcoming Thursday within this week.
  - When postponing ("דחי לשבוע הבא"), the adapter preserves the original event's duration (see below).

#### Duration preservation on update

When updating a single event and only `updateFields.start` is provided (no `end`), the adapter computes the new end from the original event's duration using `calculateUpdatedTimes(originalEvent, updateFields)`. This ensures multi-day events remain multi-day when postponed. See `Memo_v2/src/services/adapters/CalendarServiceAdapter.ts`.

#### Time-of-day descriptors (morning / afternoon / evening / night)

When the user gives a **day + time-of-day** without a specific hour (e.g. "tomorrow morning", "מחר בערב", "Thursday afternoon"), the planner does **not** trigger HITL. The calendar resolver must assign a **concrete hour** within that period:

| Descriptor (EN) | Hebrew       | Hour range  | Default hour (use for start/end) |
|-----------------|-------------|-------------|-----------------------------------|
| morning         | בוקר        | 08:00–11:00 | 09:00                             |
| afternoon       | צהריים      | 12:00–17:00 | 14:00                             |
| evening         | ערב         | 17:00–21:00 | 18:00                             |
| night           | לילה        | 20:00–23:00 | 21:00                             |

- **Examples:** "add meeting tomorrow morning" → `start` tomorrow 09:00, `end` 10:00. "Event Wednesday evening" → Wednesday 18:00–19:00.
- Use the default hour for that descriptor when the user does not specify an exact time. For window operations (e.g. "delete tomorrow morning's events"), use the range (e.g. timeMin 08:00, timeMax 11:59).

#### Time & Timezone

- **Single events**

  - Use `start` and `end` as ISO strings.
  - If no explicit `timeZone`, default is `process.env.DEFAULT_TIMEZONE` or `'Asia/Jerusalem'`.

- **All-day detection**
  - `allDay: true` is only used when:
    - The user **explicitly** requests "all day" / "יום שלם" / "כל היום", OR
    - The event **spans more than one calendar day** (trips, vacations, camps).
  - **Single-day events with only a date (no time)** default to a **timed event** at 10:00–11:00 in the user timezone. They are NOT treated as all-day.
  - When `allDay` is true, the adapter and `CalendarService` normalize start/end to **YYYY-MM-DD** (date-only) before sending to Google. If the end date is missing or the same as start, it is set to the next calendar day (exclusive end per Google API).
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

- **`deleteBySummary`** – delete all events matching a summary (fuzzy match, no strict time window):
  - Requires `summary` from the resolver.
  - `CalendarEntityResolver.resolveDeleteBySummary()` fetches events in a wide default window (1 day back, 90 days forward), then fuzzy-matches on summary.
  - Smart grouping: identical summaries or same recurring series → auto-resolve all. Ambiguous matches → HITL disambiguation (`allowMultiple: true`).
  - `CalendarServiceAdapter.deleteBySummary()` handles single, bulk, or recurring series deletion.
  - Returns `{ deleted: N, events: [...], summaries: [...] }` for response formatting.

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

#### 7. Delete event by name (deleteBySummary)

- **User**: "תמחק את האירוע של שון"
- **Flow**:
  - Planner → action: `delete_event`, capability: `calendar`.
  - CalendarMutateResolver → `operation: "deleteBySummary"`, `summary: "שון"`.
  - CalendarEntityResolver.resolveDeleteBySummary():
    - Fetches events in wide window (1 day back, 90 days forward).
    - Fuzzy matches on "שון" → finds 1 event "פגישה עם שון".
    - Single match → resolves with `eventId`, checks for recurring HITL.
  - CalendarServiceAdapter.deleteBySummary() deletes the single event.
  - Reply: "✅ מחקתי את הפגישה עם שון!"

- **Ambiguous case**: If fuzzy match returns "פגישה עם שון" (0.82) and "שוני יום הולדת" (0.78), score gap < 0.15 → HITL disambiguation asks user to choose.

#### 8. Find event — informative response (find event with full event context)

- **User**: "יש לי ביקור אצל הרופא החודש?"
- **Flow**:
  - Planner → action: `find event`, capability: `calendar`.
  - CalendarFindResolver → `operation: "getEvents"`:
    - `summary: "רופא"`, `timeMin`: March 1, `timeMax`: March 31.
  - CalendarServiceAdapter.getEvents() fetches **all** events in range, does NOT filter by summary.
    Returns `{ events: [...all 7...], searchCriteria: { summary: "רופא" }, timeWindow: { timeMin, timeMax } }`.
  - ResponseFormatterNode sets `isFindEvent: true`, passes `searchCriteria` and `timeWindow` in context.
  - CalendarResponseWriter receives all events + user message + search criteria; performs **semantic matching**.
  - **Match found**: "כן, יש לך ביקור אצל הרופא ב-15 במרץ ב-10:00, מרפאת כללית."
  - **No match**: "חיפשתי ביומן שלך במרץ ולא מצאתי אירוע שמתאים ל'רופא'. יש לך 7 אירועים אחרים בתקופה הזו."

---

### When NOT to Use Calendar Agent

- **Generic habits / reminders** (“Remind me every morning at 8 to drink water”) → database agent with `reminderRecurrence`.
- **Unstructured meeting notes** (“write down what happened in today’s meeting”) → second-brain agent.
- **Plain emails** not tied to an event (“Send John an email to thank him”) → Gmail agent.
