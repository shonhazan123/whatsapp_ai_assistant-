import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { CalendarService } from '../../services/calendar/CalendarService';
import { logger } from '../../utils/logger';

export class CalendarFunction implements IFunction {
  name = 'calendarOperations';
  description = 'Handle all calendar operations including create, read, update, and delete events';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'createMultiple', 'get', 'getEvents', 'update', 'delete'],
        description: 'The operation to perform on calendar events'
      },
      eventId: {
        type: 'string',
        description: 'Event ID for get, update, delete operations'
      },
      summary: {
        type: 'string',
        description: 'Event title/summary'
      },
      start: {
        type: 'string',
        description: 'Start time in ISO format'
      },
      end: {
        type: 'string',
        description: 'End time in ISO format'
      },
      attendees: {
        type: 'array',
        items: { type: 'string' },
        description: 'Email addresses of attendees'
      },
      description: {
        type: 'string',
        description: 'Event description'
      },
      location: {
        type: 'string',
        description: 'Event location'
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
            location: { type: 'string' }
          },
          required: ['summary', 'start', 'end']
        }
      },
      timeMin: {
        type: 'string',
        description: 'Start time for getEvents operation (ISO format)'
      },
      timeMax: {
        type: 'string',
        description: 'End time for getEvents operation (ISO format)'
      }
    },
    required: ['operation']
  };

  constructor(
    private calendarService: CalendarService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      switch (operation) {
        case 'create':
          if (!params.summary || !params.start || !params.end) {
            return { success: false, error: 'Summary, start, and end are required for create operation' };
          }
          return await this.calendarService.createEvent({
            summary: params.summary,
            start: params.start,
            end: params.end,
            attendees: params.attendees,
            description: params.description,
            location: params.location
          });

        case 'createMultiple':
          if (!params.events || !Array.isArray(params.events) || params.events.length === 0) {
            return { success: false, error: 'Events array is required for createMultiple operation' };
          }
          return await this.calendarService.createMultipleEvents({
            events: params.events
          });

        case 'get':
          if (!params.eventId) {
            return { success: false, error: 'Event ID is required for get operation' };
          }
          return await this.calendarService.getEventById(params.eventId);

        case 'getEvents':
          if (!params.timeMin || !params.timeMax) {
            return { success: false, error: 'timeMin and timeMax are required for getEvents operation' };
          }
          return await this.calendarService.getEvents({
            timeMin: params.timeMin,
            timeMax: params.timeMax
          });

        case 'update':
          if (!params.eventId) {
            return { success: false, error: 'Event ID is required for update operation' };
          }
          return await this.calendarService.updateEvent({
            eventId: params.eventId,
            summary: params.summary,
            start: params.start,
            end: params.end,
            attendees: params.attendees,
            description: params.description,
            location: params.location
          });

        case 'delete':
          if (!params.eventId) {
            return { success: false, error: 'Event ID is required for delete operation' };
          }
          return await this.calendarService.deleteEvent(params.eventId);

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in CalendarFunction:', error);
      return { success: false, error: 'Failed to execute calendar operation' };
    }
  }
}
