/**
 * Calendar Resolvers
 * 
 * Converts calendar-related PlanSteps into calendarOperations arguments.
 * 
 * Based on V1: src/agents/functions/CalendarFunctions.ts
 *              src/config/system-prompts.ts (getCalendarAgentPrompt)
 * 
 * CRITICAL V1 RULES:
 * - Calendar handles ALL time-based tasks/events (even without "calendar" keyword)
 * - Event reminders (reminderMinutesBefore) are different from standalone reminders
 * - All-day multi-day events vs time-specific events
 * - Forward-looking behavior for day-of-week references
 * - Natural language resolution (summary-based, never rely on eventId from user)
 * - searchCriteria for updates/deletes
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
 * Actions: find_event, list_events, check_conflicts, get_recurring
 */
export class CalendarFindResolver extends LLMResolver {
  readonly name = 'calendar_find_resolver';
  readonly capability: Capability = 'calendar';
  readonly actions = ['find_event', 'list_events', 'check_conflicts', 'get_recurring', 'analyze_schedule'];
  
  getSystemPrompt(): string {
    return `YOU ARE A CALENDAR SEARCH AND ANALYSIS AGENT.

## YOUR ROLE:
Convert natural language queries into calendar search parameters.
You can also analyze schedules to answer questions about availability, hours, patterns.

## AVAILABLE OPERATIONS:
- **get**: Get a specific event by summary and time window
- **getEvents**: List events in a date range
- **checkConflicts**: Check for scheduling conflicts
- **getRecurringInstances**: Get instances of a recurring event

## CRITICAL RULES:

### Natural Language Resolution:
- ALWAYS provide event summary/title in every call
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
→ { "operation": "getEvents", "timeMin": "2025-01-02T00:00:00+02:00", "timeMax": "2025-01-02T23:59:59+02:00" }

Example 2 - Find specific event:
User: "מתי הפגישה עם דנה?"
→ { "operation": "get", "summary": "פגישה עם דנה", "timeMin": "2025-01-02T00:00:00+02:00", "timeMax": "2025-01-09T23:59:59+02:00" }

Example 3 - Check conflicts:
User: "האם יש לי משהו ביום שני בערב?"
→ { "operation": "checkConflicts", "timeMin": "2025-01-06T18:00:00+02:00", "timeMax": "2025-01-06T22:00:00+02:00" }

Example 4 - This week excluding work:
User: "מה יש לי השבוע חוץ מעבודה?"
→ { "operation": "getEvents", "timeMin": "...", "timeMax": "...", "excludeSummaries": ["עבודה"] }

Example 5 - Schedule analysis:
User: "כמה שעות עבודה יש לי השבוע?"
→ { "operation": "getEvents", "timeMin": "...", "timeMax": "..." }
Note: After getting events, system will analyze and count work hours.

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
          timeMin: { type: 'string', description: 'Range start (ISO)' },
          timeMax: { type: 'string', description: 'Range end (ISO)' },
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
    const { action, constraints } = step;
    
    // Map semantic action to operation
    const operationMap: Record<string, string> = {
      'find_event': 'get',
      'list_events': 'getEvents',
      'check_conflicts': 'checkConflicts',
      'get_recurring': 'getRecurringInstances',
      'analyze_schedule': 'getEvents',
    };
    
    const operation = operationMap[action] || 'getEvents';
    
    // Build args from constraints
    const args: Record<string, any> = {
      operation,
    };
    
    // Add time range if not specified, default to next 7 days
    if (!constraints.timeMin && !constraints.timeMax) {
      const now = new Date();
      // Set to start of today
      now.setHours(0, 0, 0, 0);
      args.timeMin = now.toISOString();
      const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      weekLater.setHours(23, 59, 59, 999);
      args.timeMax = weekLater.toISOString();
    } else {
      if (constraints.timeMin) args.timeMin = constraints.timeMin;
      if (constraints.timeMax) args.timeMax = constraints.timeMax;
    }
    
    // Add search criteria
    if (constraints.summary) args.summary = constraints.summary;
    if (constraints.eventId) args.eventId = constraints.eventId;
    if (constraints.excludeSummaries) args.excludeSummaries = constraints.excludeSummaries;
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
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
 * Actions: create_event, update_event, delete_event, create_recurring, 
 *          create_multiple_events, truncate_recurring
 */
export class CalendarMutateResolver extends LLMResolver {
  readonly name = 'calendar_mutate_resolver';
  readonly capability: Capability = 'calendar';
  readonly actions = [
    'create_event', 
    'update_event', 
    'delete_event', 
    'create_recurring',
    'create_multiple_events',
    'create_multiple_recurring',
    'truncate_recurring',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A CALENDAR MANAGEMENT AGENT.

## YOUR ROLE:
Convert natural language into calendar modification parameters.
You handle ALL time-based event creation, even without explicit "calendar" keyword.

## AVAILABLE OPERATIONS:
- **create**: Create single event
- **createMultiple**: Create multiple events at once
- **createRecurring**: Create single recurring event (weekly/monthly)
- **createMultipleRecurring**: Create multiple different recurring events
- **update**: Update existing event (use searchCriteria + updateFields)
- **delete**: Delete event by summary and time window
- **deleteBySummary**: Delete all events matching summary
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

Example: "gym every morning at 10 from tomorrow till Friday"
→ { "operation": "createMultiple", "events": [
    { "summary": "Gym", "start": "2025-01-03T10:00:00+02:00", "end": "2025-01-03T11:00:00+02:00" },
    { "summary": "Gym", "start": "2025-01-04T10:00:00+02:00", "end": "2025-01-04T11:00:00+02:00" },
    ...
  ]}

### Recurring Events (ONLY when explicitly requested):
Indicators: "every week", "כל שבוע", "weekly", "recurring", "repeat"
- Weekly: days array with day NAMES (English): ["Monday", "Tuesday"]
- Monthly: days array with numeric STRING: ["10"], ["15"] (day of month)

Example weekly: "עבודה כל יום א', ג', ד' מ-9 עד 18"
→ { "operation": "createRecurring", "summary": "עבודה", "startTime": "09:00", "endTime": "18:00", "days": ["Sunday", "Tuesday", "Wednesday"] }

Example monthly: "בכל 10 לחודש לבדוק משכורת"
→ { "operation": "createRecurring", "summary": "לבדוק משכורת", "startTime": "10:00", "endTime": "11:00", "days": ["10"] }

### Updates (searchCriteria + updateFields):
NEVER use eventId from user. Use searchCriteria to find event.

Example: "תזיז את הפגישה עם דנה מחר לשעה 18:30"
→ { "operation": "update", 
    "searchCriteria": { "summary": "פגישה עם דנה", "timeMin": "2025-01-03T00:00:00+02:00", "timeMax": "2025-01-03T23:59:59+02:00" },
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
  "allDay": true/false
}

## EXAMPLES:

Example 1 - Simple event:
User: "תוסיף ליומן פגישה עם ג'ון מחר ב-14:00"
→ { "operation": "create", "summary": "פגישה עם ג'ון", "start": "2025-01-03T14:00:00+02:00", "end": "2025-01-03T15:00:00+02:00", "language": "he" }

Example 2 - Event with reminder:
User: "I have a wedding on December 25th at 7pm and remind me a day before"
→ { "operation": "create", "summary": "Wedding", "start": "2025-12-25T19:00:00+02:00", "end": "2025-12-25T21:00:00+02:00", "reminderMinutesBefore": 1440, "language": "en" }

Example 3 - Multi-day vacation (all-day):
User: "צימר בצפון מ-2 עד 6 בינואר"
→ { "operation": "create", "summary": "צימר בצפון", "start": "2025-01-02", "end": "2025-01-07", "allDay": true, "location": "צפון", "language": "he" }

Example 4 - Multiple events:
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
                   'update', 'delete', 'deleteBySummary', 'truncateRecurring'],
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
          days: { type: 'array', items: { type: 'string' }, description: 'Days for recurring: ["Monday"] or ["10"] for monthly' },
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
            description: 'Array of recurring events for createMultipleRecurring' 
          },
          // For update
          searchCriteria: {
            type: 'object',
            description: 'Criteria to find event to update/delete',
            properties: {
              summary: { type: 'string' },
              timeMin: { type: 'string' },
              timeMax: { type: 'string' },
              dayOfWeek: { type: 'string' },
              startTime: { type: 'string' },
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
          // For delete
          timeMin: { type: 'string' },
          timeMax: { type: 'string' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action, constraints, changes } = step;
    const language = state.user.language === 'he' ? 'he' : 'en';
    
    // Use LLM to extract structured arguments from natural language
    // This is similar to V1's CalendarAgent using function calling
    let args: Record<string, any>;
    
    try {
      // Call LLM with function calling to extract structured data
      args = await this.callLLM(step, state);
      args.language = language;
      
      // Ensure operation is set
      if (!args.operation) {
        // Map semantic action to operation as fallback
        const operationMap: Record<string, string> = {
          'create_event': 'create',
          'update_event': 'update',
          'delete_event': 'delete',
          'create_recurring': 'createRecurring',
          'create_multiple_events': 'createMultiple',
          'create_multiple_recurring': 'createMultipleRecurring',
          'truncate_recurring': 'truncateRecurring',
        };
        args.operation = operationMap[action] || 'create';
      }
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed, using constraint-based fallback:`, error);
      // Fallback to constraint-based resolution
      const operationMap: Record<string, string> = {
        'create_event': 'create',
        'update_event': 'update',
        'delete_event': 'delete',
        'create_recurring': 'createRecurring',
        'create_multiple_events': 'createMultiple',
        'create_multiple_recurring': 'createMultipleRecurring',
        'truncate_recurring': 'truncateRecurring',
      };
      
      const operation = operationMap[action] || 'create';
      args = { operation, language };
      
      // Fill in args from constraints (fallback logic)
      switch (operation) {
        case 'create':
          args.summary = constraints.summary || changes.summary;
          args.start = constraints.start || changes.start;
          args.end = constraints.end || changes.end || this.calculateEnd(args.start);
          if (constraints.description) args.description = constraints.description;
          if (constraints.location) args.location = constraints.location;
          if (constraints.attendees) args.attendees = constraints.attendees;
          if (constraints.reminderMinutesBefore) args.reminderMinutesBefore = constraints.reminderMinutesBefore;
          if (constraints.allDay) args.allDay = true;
          break;
          
        case 'createMultiple':
          args.events = (constraints.events || []).map((event: any) => ({
            summary: event.summary,
            start: event.start,
            end: event.end || this.calculateEnd(event.start),
            description: event.description,
            location: event.location,
            attendees: event.attendees,
            reminderMinutesBefore: event.reminderMinutesBefore,
          }));
          break;
          
        case 'createRecurring':
          args.summary = constraints.summary;
          args.startTime = constraints.startTime;
          args.endTime = constraints.endTime;
          args.days = constraints.days;
          if (constraints.until) args.until = constraints.until;
          if (constraints.location) args.location = constraints.location;
          break;
          
        case 'createMultipleRecurring':
          args.recurringEvents = constraints.recurringEvents;
          break;
          
        case 'update':
          if (constraints.eventId) {
            args.eventId = constraints.eventId;
          } else {
            args.searchCriteria = {};
            if (constraints.summary) args.searchCriteria.summary = constraints.summary;
            if (constraints.timeMin) args.searchCriteria.timeMin = constraints.timeMin;
            if (constraints.timeMax) args.searchCriteria.timeMax = constraints.timeMax;
            if (constraints.dayOfWeek) args.searchCriteria.dayOfWeek = constraints.dayOfWeek;
            if (constraints.startTime) args.searchCriteria.startTime = constraints.startTime;
          }
          args.updateFields = {};
          if (changes.summary) args.updateFields.summary = changes.summary;
          if (changes.start) args.updateFields.start = changes.start;
          if (changes.end) args.updateFields.end = changes.end;
          if (changes.description) args.updateFields.description = changes.description;
          if (changes.location) args.updateFields.location = changes.location;
          if (constraints.isRecurring) args.isRecurring = true;
          break;
          
        case 'delete':
          if (constraints.eventId) {
            args.eventId = constraints.eventId;
          } else {
            args.operation = 'deleteBySummary';
            args.summary = constraints.summary;
            if (constraints.timeMin) args.timeMin = constraints.timeMin;
            if (constraints.timeMax) args.timeMax = constraints.timeMax;
          }
          break;
          
        case 'truncateRecurring':
          args.summary = constraints.summary;
          args.until = constraints.until;
          break;
      }
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
  }
  
  /**
   * Calculate end time (default 1 hour after start)
   */
  private calculateEnd(start: string): string {
    if (!start) return '';
    
    // Check if it's a date-only (all-day) format
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      // For all-day, just return the date (Google handles it)
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
