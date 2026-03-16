/**
 * Calendar Resolvers
 * 
 * Converts calendar-related PlanSteps into calendarOperations arguments.
 * 
 * Each resolver uses its OWN LLM call with domain-specific prompts to:
 * 1. Determine the specific operation (get, create, update, delete, etc.)
 * 2. Extract all required fields from the user's natural language
 * 
 * Based on V1: src/agents/functions/CalendarFunctions.ts
 *              src/config/system-prompts.ts (getCalendarAgentPrompt)
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { buildDateTimeISOInZone, getDatePartsInTimezone, getEndOfDayInTimezone, getStartOfDayInTimezone, normalizeToISOWithOffset } from '../../utils/userTimezone.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// CALENDAR FIND RESOLVER
// ============================================================================

/**
 * CalendarFindResolver - Read-only calendar operations
 * 
 * Uses LLM to determine operation and extract search parameters.
 */
export class CalendarFindResolver extends LLMResolver {
  readonly name = 'calendar_find_resolver';
  readonly capability: Capability = 'calendar';
  readonly actions = [
    'calendar_operation',  // Generic - LLM will determine specific operation
    'find_event',
    'list_events',
    'check_conflicts',
    'get_recurring',
    'analyze_schedule'
  ];

  getSystemPrompt(): string {
    return `YOU ARE A CALENDAR SEARCH AND ANALYSIS AGENT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into calendar search parameters.
You handle calendar queries, schedule viewing, and event finding.

## OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to SEE events/schedule → "getEvents"
- User asks "מה יש לי"/"what do I have" → "getEvents"
- User looking for SPECIFIC event → "get"
- User asks about AVAILABILITY/CONFLICTS → "checkConflicts"
- User asks about RECURRING instances → "getRecurringInstances"
- User asks "how many hours"/"כמה שעות" → "getEvents" (analysis mode)

## AVAILABLE OPERATIONS:
- **get**: Get a specific event by summary and time window
- **getEvents**: List events in a date range. Use summary to filter by event name/type (e.g. only weddings, only work).
- **checkConflicts**: Check for scheduling conflicts
- **getRecurringInstances**: Get instances of a recurring event

## CRITICAL RULES:

### Natural Language Resolution:
- ALWAYS provide event summary/title when searching for specific event
- NEVER request or rely on eventId from user - let runtime resolve it
- Include timeMin/timeMax derived from user's phrasing

### Forward-Looking for Day Names:
When user mentions a day name (e.g., "Tuesday", "שלישי"):
- ALWAYS look forward from today UNLESS user says "yesterday", "last week", etc.
- timeMin/start MUST be >= today's date (00:00:00) unless explicitly asking for past

### Current time / Reference date:
- The user message includes "Current time: Weekday, YYYY-MM-DD HH:mm, Timezone: ..."
- The date is always in ISO order: YYYY-MM-DD (e.g. 2026-03-04 = 4 March 2026). Use it to compute "today" and "tomorrow" correctly.

### WEEKDAY NAME → EXACT DATE (use [Current time] every time):
When the user says a **weekday name** (e.g. ביום רביעי, יום רביעי הזה, on Wednesday, this Wednesday):
1. **Today** = the YYYY-MM-DD in the Current time line.
2. The user means the **next** occurrence of that weekday (on or after today).
3. **Compute that date**: e.g. today Monday 2026-03-16 → Wednesday = 2026-03-18. Weekday order: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6 (Israeli week).
4. Use that date for timeMin/timeMax (or start/end). **Do NOT** use tomorrow's date unless the user said מחר/tomorrow.
Hebrew weekdays: ראשון=Sun, שני=Mon, שלישי=Tue, רביעי=Wed, חמישי=Thu, שישי=Fri, שבת=Sat.

### "THIS [weekday]" vs "NEXT [weekday]" (ביום X vs יום X הבא):
- **"This Wednesday" / "ביום רביעי" / "ביום רביעי הזה"** = the **next** Wednesday from today. Compute from [Current time].
- **"Next Monday" / "יום שני הבא"** = the Monday of **next week** (the Monday after this one). Never use "this week's Monday" for "next Monday".
- **"This Monday"** = the Monday of the current week; if it's already passed, use the coming Monday.

### "X WEEKS FROM NOW" + WEEKDAY:
- **"Sunday two weeks from now"** = the **second** upcoming Sunday from today. If today is Wednesday: first Sunday = +4 days, second Sunday = +11 days.
- **"[Weekday] N weeks from now"** = the Nth upcoming occurrence of that weekday (count forward by 7 days per week).

### Time Defaults:
- If no time range specified, default to next 30 days
- For "today's events", use today 00:00 to 23:59
- For "tomorrow's events", use tomorrow 00:00 to 23:59 (today + 1 day in the same timezone)
- For "this week", use Sunday 00:00 to Saturday 23:59
- For "next week" / "השבוע הבא", use NEXT Sunday 00:00 to NEXT Saturday 23:59 (the week AFTER the current one)
- "יום חמישי הבא" / "next Thursday" = the Thursday of NEXT WEEK, not this week's upcoming Thursday

## OUTPUT FORMAT:
{
  "operation": "getEvents",
  "summary": "event title to search for (optional)",
  "timeMin": "ISO datetime for range start",
  "timeMax": "ISO datetime for range end",
  "excludeSummaries": ["titles to exclude"]
}

## EXAMPLES:

Example 1 - Get today's events:
User: "מה האירועים שלי היום?"
Current time: Thursday, 2025-01-02 14:00, Timezone: Asia/Jerusalem
→ { "operation": "getEvents", "timeMin": "2025-01-02T00:00:00+02:00", "timeMax": "2025-01-02T23:59:59+02:00" }

Example 2 - Find specific event:
User: "מתי הפגישה עם דנה?"
→ { "operation": "get", "summary": "פגישה עם דנה", "timeMin": "2025-01-02T00:00:00+02:00", "timeMax": "2025-01-09T23:59:59+02:00" }

Example 3 - Check conflicts/availability:
User: "האם יש לי משהו ביום שני בערב?"
→ { "operation": "checkConflicts", "timeMin": "2025-01-06T18:00:00+02:00", "timeMax": "2025-01-06T22:00:00+02:00" }

Example 4 - This week excluding work:
User: "מה יש לי השבוע חוץ מעבודה?"
→ { "operation": "getEvents", "timeMin": "2025-01-06T00:00:00+02:00", "timeMax": "2025-01-12T23:59:59+02:00", "excludeSummaries": ["עבודה"] }

Example 5 - Schedule analysis:
User: "כמה שעות עבודה יש לי השבוע?"
→ { "operation": "getEvents", "summary": "עבודה", "timeMin": "2025-01-06T00:00:00+02:00", "timeMax": "2025-01-12T23:59:59+02:00" }
Note: Use summary to filter only matching events. System will analyze and count hours.

Example 5b - Count events by type:
User: "כמה אירועי חתונות יש לי ביומן לשנה הקרובה?"
Current time: Monday, 2026-03-09 10:00, Timezone: Asia/Jerusalem
→ { "operation": "getEvents", "summary": "חתונה", "timeMin": "2026-03-09T00:00:00+02:00", "timeMax": "2027-03-09T23:59:59+02:00" }
Note: Use summary to filter events by name/type. Only matching events will be returned.

Example 6 - Tomorrow's schedule:
User: "What's on my calendar tomorrow?"
→ { "operation": "getEvents", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00" }

Example 6b - Events on a weekday ("ביום רביעי" = Wednesday, not tomorrow):
User: "מה יש לי ביום רביעי?"
Current time: Monday, 2026-03-16 10:00, Timezone: Asia/Jerusalem
→ { "operation": "getEvents", "timeMin": "2026-03-18T00:00:00+02:00", "timeMax": "2026-03-18T23:59:59+02:00" }
Note: Today Monday 2026-03-16. "ביום רביעי" = Wednesday = 2026-03-18. Do NOT use 2026-03-17 (tomorrow).

Example 7 - Find recurring:
User: "show me all instances of my weekly team meeting"
→ { "operation": "getRecurringInstances", "summary": "team meeting" }

Output only the JSON, no explanation.`;
  }

  getSchemaSlice(): object {
    return {
      name: 'calendarOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['get', 'getEvents', 'checkConflicts', 'getRecurringInstances'],
          },
          eventId: { type: 'string', description: 'Event ID (only if known from prior lookup)' },
          summary: { type: 'string', description: 'Event title to search' },
          timeMin: { type: 'string', description: 'Range start (ISO datetime)' },
          timeMax: { type: 'string', description: 'Range end (ISO datetime)' },
          excludeSummaries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Summaries to exclude from results'
          },
        },
        required: ['operation'],
      },
    };
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Use LLM to extract operation and search parameters
    try {
      console.log(`[${this.name}] Calling LLM to extract calendar search params`);

      const args = await this.callLLM(step, state);

      // Validate operation
      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'getEvents'`);
        args.operation = 'getEvents';
      }

      // Apply time defaults in user timezone (never server) — 30-day window
      if (!args.timeMin && !args.timeMax) {
        const tz = state.user?.timezone || state.input?.timezone || 'Asia/Jerusalem';
        args.timeMin = getStartOfDayInTimezone(tz);
        args.timeMax = getEndOfDayInTimezone(tz, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      }

      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);

      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);

      const tz = state.user?.timezone || state.input?.timezone || 'Asia/Jerusalem';
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'getEvents',
          timeMin: getStartOfDayInTimezone(tz),
          timeMax: getEndOfDayInTimezone(tz, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
          _fallback: true,
        },
      };
    }
  }

  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'calendar';
  }
}

// ============================================================================
// CALENDAR MUTATE RESOLVER
// ============================================================================

/**
 * CalendarMutateResolver - Write calendar operations
 * 
 * Uses LLM to determine operation and extract all event fields.
 */
export class CalendarMutateResolver extends LLMResolver {
  readonly name = 'calendar_mutate_resolver';
  readonly capability: Capability = 'calendar';
  readonly actions = [
    'calendar_operation',  // Generic - LLM determines specific operation
    'create_event',
    'update_event',
    'delete_event',
    'create_recurring',
    'create_multiple_events',
    'create_multiple_recurring',
    'truncate_recurring',
    'delete_events_by_window',
    'update_events_by_window',
  ];

  getSystemPrompt(): string {
    return `YOU ARE A CALENDAR MANAGEMENT AGENT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into calendar modification parameters.
You handle ALL time-based event creation, even without explicit "calendar" keyword.

## OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to CREATE new event (including multi-day all-day events) → "create"
- User lists MULTIPLE DIFFERENT events to create separately → "createMultiple"
- User wants WEEKLY/MONTHLY recurring → "createRecurring"
- User wants MULTIPLE DIFFERENT recurring events (same days, different titles/times) → "createMultipleRecurring"
- User wants to CHANGE/MOVE a SINGLE event → "update"
- User wants to CHANGE/MOVE ALL events in a time window → "updateByWindow"
- User wants to DELETE/CANCEL a SINGLE event (singular language, specific date) → "delete"
- User wants to DELETE ALL events in a time window (no specific summary) → "deleteByWindow"
- User wants to DELETE MULTIPLE events matching a summary/name (with or without time window) → "deleteBySummary"
- User wants to END recurring series → "truncateRecurring"

## AVAILABLE OPERATIONS:
- **create**: Create single event (also for multi-day all-day events like camps, trips, vacations)
- **createMultiple**: Create multiple DIFFERENT events at once (NOT for one activity spanning a date range)
- **createRecurring**: Create single recurring event (weekly/monthly)
- **createMultipleRecurring**: Create multiple different recurring events
- **update**: Update a single existing event (use searchCriteria + updateFields)
- **updateByWindow**: Update ALL events in a time window (use timeMin, timeMax, updateFields)
- **delete**: Delete a SINGLE event (user treats it as one specific event)
- **deleteByWindow**: Delete ALL events in a time window regardless of summary (use timeMin, timeMax, optional excludeSummaries)
- **deleteBySummary**: Delete all events matching summary (with or without time window). Use when user refers to MULTIPLE events by name.
- **truncateRecurring**: End a recurring series

## CRITICAL RULES:

### Event Reminders (reminderMinutesBefore):
When user creates an event AND asks for a reminder FOR THAT EVENT:
- This is different from standalone DatabaseAgent reminders
- Use reminderMinutesBefore parameter (in minutes)
- Convert: "1 day before" = 1440, "1 hour before" = 60, "30 minutes before" = 30

Example: "add wedding on Dec 25 at 7pm and remind me a day before"
→ { "operation": "create", "summary": "Wedding", "start": "...", "reminderMinutesBefore": 1440 }

### create vs createMultiple (CRITICAL):
- **create** = ONE event, possibly spanning multiple days (e.g. vacation, camp, trip from date X to date Y)
- **createMultiple** = MULTIPLE DIFFERENT events on different dates (user lists separate items)
- NEVER use createMultiple for a SINGLE activity that spans a date range. Use "create" with allDay: true instead.

### All-Day Events — CRITICAL RULES:
**NEVER set allDay: true for a SINGLE-DAY event unless the user explicitly says "all day" / "יום שלם" / "כל היום".**
allDay: true is ONLY allowed when:
  (a) The event spans MORE THAN ONE calendar day (trips, vacations, camps), OR
  (b) The user EXPLICITLY requests "all day" / "יום שלם" / "כל היום".

A single-date event with no time (e.g. "חתונה ב30.6", "dentist on Tuesday") is NOT all-day.
→ Use default start 10:00, end 11:00 with full ISO datetime. Do NOT set allDay.

### All-Day Multi-Day Events (NO TIME specified):
When user requests an activity spanning multiple days WITHOUT specifying a specific hour:
- ALWAYS use operation: "create" (NOT createMultiple!)
- ALWAYS set allDay: true
- Use date format YYYY-MM-DD (no time component)
- End date is day AFTER last day (exclusive per Google API)
- This applies to: camps, trips, vacations, conferences, visits — any activity with a date range and no specific hour

Example: "צימר בצפון ממחר עד שישי" (no time mentioned)
→ { "operation": "create", "summary": "צימר בצפון", "start": "2025-01-03", "end": "2025-01-07", "allDay": true }

Example: "קייטנה לאפיק מ-24 עד 28 במרץ"
→ { "operation": "create", "summary": "קייטנה לאפיק", "start": "2025-03-24", "end": "2025-03-29", "allDay": true, "language": "he" }

### Time-Specific Multi-Day Events (TIME specified):
When user requests events spanning multiple days WITH a specific start/end time for EACH day:
- Use createMultiple with separate events for each day
- Use full ISO datetime
- This is for when the user wants e.g. "meetings at 2pm on Monday, Tuesday, and Wednesday"

### Recurring Events (ONLY when explicitly requested):
Indicators: "every week", "כל שבוע", "weekly", "recurring", "repeat"
- Weekly: days array with day NAMES (English): ["Monday", "Tuesday"]
- Monthly: days array with numeric STRING: ["10"], ["15"] (day of month)

Example weekly: "עבודה כל יום א', ג', ד' מ-9 עד 18"
→ { "operation": "createRecurring", "summary": "עבודה", "startTime": "09:00", "endTime": "18:00", "days": ["Sunday", "Tuesday", "Wednesday"] }

### Updates (searchCriteria + updateFields):
NEVER use eventId from user. Use searchCriteria to find event.

Example: "תזיז את הפגישה עם דנה מחר לשעה 18:30"
→ { "operation": "update", 
    "searchCriteria": { "summary": "פגישה עם דנה", "timeMin": "...", "timeMax": "..." },
    "updateFields": { "start": "2025-01-03T18:30:00+02:00", "end": "2025-01-03T19:30:00+02:00" } }

### Convert Events to All-Day (updateByWindow + allDay):
When user wants to make existing events "whole day" / "יום שלם":
- Use updateByWindow with the time window covering the events
- Set updateFields.allDay: true
- Do NOT set updateFields.start or updateFields.end (each event will be converted to all-day on its own date automatically)

Example: "תעדכני את האירועים האלה ליום שלם" (reply to events from 24-28 March)
→ { "operation": "updateByWindow", "timeMin": "2025-03-24T00:00:00+02:00", "timeMax": "2025-03-28T23:59:59+02:00", "updateFields": { "allDay": true }, "language": "he" }

Example: "make tomorrow's events all day"
→ { "operation": "updateByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "updateFields": { "allDay": true }, "language": "en" }

### Defaults:
- If SINGLE-DAY event with only date given (no time): default start 10:00, end 11:00 with full ISO datetime. Do NOT set allDay.
- If MULTI-DAY event with no time: use allDay: true (NEVER default to 10:00)
- Default duration: 1 hour (for timed events only)
- Timezone: Asia/Jerusalem (UTC+02:00/+03:00)
- REMEMBER: allDay is ONLY for multi-day spans or when the user explicitly says "all day" / "יום שלם"

### WEEKDAY NAME → EXACT DATE (CRITICAL — USE [Current time] EVERY TIME):
The user message includes **"[Current time: Weekday, YYYY-MM-DD HH:mm, Timezone: ...]"**. When the user says a **weekday name** (e.g. ביום רביעי, יום רביעי הזה, on Wednesday, this Wednesday):
1. **Today** = the YYYY-MM-DD in that line.
2. The user means the **next** occurrence of that weekday (on or after today).
3. **Compute that date**: e.g. today Monday 2026-03-16 → Wednesday = 2026-03-18. Weekday order: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6 (Israeli week).
4. Output **start** (and **end**) with that computed date + time. **Do NOT** use tomorrow's date unless the user said מחר/tomorrow.
Hebrew weekdays: ראשון=Sun, שני=Mon, שלישי=Tue, רביעי=Wed, חמישי=Thu, שישי=Fri, שבת=Sat.

### "THIS [weekday]" vs "NEXT [weekday]" (ביום X vs יום X הבא):
- **"This Wednesday" / "ביום רביעי" / "ביום רביעי הזה"** = the **next** Wednesday from today. Compute from [Current time]. If today is Monday, "ביום רביעי" = 2026-03-18, NOT 2026-03-17 (tomorrow).
- **"Next Monday" / "יום שני הבא"** = the Monday of **next week** (the Monday after this one). If today is Monday, "next Monday" = 7 days from today. If today is Tuesday, "next Monday" = 6 days from today.
- **"This Monday"** = the Monday of the current week; if it's already passed, use the coming Monday.

### "X WEEKS FROM NOW" + WEEKDAY:
- **"Sunday two weeks from now"** = the **second** upcoming Sunday from today. Example: today Wednesday 2026-03-18 → first Sunday = 2026-03-22, second Sunday = 2026-03-29.
- **"[Weekday] N weeks from now"** = the Nth upcoming occurrence of that weekday (count forward by 7 days per week).

### "Next week" / "השבוע הבא" / "Next weekend" — DATE RULES (CRITICAL):
The Israeli week starts on Sunday and ends on Saturday.

**"Next week" / "השבוע הבא":**
- Means the calendar week AFTER the current one (Sunday–Saturday).
- If today is Monday 2026-03-09, "next week" = Sunday 2026-03-15 through Saturday 2026-03-21.

**"Next [day name]" / "יום [X] הבא":**
- "יום חמישי הבא" / "next Thursday" = the Thursday of NEXT WEEK, NOT the coming Thursday within this week.
- If today is Monday and this week's Thursday hasn't passed yet, "יום חמישי הבא" still means NEXT WEEK's Thursday (7+ days away), not this week's Thursday (3 days away).
- To refer to THIS week's upcoming day, Hebrew uses "ביום חמישי" / "החמישי הקרוב" (without "הבא").

**Multi-day spans with "הבא" / "next":**
- "מיום חמישי הבא עד ראשון" = from next week's Thursday to the following Sunday.
- Always compute from the NEXT WEEK's starting point when "הבא" / "next week" is used.

**Postpone / move to next week ("דחי/הזז לשבוע הבא"):**
- When updating an event to "next week", shift the start date by 7 days (or to the same weekday in the next calendar week).
- For multi-day events: shift BOTH start and end to preserve the original duration (e.g. 4-day event stays 4 days).
- You SHOULD output both updateFields.start AND updateFields.end when postponing, but if you only output start, the system will preserve the original duration.

### Context Summary (from planner):
The user message may include a "Context Summary (from planner)" section. This is a plain-language explanation of what the user is trying to do, written by the planner which has full conversation context. USE IT to:
- Understand what "it"/"זה"/"that" refers to
- Disambiguate "this week" vs "next week"
- Know the original event's dates when postponing
- Understand relative references like "after pilates" → specific time

## OUTPUT FORMAT for create:
{
  "operation": "create",
  "summary": "Event title",
  "start": "ISO datetime or YYYY-MM-DD for all-day",
  "end": "ISO datetime or YYYY-MM-DD for all-day",
  "description": "optional",
  "location": "optional",
  "attendees": ["email1@example.com"],
  "reminderMinutesBefore": 30,
  "allDay": true/false,
  "language": "he" | "en"
}

## EXAMPLES:

Example 1 - Simple event:
User: "תוסיף ליומן פגישה עם ג'ון מחר ב-14:00"
Current time: Thursday, 02/01/2025 14:00
→ { "operation": "create", "summary": "פגישה עם ג'ון", "start": "2025-01-03T14:00:00+02:00", "end": "2025-01-03T15:00:00+02:00", "language": "he" }

Example 2 - Event with reminder:
User: "I have a wedding on December 25th at 7pm and remind me a day before"
→ { "operation": "create", "summary": "Wedding", "start": "2025-12-25T19:00:00+02:00", "end": "2025-12-25T21:00:00+02:00", "reminderMinutesBefore": 1440, "language": "en" }

Example 3 - Multi-day vacation (all-day):
User: "צימר בצפון מ-2 עד 6 בינואר"
→ { "operation": "create", "summary": "צימר בצפון", "start": "2025-01-02", "end": "2025-01-07", "allDay": true, "location": "צפון", "language": "he" }

Example 4 - Multiple separate events:
User: "create meetings on Monday, Tuesday, and Wednesday at 2pm"
→ { "operation": "createMultiple", "events": [
    { "summary": "Meeting", "start": "2025-01-06T14:00:00+02:00", "end": "2025-01-06T15:00:00+02:00" },
    { "summary": "Meeting", "start": "2025-01-07T14:00:00+02:00", "end": "2025-01-07T15:00:00+02:00" },
    { "summary": "Meeting", "start": "2025-01-08T14:00:00+02:00", "end": "2025-01-08T15:00:00+02:00" }
  ], "language": "en" }

Example 5 - Weekly recurring:
User: "work every Sunday, Tuesday, Wednesday 9-18"
→ { "operation": "createRecurring", "summary": "Work", "startTime": "09:00", "endTime": "18:00", "days": ["Sunday", "Tuesday", "Wednesday"], "language": "en" }

Example 5b - Multiple different recurring events (same days, different times/titles):
User: "תכניס לי היום עבודה לוד קבוע מ 08:00 עד 10:00 ועבודה בית שמש קבוע מ 17:00 - 21:00"
Current time: Wednesday, 19/02/2025 10:00
→ { "operation": "createMultipleRecurring", "days": ["Wednesday"], "events": [
    { "summary": "עבודה לוד", "location": "לוד", "startTime": "08:00", "endTime": "10:00" },
    { "summary": "עבודה בית שמש", "location": "בית שמש", "startTime": "17:00", "endTime": "21:00" }
  ], "language": "he" }
Note: Use createMultipleRecurring when user wants MULTIPLE DIFFERENT recurring events sharing the same day(s). Each event has its own summary/location/times. The shared "days" array applies to all events unless an individual event overrides it.

Example 6 - Update event:
User: "move tomorrow's meeting with Dana to 6:30pm"
→ { "operation": "update", 
    "searchCriteria": { "summary": "meeting with Dana", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00" },
    "updateFields": { "start": "2025-01-03T18:30:00+02:00", "end": "2025-01-03T19:30:00+02:00" },
    "language": "en" }

Example 7 - Delete event:
User: "תמחק את האירוע של החתונה"
→ { "operation": "deleteBySummary", "summary": "חתונה", "language": "he" }

Example 8 - Event with location:
User: "Schedule coffee with Tom at Cafe Noir on Friday at 3pm"
→ { "operation": "create", "summary": "Coffee with Tom", "start": "2025-01-03T15:00:00+02:00", "end": "2025-01-03T16:00:00+02:00", "location": "Cafe Noir", "language": "en" }

Example 8b - Single-date event WITHOUT time (NOT all-day):
User: "תכניסי לי ליומן חתונה של נוי ומזרחי ועומר ב30.6"
Current time: Monday, 2026-03-09 10:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "summary": "חתונה של נוי ומזרחי ועומר", "start": "2026-06-30T10:00:00+03:00", "end": "2026-06-30T11:00:00+03:00", "language": "he" }
Note: Single date with no time specified → default to 10:00-11:00 timed event. Do NOT set allDay.

Example 8c - Single-date event with explicit "all day":
User: "תוסיף לי יום שלם של גיבוש חברה ב-15 ביולי"
Current time: Monday, 2026-03-09 10:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "summary": "גיבוש חברה", "start": "2026-07-15", "end": "2026-07-16", "allDay": true, "language": "he" }
Note: User explicitly said "יום שלם" (all day) → allDay: true with YYYY-MM-DD dates.

Example 8d - "ביום רביעי הזה" / "this Wednesday" = WEDNESDAY (not tomorrow!):
User: "ביום רביעי הזה"
Context Summary: "User wants to add the meeting 'פגישה בשיימלס' to calendar on Wednesday at 13:00."
Current time: Monday, 2026-03-16 14:58, Timezone: Asia/Jerusalem
→ { "operation": "create", "summary": "פגישה בשיימלס", "start": "2026-03-18T13:00:00+02:00", "end": "2026-03-18T14:00:00+02:00", "language": "he" }
Note: Today Monday 2026-03-16. "ביום רביעי הזה" = next Wednesday = 2026-03-18. Do NOT use 2026-03-17 (tomorrow/Tuesday).

Example 8e - "Next Monday" (יום שני הבא) = Monday of next week:
User: "תוסיף ליומן פגישה עם הלקוח ביום שני הבא ב-10:00"
Current time: Wednesday, 2026-03-18 10:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "summary": "פגישה עם הלקוח", "start": "2026-03-23T10:00:00+02:00", "end": "2026-03-23T11:00:00+02:00", "language": "he" }
Note: Today Wed 2026-03-18. "יום שני הבא" = next week's Monday = 2026-03-23.

Example 8f - "Sunday two weeks from now":
User: "Add team standup to calendar Sunday two weeks from now at 9am"
Current time: Wednesday, 2026-03-18 14:00, Timezone: Asia/Jerusalem
→ { "operation": "create", "summary": "team standup", "start": "2026-03-29T09:00:00+02:00", "end": "2026-03-29T10:00:00+02:00", "language": "en" }
Note: Today Wed 2026-03-18. First Sunday = 2026-03-22, second Sunday = 2026-03-29.

Example 9 - Delete ALL events in a time window:
User: "תמחק את כל האירועים של מחר"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "language": "he" }

Example 10 - Delete events with exclusion:
User: "תפנה את מחר חוץ מהאולטרסאונד"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "excludeSummaries": ["אולטרסאונד"], "language": "he" }

Example 11 - Clear all events in a window:
User: "delete all tomorrow's events"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "language": "en" }

Example 12 - Delete multiple named events (plural language):
User: "תמחקי אותם" (context: previously discussed "קייטנה לאפיק" events on March 24-30)
→ { "operation": "deleteBySummary", "summary": "קייטנה לאפיק", "timeMin": "2025-03-24T00:00:00+02:00", "timeMax": "2025-03-30T23:59:59+02:00", "language": "he" }

Example 12b - Delete all events with same name:
User: "delete all the team meetings next week"
→ { "operation": "deleteBySummary", "summary": "team meeting", "timeMin": "2025-01-06T00:00:00+02:00", "timeMax": "2025-01-12T23:59:59+02:00", "language": "en" }

Example 14 - Update ALL events in a time window (move to new date):
User: "הזז את כל האירועים של הבוקר מחר לשבת"
→ { "operation": "updateByWindow", "timeMin": "2025-01-03T06:00:00+02:00", "timeMax": "2025-01-03T12:00:00+02:00", "updateFields": { "start": "2025-01-04" }, "language": "he" }

Example 15 - Postpone all events:
User: "postpone all morning events tomorrow to Saturday"
→ { "operation": "updateByWindow", "timeMin": "2025-01-03T06:00:00+02:00", "timeMax": "2025-01-03T12:00:00+02:00", "updateFields": { "start": "2025-01-04" }, "language": "en" }

Example 15b - Convert events to all-day:
User: "תעדכני את האירועים האלה ליום שלם"
→ { "operation": "updateByWindow", "timeMin": "2025-03-24T00:00:00+02:00", "timeMax": "2025-03-28T23:59:59+02:00", "updateFields": { "allDay": true }, "language": "he" }

Example 15c - Make events whole day (English):
User: "make all events next week full day"
→ { "operation": "updateByWindow", "timeMin": "2025-01-06T00:00:00+02:00", "timeMax": "2025-01-10T23:59:59+02:00", "updateFields": { "allDay": true }, "language": "en" }

### delete vs deleteBySummary:
- "delete" = user refers to ONE specific event (singular: "the event", "את האירוע", specific date)
- "deleteBySummary" = user refers to MULTIPLE events by name (plural: "אותם", "them", "all the X", "את כל ה-X")
- When in doubt, prefer deleteBySummary — it safely handles both single and multiple matches.

### RECURRING EVENT INTENT DETECTION (DELETE/UPDATE only):
When user DELETES or UPDATES an event, detect if they mean the ENTIRE RECURRING SERIES.

SET "recurringSeriesIntent": true ONLY when user explicitly says:
- Hebrew: "האירוע החוזר", "כל המופעים", "את הסדרה", "תמחק את כל ה..."
- English: "the recurring event", "all occurrences", "the series", "delete all the..."

DO NOT set this field (leave undefined) when:
- User mentions specific date: "ביום שני הקרוב", "מחר", "next Monday"
- User just mentions event name without "recurring/חוזר": "תמחק את אימון איגרוף"
- Creating new events (only relevant for delete/update)

Example 16 - Delete recurring series (explicit):
User: "תמחק את האירוע החוזר אימון איגרוף שבימי שני בבוקר"
→ { "operation": "delete", "summary": "אימון איגרוף", "recurringSeriesIntent": true, "language": "he" }

Example 17 - Delete single instance (specific date):
User: "תמחק את אימון איגרוף ביום שני הקרוב"
→ { "operation": "delete", "summary": "אימון איגרוף", "language": "he" }
Note: No recurringSeriesIntent - entity resolver will detect if recurring and ask user.

Example 18 - Update recurring series:
User: "תשנה את השעה של האירוע החוזר אימון איגרוף ל-10:00"
→ { "operation": "update", "searchCriteria": { "summary": "אימון איגרוף" }, "updateFields": { "start": "10:00" }, "recurringSeriesIntent": true, "language": "he" }

Example 19 - Delete all occurrences (English):
User: "delete all occurrences of the team meeting"
→ { "operation": "delete", "summary": "team meeting", "recurringSeriesIntent": true, "language": "en" }
\
Example 20 - "Next Thursday" (הבא = next week, NOT this week):
User: "תוסיפי חופש ביומן מ יום חמישי הבא עד ראשון"
Current time: Monday, 2026-03-09 16:00, Timezone: Asia/Jerusalem
Context Summary: "User wants to create a vacation event from next Thursday to Sunday (all-day, multi-day)."
→ { "operation": "create", "summary": "חופש", "start": "2026-03-19", "end": "2026-03-23", "allDay": true, "language": "he" }
Note: "יום חמישי הבא" = next week's Thursday (2026-03-19), NOT this week's Thursday (2026-03-12). End is exclusive (day after Sunday).

Example 21 - Postpone event to next week (update with duration preserved):
User: "לא דונה תדחי את זה לשבוע הבא"
Current time: Monday, 2026-03-09 17:00, Timezone: Asia/Jerusalem
Context Summary: "Agent created 'חופש' event for Thu-Sun this week (2026-03-12 to 2026-03-16). User wants to postpone it to next week."
→ { "operation": "update",
    "searchCriteria": { "summary": "חופש", "timeMin": "2026-03-12T00:00:00+02:00", "timeMax": "2026-03-16T23:59:59+02:00" },
    "updateFields": { "start": "2026-03-19", "end": "2026-03-23" },
    "language": "he" }
Note: Both start AND end shifted by 7 days. If only start is given, adapter preserves original duration.

Output only the JSON, no explanation.`;
  }

  getSchemaSlice(): object {
    return {
      name: 'calendarOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'createMultiple', 'createRecurring', 'createMultipleRecurring',
              'update', 'updateByWindow', 'delete', 'deleteByWindow', 'deleteBySummary', 'truncateRecurring'],
          },
          summary: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start time (ISO) or date (YYYY-MM-DD for all-day)' },
          end: { type: 'string', description: 'End time (ISO) or date (YYYY-MM-DD for all-day)' },
          description: { type: 'string' },
          location: { type: 'string' },
          attendees: { type: 'array', items: { type: 'string' } },
          reminderMinutesBefore: { type: 'number', description: 'Event reminder in minutes before' },
          allDay: { type: 'boolean', description: 'Whether event is all-day' },
          language: { type: 'string', enum: ['he', 'en'], description: 'Response language' },
          // For recurring
          startTime: { type: 'string', description: 'HH:mm for recurring events' },
          endTime: { type: 'string', description: 'HH:mm for recurring events' },
          days: { type: 'array', items: { type: 'string' }, description: 'Days for recurring' },
          until: { type: 'string', description: 'End date for recurring series' },
          // For multiple events
          events: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of events for createMultiple'
          },
          recurringEvents: {
            type: 'array',
            items: { type: 'object' },
            description: 'Array of recurring events'
          },
          // For update
          searchCriteria: {
            type: 'object',
            description: 'Criteria to find event to update/delete',
            properties: {
              summary: { type: 'string' },
              timeMin: { type: 'string' },
              timeMax: { type: 'string' },
            },
          },
          updateFields: {
            type: 'object',
            description: 'Fields to update',
            properties: {
              summary: { type: 'string' },
              start: { type: 'string' },
              end: { type: 'string' },
              description: { type: 'string' },
              location: { type: 'string' },
              allDay: { type: 'boolean', description: 'Set true to convert events to all-day (each event becomes all-day on its own date)' },
            },
          },
          isRecurring: { type: 'boolean', description: 'Whether updating a recurring event' },
          recurringSeriesIntent: {
            type: 'boolean',
            description: 'Set to TRUE only when user explicitly mentions recurring series (האירוע החוזר, כל המופעים, the recurring event, all occurrences). Leave undefined/omit for single event requests or ambiguous cases.'
          },
          // For delete/deleteByWindow
          timeMin: { type: 'string', description: 'Window start for bulk operations (ISO datetime)' },
          timeMax: { type: 'string', description: 'Window end for bulk operations (ISO datetime)' },
          excludeSummaries: {
            type: 'array',
            items: { type: 'string' },
            description: 'Summaries to exclude from deleteByWindow (keep these events)'
          },
        },
        required: ['operation'],
      },
    };
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const language = state.user.language === 'he' ? 'he' : 'en';

    // Use LLM to extract operation and all fields
    try {
      console.log(`[${this.name}] Calling LLM to extract calendar mutation params`);

      const args = await this.callLLM(step, state);
      args.language = language;

      // Validate operation
      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'create'`);
        args.operation = 'create';
      }

      const tz = state.user?.timezone || state.input?.timezone || 'Asia/Jerusalem';
      if (args.operation === 'create' && args.start && !args.end) {
        args.end = this.calculateEnd(args.start, tz);
      }

      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);

      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);

      // Fallback: basic create with message as summary
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'create',
          summary: step.constraints.rawMessage || state.input.message,
          language,
          _fallback: true,
        },
      };
    }
  }

  /**
   * Calculate end time (default 1 hour after start) in user timezone.
   */
  private calculateEnd(start: string, timezone: string): string {
    if (!start) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;

    const normalized = normalizeToISOWithOffset(start, timezone);
    const startDate = new Date(normalized);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const p = getDatePartsInTimezone(timezone, endDate);
    const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const timeStr = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    return buildDateTimeISOInZone(dateStr, timeStr, timezone);
  }

  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'calendar';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createCalendarFindResolver() {
  const resolver = new CalendarFindResolver();
  return resolver.asNodeFunction();
}

export function createCalendarMutateResolver() {
  const resolver = new CalendarMutateResolver();
  return resolver.asNodeFunction();
}
