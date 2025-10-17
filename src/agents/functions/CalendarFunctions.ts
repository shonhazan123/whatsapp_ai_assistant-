import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { CalendarService } from '../../services/calendar/CalendarService';
import { logger } from '../../utils/logger';

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
      }
    },
    required: ['operation']
  };

  constructor(
    private calendarService: CalendarService,
    private logger: any = logger
  ) {}

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

  async execute(args: any): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      switch (operation) {
        // ✅ Create a single event
        case 'create':
          if (!params.summary || !params.start || !params.end) {
            return { success: false, error: 'Summary, start, and end are required for create operation' };
          }
          
          // Extract attendees from message if provided
          const attendees = this.extractAttendeesFromMessage(params.summary, params.description);
          if (attendees.length > 0) {
            params.attendees = attendees;
            this.logger.info(`📧 Extracted attendees: ${attendees.join(', ')}`);
          }
          
          // Create the event
          const result = await this.calendarService.createEvent(params);
          
          // If event created successfully and has attendees, add meeting link
          if (result.success && result.data && attendees.length > 0) {
            const eventId = result.data.id;
            const meetingLink = `https://calendar.google.com/calendar/event?eid=${eventId}`;
            
            // Store meeting link in result for email invitation
            (result as any).meetingLink = meetingLink;
            this.logger.info(`🔗 Generated meeting link: ${meetingLink}`);
            
            // Update result message to include meeting link
            result.message = `✅ Event created successfully!

📅 Event Details:
- Title: ${params.summary}
- Start: ${params.start}
- End: ${params.end}
- Attendees: ${attendees.join(', ')}

🔗 Meeting link: ${meetingLink}

Google Calendar has automatically sent email invitations to all attendees.`;
          }
          
          return result;

        // ✅ Create multiple events
        case 'createMultiple':
          if (!params.events?.length) {
            return { success: false, error: 'Events array is required for createMultiple operation' };
          }
          return await this.calendarService.createMultipleEvents({ events: params.events });

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
        case 'get':
          if (!params.eventId) return { success: false, error: 'Event ID is required for get operation' };
          return await this.calendarService.getEventById(params.eventId);

        // ✅ Get events in range
        case 'getEvents':
          if (!params.timeMin || !params.timeMax) {
            return { success: false, error: 'timeMin and timeMax are required for getEvents' };
          }
          return await this.calendarService.getEvents({ timeMin: params.timeMin, timeMax: params.timeMax });

        // ✅ Update event
        case 'update':
          if (!params.eventId) return { success: false, error: 'Event ID is required for update' };
          return await this.calendarService.updateEvent(params);

        // ✅ Delete event (single or recurring series)
        case 'delete':
          if (!params.eventId) return { success: false, error: 'Event ID is required for delete' };
          return await this.calendarService.deleteEvent(params.eventId);

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
