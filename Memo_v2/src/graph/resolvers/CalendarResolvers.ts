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
- **getEvents**: List events in a date range
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

### Time Defaults:
- If no time range specified, default to next 7 days
- For "today's events", use today 00:00 to 23:59
- For "tomorrow's events", use tomorrow 00:00 to 23:59
- For "this week", use Monday 00:00 to Sunday 23:59
- For "next week", use next Monday to Sunday

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
Current time: Thursday, 02/01/2025 14:00
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
→ { "operation": "getEvents", "timeMin": "2025-01-06T00:00:00+02:00", "timeMax": "2025-01-12T23:59:59+02:00" }
Note: After getting events, system will analyze and count work hours.

Example 6 - Tomorrow's schedule:
User: "What's on my calendar tomorrow?"
→ { "operation": "getEvents", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00" }

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

      // Apply time defaults if not specified
      if (!args.timeMin && !args.timeMax) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        args.timeMin = now.toISOString();
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        weekLater.setHours(23, 59, 59, 999);
        args.timeMax = weekLater.toISOString();
      }

      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);

      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);

      // Fallback: default to getEvents with 7 day window
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      weekLater.setHours(23, 59, 59, 999);

      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'getEvents',
          timeMin: now.toISOString(),
          timeMax: weekLater.toISOString(),
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
- User wants to CREATE new event → "create"
- User mentions MULTIPLE separate events → "createMultiple"
- User wants WEEKLY/MONTHLY recurring → "createRecurring"
- User wants to CHANGE/MOVE a SINGLE event → "update"
- User wants to CHANGE/MOVE ALL events in a time window → "updateByWindow"
- User wants to DELETE/CANCEL a SINGLE event → "delete"
- User wants to DELETE ALL events in a time window → "deleteByWindow"
- User wants to DELETE all events matching summary (no window) → "deleteBySummary"
- User wants to END recurring series → "truncateRecurring"

## AVAILABLE OPERATIONS:
- **create**: Create single event
- **createMultiple**: Create multiple events at once
- **createRecurring**: Create single recurring event (weekly/monthly)
- **createMultipleRecurring**: Create multiple different recurring events
- **update**: Update a single existing event (use searchCriteria + updateFields)
- **updateByWindow**: Update ALL events in a time window (use timeMin, timeMax, updateFields)
- **delete**: Delete a single event by summary and time window
- **deleteByWindow**: Delete ALL events in a time window (use timeMin, timeMax, optional excludeSummaries)
- **deleteBySummary**: Delete all events matching summary (no time window needed)
- **truncateRecurring**: End a recurring series

## CRITICAL RULES:

### Event Reminders (reminderMinutesBefore):
When user creates an event AND asks for a reminder FOR THAT EVENT:
- This is different from standalone DatabaseAgent reminders
- Use reminderMinutesBefore parameter (in minutes)
- Convert: "1 day before" = 1440, "1 hour before" = 60, "30 minutes before" = 30

Example: "add wedding on Dec 25 at 7pm and remind me a day before"
→ { "operation": "create", "summary": "Wedding", "start": "...", "reminderMinutesBefore": 1440 }

### All-Day Multi-Day Events (NO TIME specified):
When user requests event spanning multiple days WITHOUT specific time:
- Use allDay: true
- Use date format YYYY-MM-DD (no time)
- End date is day AFTER last day (exclusive per Google API)

Example: "צימר בצפון ממחר עד שישי" (no time mentioned)
→ { "operation": "create", "summary": "צימר בצפון", "start": "2025-01-03", "end": "2025-01-07", "allDay": true }

### Time-Specific Multi-Day Events (TIME specified):
When user requests events spanning multiple days WITH specific time:
- Use createMultiple with separate events for each day
- Use full ISO datetime

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

### Defaults:
- If only date given (no time): default start 10:00, end 11:00
- Default duration: 1 hour
- Timezone: Asia/Jerusalem (UTC+02:00/+03:00)

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

Example 9 - Delete ALL events in a time window:
User: "תמחק את כל האירועים של מחר"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "language": "he" }

Example 10 - Delete events with exclusion:
User: "תפנה את מחר חוץ מהאולטרסאונד"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "excludeSummaries": ["אולטרסאונד"], "language": "he" }

Example 11 - Clear all events in a window:
User: "delete all tomorrow's events"
→ { "operation": "deleteByWindow", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00", "language": "en" }

Example 12 - Update ALL events in a time window (move to new date):
User: "הזז את כל האירועים של הבוקר מחר לשבת"
→ { "operation": "updateByWindow", "timeMin": "2025-01-03T06:00:00+02:00", "timeMax": "2025-01-03T12:00:00+02:00", "updateFields": { "start": "2025-01-04" }, "language": "he" }

Example 13 - Postpone all events:
User: "postpone all morning events tomorrow to Saturday"
→ { "operation": "updateByWindow", "timeMin": "2025-01-03T06:00:00+02:00", "timeMax": "2025-01-03T12:00:00+02:00", "updateFields": { "start": "2025-01-04" }, "language": "en" }

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
            },
          },
          isRecurring: { type: 'boolean', description: 'Whether updating a recurring event' },
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

      // Calculate end time if not provided
      if (args.operation === 'create' && args.start && !args.end) {
        args.end = this.calculateEnd(args.start);
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
   * Calculate end time (default 1 hour after start)
   */
  private calculateEnd(start: string): string {
    if (!start) return '';

    // Check if it's a date-only (all-day) format
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      return start;
    }

    // Add 1 hour to start time
    const startDate = new Date(start);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    return endDate.toISOString();
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
