import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
import { CalendarReminders, CalendarService } from '../../services/calendar/CalendarService';
import { FuzzyMatcher } from '../../utils/fuzzy';
import { TimeParser } from '../../utils/time';

export class CalendarFunction implements IFunction {
  name = 'calendarOperations';
  description = 'Handle all calendar operations including create, read, update, delete, and recurring event management';

  // Threshold for fuzzy matching event summaries in delete operations (0-1, higher = stricter)
  private static readonly DELETE_EVENT_SUMMARY_THRESHOLD = 0.6;

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [
          'create',
          'createMultiple',
          'createRecurring',
          'get',
          'getEvents',
          'update',
          'delete',
          'deleteBySummary',
          'getRecurringInstances',
          'checkConflicts',
          'truncateRecurring'
        ],
        description: 'The operation to perform on calendar events'
      },
      eventId: { type: 'string', description: 'Event ID for get, update, delete operations' },
      summary: { type: 'string', description: 'Event title/summary (for create/get) or new title (for update)' },
      start: { type: 'string', description: 'Start time in ISO format' },
      end: { type: 'string', description: 'End time in ISO format' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
      searchCriteria: {
        type: 'object',
        description: 'Criteria to identify the event to update/delete (use OLD/current values, not new ones). Fields: summary (old name), timeMin, timeMax, dayOfWeek, startTime, endTime',
        properties: {
          summary: { type: 'string', description: 'Current/old event title to search for' },
          timeMin: { type: 'string', description: 'Start time window for search (ISO format)' },
          timeMax: { type: 'string', description: 'End time window for search (ISO format)' },
          dayOfWeek: { type: 'string', description: 'Day of week (e.g., "Thursday", "thursday")' },
          startTime: { type: 'string', description: 'Start time of day (e.g., "08:00")' },
          endTime: { type: 'string', description: 'End time of day (e.g., "10:00")' }
        }
      },
      updateFields: {
        type: 'object',
        description: 'Fields to update (new values). Only include fields that should be changed',
        properties: {
          summary: { type: 'string', description: 'New event title' },
          start: { type: 'string', description: 'New start time (ISO format)' },
          end: { type: 'string', description: 'New end time (ISO format)' },
          description: { type: 'string', description: 'New description' },
          location: { type: 'string', description: 'New location' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'New attendees' }
        }
      },
      isRecurring: {
        type: 'boolean',
        description: 'If true, update the entire recurring series. If false or omitted, update only the specific instance'
      },
      events: {
        type: 'array',
        description: 'Array of events for createMultiple operation',
        items: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            start: { type: 'string' },
            end: { type: 'string' },
            attendees: { type: 'array', items: { type: 'string' } },
            description: { type: 'string' },
            location: { type: 'string' },
            reminderMinutesBefore: {
              anyOf: [
                { type: 'number' },
                { type: 'null' }
              ]
            }
          },
          required: ['summary', 'start', 'end']
        }
      },
      timeMin: { type: 'string', description: 'Start time for getEvents operation (ISO format)' },
      timeMax: { type: 'string', description: 'End time for getEvents operation (ISO format)' },
      startTime: { type: 'string', description: 'Start time for recurring events (e.g., "09:00")' },
      endTime: { type: 'string', description: 'End time for recurring events (e.g., "18:00")' },
      days: {
        type: 'array',
        items: { type: 'string' },
        description: 'Days of week for recurring events (e.g., ["Sunday", "Tuesday", "Wednesday"])'
      },
      until: {
        type: 'string',
        description: 'Optional ISO date to stop recurrence (e.g., "2025-12-31T23:59:00Z")'
      },
      language: { type: 'string', description: 'Language hint ("he" or "en")' },
      timezone: { type: 'string', description: 'Optional timezone override (e.g., "Asia/New_York")' },
      reminderMinutesBefore: {
        anyOf: [
          { type: 'number' },
          { type: 'null' }
        ],
        description: 'Minutes before the event to trigger a popup reminder (null to remove)'
      }
    },
    required: ['operation']
  };

  constructor(
    private calendarService: CalendarService,
    private logger: any = logger
  ) {}

  private detectLanguage(text: string): 'he' | 'en' {
    if (!text) {
      return 'en';
    }
    return /[\u0590-\u05FF]/.test(text) ? 'he' : 'en';
  }

  private normalizeTimezone(payload: any): void {
    if (!payload || typeof payload !== 'object') return;
    if (payload.timezone && !payload.timeZone) {
      payload.timeZone = payload.timezone;
    }
    delete payload.timezone;
  }

  private buildReminder(minutes: number | null | undefined): CalendarReminders | undefined {
    if (minutes === undefined) return undefined;
    if (minutes === null) {
      return { useDefault: false, overrides: [] };
    }
    const parsed = Number(minutes);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return undefined;
    }
    return {
      useDefault: false,
      overrides: [
        {
          method: 'popup',
          minutes: Math.round(parsed)
        }
      ]
    };
  }

  private buildEventLink(eventId?: string): string | undefined {
    if (!eventId) return undefined;
    const encoded = encodeURIComponent(eventId);
    return `https://calendar.google.com/calendar/event?eid=${encoded}`;
  }

  private deriveWindow(params: any, phrase?: string): { timeMin: string; timeMax: string } | null {
    if (params.timeMin && params.timeMax) {
      return { timeMin: params.timeMin, timeMax: params.timeMax };
    }

    const isoSource = [params.start, params.end].find(
      (value: any) => typeof value === 'string' && value.includes('T')
    );
    if (isoSource) {
      const date = new Date(isoSource);
      if (!Number.isNaN(date.getTime())) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { timeMin: start.toISOString(), timeMax: end.toISOString() };
      }
    }

    const range = TimeParser.parseDateRange(phrase || params.summary || '');
    if (range) {
      return { timeMin: range.start, timeMax: range.end };
    }

    return null;
  }

  private buildDisambiguationMessage(events: any[], language: 'he' | 'en'): string {
    const lines = events.slice(0, 5).map((event, index) => {
      const start = event.start ? new Date(event.start).toLocaleString('he-IL') : '—';
      return `${index + 1}. ${event.summary || 'Event'} (${start})`;
    });

    if (language === 'he') {
      return `מצאתי מספר אירועים תואמים:
${lines.join('\n')}
נא לציין כותרת מלאה או פרטים נוספים כדי שאוכל לעדכן את האירוע הנכון.`;
    }

    return `I found multiple matching events:
${lines.join('\n')}
Please specify the exact title or provide more details so I can update the correct one.`;
  }

  private async resolveEventFromWindow(
    window: { timeMin: string; timeMax: string },
    summary: string | undefined,
    language: 'he' | 'en'
  ): Promise<{ eventId?: string; error?: string }> {
    const eventsResp = await this.calendarService.getEvents(window);
    if (!eventsResp.success || !eventsResp.data?.events?.length) {
      return {};
    }

    let events = eventsResp.data.events as any[];
    if (summary) {
      const lowered = summary.toLowerCase();
      events = events.filter(event => event.summary?.toLowerCase().includes(lowered));
    }

    if (events.length === 0) {
      return {};
    }

    if (events.length === 1) {
      return { eventId: events[0].id };
    }

    return { error: this.buildDisambiguationMessage(events, language) };
  }

  /**
   * Flexible event finder that uses multiple search criteria
   * Tries different strategies to find the event
   */
  private async findEventByCriteria(
    criteria: {
      summary?: string;
      timeMin?: string;
      timeMax?: string;
      dayOfWeek?: string;
      startTime?: string;
      endTime?: string;
    },
    language: 'he' | 'en'
  ): Promise<{ eventId?: string; recurringEventId?: string; error?: string; isRecurring?: boolean }> {
    // Strategy 1: If we have timeMin/timeMax, search in that window
    if (criteria.timeMin && criteria.timeMax) {
      const window = { timeMin: criteria.timeMin, timeMax: criteria.timeMax };
      const eventsResp = await this.calendarService.getEvents(window);
      
      if (eventsResp.success && eventsResp.data?.events?.length) {
        let events = eventsResp.data.events as any[];
        
        // Filter by summary if provided - use FuzzyMatcher for better matching
        if (criteria.summary) {
          const matches = FuzzyMatcher.search<any>(criteria.summary, events, ['summary', 'description'], CalendarFunction.DELETE_EVENT_SUMMARY_THRESHOLD);
          events = matches.map(m => m.item);
        }
        
        // Filter by time of day if provided
        if (criteria.startTime || criteria.endTime) {
          events = events.filter(event => {
            if (!event.start) return false;
            const eventDate = new Date(event.start);
            const eventHour = eventDate.getHours();
            const eventMinute = eventDate.getMinutes();
            const eventTime = `${eventHour.toString().padStart(2, '0')}:${eventMinute.toString().padStart(2, '0')}`;
            
            if (criteria.startTime && eventTime !== criteria.startTime) return false;
            if (criteria.endTime) {
              const eventEndDate = new Date(event.end || event.start);
              const eventEndHour = eventEndDate.getHours();
              const eventEndMinute = eventEndDate.getMinutes();
              const eventEndTime = `${eventEndHour.toString().padStart(2, '0')}:${eventEndMinute.toString().padStart(2, '0')}`;
              if (eventEndTime !== criteria.endTime) return false;
            }
            return true;
          });
        }
        
        // Filter by day of week if provided
        if (criteria.dayOfWeek) {
          const dayNames: Record<string, number> = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6
          };
          const targetDay = dayNames[criteria.dayOfWeek.toLowerCase()];
          if (targetDay !== undefined) {
            events = events.filter(event => {
              if (!event.start) return false;
              const eventDate = new Date(event.start);
              return eventDate.getDay() === targetDay;
            });
          }
        }
        
        if (events.length === 0) {
          return {};
        }
        
        if (events.length === 1) {
          const event = events[0];
          // Check if it's a recurring event instance
          const isRecurring = !!(event as any).recurringEventId;
          return {
            eventId: event.id,
            recurringEventId: (event as any).recurringEventId,
            isRecurring
          };
        }
        
        return { error: this.buildDisambiguationMessage(events, language) };
      }
    }
    
    // Strategy 2: Use QueryResolver as fallback (needs userId, but we'll try without for now)
    // Note: This might not work perfectly without userId, but it's a fallback
    if (criteria.summary) {
      // We can't use QueryResolver here without userId, so return empty
      // The calling code should handle this case
    }
    
    return {};
  }

  private async deleteByWindow(summary: string | undefined, timeMin: string, timeMax: string): Promise<IResponse> {
    const eventsResp = await this.calendarService.getEvents({ timeMin, timeMax });
    if (!eventsResp.success || !eventsResp.data) {
      return { success: false, error: 'Failed to fetch events for deletion window' };
    }

    let events = (eventsResp.data.events || []) as any[];
    if (summary) {
      // Use FuzzyMatcher for better matching (handles word order, name variations, etc.)
      const matches = FuzzyMatcher.search<any>(summary, events, ['summary'], CalendarFunction.DELETE_EVENT_SUMMARY_THRESHOLD);
      events = matches.map(m => m.item);
    }

    if (events.length === 0) {
      return { success: false, error: 'No matching events found in the requested window' };
    }

    // Map events to their master IDs and store summaries for response
    const eventMap = new Map<string, { id: string; summary: string }>();
    events.forEach(event => {
      const masterId = (event.recurringEventId || event.id) as string;
      if (masterId && !eventMap.has(masterId)) {
        eventMap.set(masterId, { id: masterId, summary: event.summary || 'Untitled Event' });
      }
    });

    const uniqueIds = Array.from(eventMap.keys());
    const results: any[] = [];
    const errors: any[] = [];
    const deletedSummaries: string[] = [];

    for (const id of uniqueIds) {
      const deletion = await this.calendarService.deleteEvent(id);
      if (deletion.success) {
        results.push(id);
        const eventInfo = eventMap.get(id);
        if (eventInfo) {
          deletedSummaries.push(eventInfo.summary);
        }
      } else {
        errors.push({ id, error: deletion.error });
      }
    }

    return {
      success: errors.length === 0,
      message: `Deleted ${results.length} events${errors.length ? ` (${errors.length} failed)` : ''}`,
      data: { 
        deletedIds: results, 
        errors: errors.length ? errors : undefined,
        deletedSummaries: deletedSummaries.length > 0 ? deletedSummaries : undefined
      }
    };
  }

  /**
   * Extract attendees from message text
   */
  private extractAttendeesFromMessage(summary: string, description?: string): string[] {
    const text = `${summary} ${description || ''}`;
    const attendees: string[] = [];
    
    // Look for "attendees: email@example.com" pattern
    const attendeesMatch = text.match(/attendees:\s*([^\s]+)/);
    if (attendeesMatch) {
      const email = attendeesMatch[1];
      if (this.isValidEmail(email)) {
        attendees.push(email);
      }
    }
    
    // Look for "עם attendees: email@example.com" pattern
    const hebrewAttendeesMatch = text.match(/עם\s+attendees:\s*([^\s]+)/);
    if (hebrewAttendeesMatch) {
      const email = hebrewAttendeesMatch[1];
      if (this.isValidEmail(email)) {
        attendees.push(email);
      }
    }
    
    return attendees;
  }

  /**
   * Basic email validation
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;
      const resolver = new QueryResolver();

      switch (operation) {
        // ✅ Create a single event
        case 'create': {
          if (!params.summary || !params.start || !params.end) {
            return { success: false, error: 'Summary, start, and end are required for create operation' };
          }
 
          const { language: _ignoredLanguage, reminderMinutesBefore, ...restCreate } = params;
          const createPayload: any = { ...restCreate };
          this.normalizeTimezone(createPayload);

          const reminders = this.buildReminder(reminderMinutesBefore);
          if (reminders) {
            createPayload.reminders = reminders;
          }

          // Extract attendees from message if provided
          const extractedAttendees = this.extractAttendeesFromMessage(createPayload.summary, createPayload.description);
          if (extractedAttendees.length > 0) {
            if (Array.isArray(createPayload.attendees) && createPayload.attendees.length > 0) {
              createPayload.attendees = Array.from(new Set([
                ...createPayload.attendees,
                ...extractedAttendees
              ]));
            } else {
              createPayload.attendees = extractedAttendees;
            }
            this.logger.info(`📧 Extracted attendees: ${createPayload.attendees.join(', ')}`);
          }

          // Create the event
          const result = await this.calendarService.createEvent(createPayload);
          const link = this.buildEventLink(result.data?.id);
          if (link) {
            result.data = {
              ...result.data,
              link
            };
          }

          return result;
        }

        // ✅ Create multiple events
        case 'createMultiple':
          if (!params.events?.length) {
            return { success: false, error: 'Events array is required for createMultiple operation' };
          }
          const normalizedEvents = params.events.map((event: any) => {
            const { reminderMinutesBefore, ...restEvent } = event;
            const payload: any = { ...restEvent };
            this.normalizeTimezone(payload);
            const reminders = this.buildReminder(reminderMinutesBefore);
            if (reminders) {
              payload.reminders = reminders;
            }
            return payload;
          });
          return await this.calendarService.createMultipleEvents({ events: normalizedEvents });

        // ✅ Create recurring event (with optional UNTIL)
        case 'createRecurring':
          if (!params.summary || !params.startTime || !params.endTime || !params.days) {
            return { success: false, error: 'Summary, startTime, endTime, and days are required for createRecurring operation' };
          }
          const reminders = this.buildReminder(params.reminderMinutesBefore);
          return await this.calendarService.createRecurringEvent({
            summary: params.summary,
            startTime: params.startTime,
            endTime: params.endTime,
            days: params.days,
            recurrence: 'weekly',
            description: params.description,
            location: params.location,
            until: params.until, // 👈 supports end date now
            reminders
          });

        // ✅ Get recurring instances
        case 'getRecurringInstances':
          if (!params.eventId) return { success: false, error: 'Event ID is required for getRecurringInstances' };
          return await this.calendarService.getRecurringEventInstances(params.eventId);

        // ✅ Check for conflicts
        case 'checkConflicts':
          if (!params.timeMin || !params.timeMax) {
            return { success: false, error: 'timeMin and timeMax are required for checkConflicts' };
          }
          return await this.calendarService.checkConflicts(params.timeMin, params.timeMax);

        // ✅ Get event by ID
        case 'get': {
          // Natural language: resolve by summary/time window if no eventId
          if (!params.eventId) {
            const phrase = params.summary || '';
            const result = await resolver.resolveOneOrAsk(phrase, userId, 'event');
            if (result.disambiguation) {
              const language = params.language || this.detectLanguage(phrase);
              return {
                success: false,
                error: resolver.formatDisambiguation('event', result.disambiguation.candidates, language)
              };
            }
            if (!result.entity?.id) return { success: false, error: 'Event not found (provide summary/time window)' };
            return await this.calendarService.getEventById(result.entity.id);
          }
          return await this.calendarService.getEventById(params.eventId);
        }

        // ✅ Get events in range
        case 'getEvents':
          if (!params.timeMin || !params.timeMax) {
            return { success: false, error: 'timeMin and timeMax are required for getEvents' };
          }
          return await this.calendarService.getEvents({ timeMin: params.timeMin, timeMax: params.timeMax });

        // ✅ Update event
        case 'update': {
          const language = params.language || this.detectLanguage(params.summary || '');
          
          // Extract update fields (new values)
          const updateFields = params.updateFields || {};
          // If summary is provided at top level but not in updateFields, it's the new summary
          if (params.summary && !updateFields.summary) {
            updateFields.summary = params.summary;
          }
          // Also check top-level fields for backward compatibility
          if (params.start && !updateFields.start) updateFields.start = params.start;
          if (params.end && !updateFields.end) updateFields.end = params.end;
          if (params.description && !updateFields.description) updateFields.description = params.description;
          if (params.location && !updateFields.location) updateFields.location = params.location;
          if (params.attendees && !updateFields.attendees) updateFields.attendees = params.attendees;

          let targetEventId: string | undefined = params.eventId;
          let targetRecurringEventId: string | undefined;
          let isRecurringEvent = false;

          // If no eventId provided, find the event using searchCriteria or fallback to old method
          if (!targetEventId) {
            let searchCriteria = params.searchCriteria || {};
            
            // Backward compatibility: if searchCriteria not provided, try to infer from params
            if (!params.searchCriteria) {
              // Try to derive window from params
              const inferredWindow = this.deriveWindow(params, params.summary || '');
              if (inferredWindow) {
                searchCriteria.timeMin = inferredWindow.timeMin;
                searchCriteria.timeMax = inferredWindow.timeMax;
              }
              // If summary is provided but not in updateFields, it might be the old name
              if (params.summary && !updateFields.summary) {
                // Actually, if summary is in params but not in updateFields, it's ambiguous
                // Let's check if we have updateFields.summary - if yes, params.summary is old name
                // If no updateFields.summary, params.summary is new name (handled above)
              }
            }

            // Use flexible finder
            const found = await this.findEventByCriteria(searchCriteria, language);
            if (found.error) {
              return { success: false, error: found.error };
            }
            if (!found.eventId) {
              return { success: false, error: 'Event not found. Please provide more specific search criteria.' };
            }
            
            targetEventId = found.eventId;
            targetRecurringEventId = found.recurringEventId;
            isRecurringEvent = found.isRecurring || false;
          } else {
            // If eventId is provided, check if it's a recurring event
            const eventResp = await this.calendarService.getEventById(targetEventId);
            if (eventResp.success && eventResp.data) {
              const event = eventResp.data as any;
              isRecurringEvent = !!event.recurringEventId;
              targetRecurringEventId = event.recurringEventId;
            }
          }

          // Determine if we should update the recurring series or just one instance
          const updateRecurringSeries = params.isRecurring !== false && isRecurringEvent && targetRecurringEventId;
          
          // If updating recurring series, use the recurringEventId (master event)
          const finalEventId = updateRecurringSeries && targetRecurringEventId 
            ? targetRecurringEventId 
            : targetEventId;

          // Build update payload
          const { language: _ignoredLanguage, reminderMinutesBefore, searchCriteria: _ignoredSearch, updateFields: _ignoredUpdate, isRecurring: _ignoredRecurring, ...rest } = params;
          const updatePayload: any = {
            ...updateFields, // Use updateFields (new values)
            ...rest, // Include any other top-level fields for backward compatibility
            eventId: finalEventId
          };
          
          this.normalizeTimezone(updatePayload);
          delete updatePayload.timeMin;
          delete updatePayload.timeMax;
          delete updatePayload.searchCriteria;
          delete updatePayload.updateFields;
          delete updatePayload.isRecurring;
          
          const reminders = this.buildReminder(reminderMinutesBefore);
          if (reminders) {
            updatePayload.reminders = reminders;
          }

          const updateResult = await this.calendarService.updateEvent(updatePayload);
          const link = this.buildEventLink(updateResult.data?.id || finalEventId);
          if (link) {
            updateResult.data = {
              ...updateResult.data,
              link
            };
          }
          
          // Add info about recurring update
          if (updateRecurringSeries) {
            updateResult.message = (updateResult.message || 'Event updated successfully') + ' (entire recurring series updated)';
          }
          
          return updateResult;
        }

        // ✅ Delete event (single or recurring series)
        case 'delete': {
          if (!params.eventId) {
            const phrase = params.summary || '';

            if (params.timeMin && params.timeMax) {
              return await this.deleteByWindow(phrase || undefined, params.timeMin, params.timeMax);
            }

            const inferredWindow = this.deriveWindow(params, phrase);
            if (inferredWindow) {
              return await this.deleteByWindow(phrase || undefined, inferredWindow.timeMin, inferredWindow.timeMax);
            }

            const result = await resolver.resolveOneOrAsk(phrase, userId, 'event');
            if (result.disambiguation) {
              const language = params.language || this.detectLanguage(phrase);
              return {
                success: false,
                error: resolver.formatDisambiguation('event', result.disambiguation.candidates, language)
              };
            }
            if (!result.entity?.id) return { success: false, error: 'Event not found (provide summary/time window)' };
            return await this.calendarService.deleteEvent(result.entity.id);
          }
          return await this.calendarService.deleteEvent(params.eventId);
        }

        // ✅ Delete by summary – optimized to target MASTER events
        case 'deleteBySummary': {
          if (!params.summary) return { success: false, error: 'Summary is required for deleteBySummary' };

          const now = new Date();
          const futureDate = new Date();
          futureDate.setMonth(futureDate.getMonth() + 6);

          const eventsResult = await this.calendarService.getEvents({
            timeMin: now.toISOString(),
            timeMax: futureDate.toISOString()
          });

          if (!eventsResult.success || !eventsResult.data) {
            return { success: false, error: 'Failed to fetch events' };
          }

          const allEvents = eventsResult.data.events || [];
          // Use FuzzyMatcher for better matching (handles word order, name variations, etc.)
          const matches = FuzzyMatcher.search<any>(params.summary, allEvents, ['summary', 'description'], CalendarFunction.DELETE_EVENT_SUMMARY_THRESHOLD);
          
          // Map events to their master IDs and store summaries for response
          const eventMap = new Map<string, { id: string; summary: string }>();
          matches.forEach(m => {
            const event = m.item;
            const masterId = event.recurringEventId || event.id;
            if (masterId && !eventMap.has(masterId)) {
              eventMap.set(masterId, { id: masterId, summary: event.summary || 'Untitled Event' });
            }
          });
          
          const masterIds: string[] = Array.from(eventMap.keys());

          if (masterIds.length === 0) {
            return { success: false, error: 'No matching events found' };
          }

          // Delete in batches to avoid rate limiting
          const BATCH_SIZE = 10;
          const DELAY_MS = 200; // 200ms delay between batches
          
          const results: any[] = [];
          const errors: any[] = [];
          const deletedSummaries: string[] = [];
          
          for (let i = 0; i < masterIds.length; i += BATCH_SIZE) {
            const batch = masterIds.slice(i, i + BATCH_SIZE);
            
            // Delete batch in parallel
            const batchResults = await Promise.allSettled(
              batch.map(id => this.calendarService.deleteEvent(id))
            );
            
            // Collect results and summaries
            batchResults.forEach((result, index) => {
              const masterId = batch[index];
              const eventInfo = eventMap.get(masterId);
              if (result.status === 'fulfilled') {
                results.push({ id: masterId, success: true });
                if (eventInfo) {
                  deletedSummaries.push(eventInfo.summary);
                }
              } else {
                errors.push({ id: masterId, error: result.reason });
              }
            });
            
            // Add delay between batches (except for the last batch)
            if (i + BATCH_SIZE < masterIds.length) {
              await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
          }

          const deleted = results.length;
          const failed = errors.length;

          return {
            success: failed === 0,
            message: `Deleted ${deleted} events (${failed} failed)`,
            data: { 
              deleted, 
              failed, 
              errors: failed > 0 ? errors : undefined,
              deletedSummaries: deletedSummaries.length > 0 ? deletedSummaries : undefined
            }
          };
        }

        // ✅ Truncate recurring series (end future occurrences but keep past)
        case 'truncateRecurring':
          if (!params.eventId || !params.until) {
            return { success: false, error: 'eventId and until are required for truncateRecurring' };
          }
          return await this.calendarService.truncateRecurringEvent(params.eventId, params.until);

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error executing calendar function:', error);
      return { success: false, error: 'Failed to execute calendar operation' };
    }
  }
}
