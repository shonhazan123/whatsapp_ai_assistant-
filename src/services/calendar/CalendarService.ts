import { calendar } from '../../config/google';
import { logger } from '../../utils/logger';
import { IResponse } from '../../core/types/AgentTypes';

export interface CalendarEvent {
  id?: string;
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
}

export interface CreateEventRequest {
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
}

export interface UpdateEventRequest {
  eventId: string;
  summary?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  description?: string;
  location?: string;
}

export interface GetEventsRequest {
  timeMin: string;
  timeMax: string;
  calendarId?: string;
}

export interface BulkEventRequest {
  events: CreateEventRequest[];
}

export class CalendarService {
  private calendarId: string;

  constructor(
    private logger: any = logger,
    calendarId?: string
  ) {
    this.calendarId = calendarId || process.env.GOOGLE_CALENDAR_EMAIL || '';
  }

  async createEvent(request: CreateEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating calendar event: "${request.summary}"`);
      
      const event = {
        summary: request.summary,
        start: {
          dateTime: request.start,
          timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
        },
        end: {
          dateTime: request.end,
          timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
        },
        attendees: request.attendees?.map((email: string) => ({ email })),
        description: request.description,
        location: request.location
      };

      const response = await calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event
      });

      this.logger.info(`✅ Event created: "${request.summary}"`);
      
      return {
        success: true,
        data: {
          id: response.data.id,
          summary: request.summary,
          start: request.start,
          end: request.end,
          attendees: request.attendees
        },
        message: 'Event created successfully'
      };
    } catch (error) {
      this.logger.error('Error creating calendar event:', error);
      return {
        success: false,
        error: 'Failed to create calendar event'
      };
    }
  }

  async createMultipleEvents(request: BulkEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating ${request.events.length} calendar events`);
      
      const results = [];
      const errors = [];
      
      // Create events sequentially to avoid rate limits
      for (let i = 0; i < request.events.length; i++) {
        const eventRequest = request.events[i];
        
        try {
          const result = await this.createEvent(eventRequest);
          
          if (result.success) {
            results.push(result.data);
          } else {
            errors.push({
              event: eventRequest.summary,
              error: result.error
            });
          }
        } catch (error) {
          errors.push({
            event: eventRequest.summary,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      this.logger.info(`✅ Created ${results.length} events successfully`);
      
      return {
        success: errors.length === 0,
        data: {
          created: results,
          errors: errors.length > 0 ? errors : undefined,
          count: results.length
        },
        message: `Created ${results.length} events`
      };
    } catch (error) {
      this.logger.error('Error creating multiple events:', error);
      return {
        success: false,
        error: 'Failed to create events'
      };
    }
  }

  async getEvents(request: GetEventsRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting calendar events from ${request.timeMin} to ${request.timeMax}`);
      
      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: request.timeMin,
        timeMax: request.timeMax,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items?.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        attendees: event.attendees?.map(attendee => attendee.email),
        description: event.description,
        location: event.location
      })) || [];

      this.logger.info(`✅ Retrieved ${events.length} calendar events`);
      
      return {
        success: true,
        data: {
          events,
          count: events.length
        }
      };
    } catch (error) {
      this.logger.error('Error getting calendar events:', error);
      return {
        success: false,
        error: 'Failed to get calendar events'
      };
    }
  }

  async updateEvent(request: UpdateEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Updating calendar event: ${request.eventId}`);
      
      const updates: any = {};
      
      if (request.summary) updates.summary = request.summary;
      if (request.description) updates.description = request.description;
      if (request.location) updates.location = request.location;
      
      if (request.start) {
        updates.start = {
          dateTime: request.start,
          timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
        };
      }
      
      if (request.end) {
        updates.end = {
          dateTime: request.end,
          timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
        };
      }
      
      if (request.attendees) {
        updates.attendees = request.attendees.map((email: string) => ({ email }));
      }

      const response = await calendar.events.patch({
        calendarId: this.calendarId,
        eventId: request.eventId,
        requestBody: updates
      });

      this.logger.info(`✅ Event updated: ${request.eventId}`);
      
      return {
        success: true,
        data: response.data,
        message: 'Event updated successfully'
      };
    } catch (error) {
      this.logger.error('Error updating calendar event:', error);
      return {
        success: false,
        error: 'Failed to update calendar event'
      };
    }
  }

  async deleteEvent(eventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Deleting calendar event: ${eventId}`);
      
      await calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId
      });

      this.logger.info(`✅ Event deleted: ${eventId}`);
      
      return {
        success: true,
        message: 'Event deleted successfully'
      };
    } catch (error) {
      this.logger.error('Error deleting calendar event:', error);
      return {
        success: false,
        error: 'Failed to delete calendar event'
      };
    }
  }

  async getEventById(eventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting calendar event: ${eventId}`);
      
      const response = await calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });

      const event = {
        id: response.data.id,
        summary: response.data.summary,
        start: response.data.start?.dateTime || response.data.start?.date,
        end: response.data.end?.dateTime || response.data.end?.date,
        attendees: response.data.attendees?.map(attendee => attendee.email),
        description: response.data.description,
        location: response.data.location
      };

      this.logger.info(`✅ Retrieved calendar event: ${eventId}`);
      
      return {
        success: true,
        data: event
      };
    } catch (error) {
      this.logger.error('Error getting calendar event:', error);
      return {
        success: false,
        error: 'Failed to get calendar event'
      };
    }
  }
}
