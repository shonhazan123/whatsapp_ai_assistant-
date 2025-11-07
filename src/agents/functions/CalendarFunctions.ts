import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
import { CalendarService } from '../../services/calendar/CalendarService';
import { TimeParser } from '../../utils/time';

export class CalendarFunction implements IFunction {
  name = 'calendarOperations';
  description = 'Handle all calendar operations including create, read, update, delete, and recurring event management';

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
      summary: { type: 'string', description: 'Event title/summary' },
      start: { type: 'string', description: 'Start time in ISO format' },
      end: { type: 'string', description: 'End time in ISO format' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees' },
      description: { type: 'string', description: 'Event description' },
      location: { type: 'string', description: 'Event location' },
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
            location: { type: 'string' }
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
      timezone: { type: 'string', description: 'Optional timezone override (e.g., "Asia/New_York")' }
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

  private async deleteByWindow(summary: string | undefined, timeMin: string, timeMax: string): Promise<IResponse> {
    const eventsResp = await this.calendarService.getEvents({ timeMin, timeMax });
    if (!eventsResp.success || !eventsResp.data) {
      return { success: false, error: 'Failed to fetch events for deletion window' };
    }

    let events = (eventsResp.data.events || []) as any[];
    if (summary) {
      const lowered = summary.toLowerCase();
      events = events.filter(event => event.summary?.toLowerCase().includes(lowered));
    }

    if (events.length === 0) {
      return { success: false, error: 'No matching events found in the requested window' };
    }

    const uniqueIds = Array.from(new Set(events.map(event => event.recurringEventId || event.id).filter(Boolean)));
    const results: any[] = [];
    const errors: any[] = [];

    for (const id of uniqueIds) {
      const deletion = await this.calendarService.deleteEvent(id as string);
      if (deletion.success) {
        results.push(id);
      } else {
        errors.push({ id, error: deletion.error });
      }
    }

    return {
      success: errors.length === 0,
      message: `Deleted ${results.length} events${errors.length ? ` (${errors.length} failed)` : ''}`,
      data: { deletedIds: results, errors: errors.length ? errors : undefined }
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

          const { language: _ignoredLanguage, ...restCreate } = params;
          const createPayload: any = { ...restCreate };
          this.normalizeTimezone(createPayload);

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
            const payload: any = { ...event };
            this.normalizeTimezone(payload);
            return payload;
          });
          return await this.calendarService.createMultipleEvents({ events: normalizedEvents });

        // ✅ Create recurring event (with optional UNTIL)
        case 'createRecurring':
          if (!params.summary || !params.startTime || !params.endTime || !params.days) {
            return { success: false, error: 'Summary, startTime, endTime, and days are required for createRecurring operation' };
          }
          return await this.calendarService.createRecurringEvent({
            summary: params.summary,
            startTime: params.startTime,
            endTime: params.endTime,
            days: params.days,
            recurrence: 'weekly',
            description: params.description,
            location: params.location,
            until: params.until // 👈 supports end date now
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
          if (!params.eventId) {
            const phrase = params.summary || '';
            const language = params.language || this.detectLanguage(phrase);

            const inferredWindow = this.deriveWindow(params, phrase);
            if (inferredWindow) {
              const windowResolution = await this.resolveEventFromWindow(
                inferredWindow,
                phrase || params.summary,
                language
              );
              if (windowResolution?.error) {
                return { success: false, error: windowResolution.error };
              }
              if (windowResolution?.eventId) {
                const { language: _ignoredLanguage, ...rest } = params;
                const updatePayload: any = {
                  ...rest,
                  eventId: windowResolution.eventId
                };
                this.normalizeTimezone(updatePayload);
                delete updatePayload.timeMin;
                delete updatePayload.timeMax;
                const updateResult = await this.calendarService.updateEvent(updatePayload);
                const link = this.buildEventLink(updateResult.data?.id || updatePayload.eventId);
                if (link) {
                  updateResult.data = {
                    ...updateResult.data,
                    link
                  };
                }
                return updateResult;
              }
            }

            const result = await resolver.resolveOneOrAsk(phrase, userId, 'event');
            if (result.disambiguation) {
              return {
                success: false,
                error: resolver.formatDisambiguation('event', result.disambiguation.candidates, language)
              };
            }
            if (!result.entity?.id) {
              return { success: false, error: 'Event not found (provide summary/time window)' };
            }

            const { language: _ignoredLanguage, ...rest } = params;
            const updatePayload: any = {
              ...rest,
              eventId: result.entity.id
            };
            this.normalizeTimezone(updatePayload);
            delete updatePayload.timeMin;
            delete updatePayload.timeMax;
            const updateResult = await this.calendarService.updateEvent(updatePayload);
            const link = this.buildEventLink(updateResult.data?.id || updatePayload.eventId);
            if (link) {
              updateResult.data = {
                ...updateResult.data,
                link
              };
            }
            return updateResult;
          }

          const { language: _ignoredLanguage2, ...rest } = params;
          const directUpdate: any = { ...rest };
          this.normalizeTimezone(directUpdate);
          delete directUpdate.timeMin;
          delete directUpdate.timeMax;
          const updateResult = await this.calendarService.updateEvent(directUpdate);
          const link = this.buildEventLink(updateResult.data?.id || directUpdate.eventId);
          if (link) {
            updateResult.data = {
              ...updateResult.data,
              link
            };
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
          const masterIds: string[] = Array.from(
            new Set(
              allEvents
                .filter((e: any) => e.summary?.toLowerCase().includes(params.summary.toLowerCase()))
                .map((e: any) => e.recurringEventId || e.id)
            )
          );

          if (masterIds.length === 0) {
            return { success: false, error: 'No matching events found' };
          }

          // Delete in batches to avoid rate limiting
          const BATCH_SIZE = 10;
          const DELAY_MS = 200; // 200ms delay between batches
          
          const results: any[] = [];
          const errors: any[] = [];
          
          for (let i = 0; i < masterIds.length; i += BATCH_SIZE) {
            const batch = masterIds.slice(i, i + BATCH_SIZE);
            
            // Delete batch in parallel
            const batchResults = await Promise.allSettled(
              batch.map(id => this.calendarService.deleteEvent(id))
            );
            
            // Collect results
            batchResults.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                results.push({ id: batch[index], success: true });
              } else {
                errors.push({ id: batch[index], error: result.reason });
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
            data: { deleted, failed, errors: failed > 0 ? errors : undefined }
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
