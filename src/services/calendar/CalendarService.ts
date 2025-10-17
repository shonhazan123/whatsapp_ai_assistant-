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

export interface RecurringEventRequest {
  summary: string;
  startTime: string; // e.g., "09:00"
  endTime: string; // e.g., "18:00"
  days: string[]; // e.g., ["Sunday", "Tuesday", "Wednesday"]
  recurrence: 'weekly' | 'daily' | 'monthly';
  description?: string;
  location?: string;
  until?: string; // Optional ISO date to stop recurrence
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

      // Log attendees if provided
      if (request.attendees && request.attendees.length > 0) {
        this.logger.info(`📧 Adding ${request.attendees.length} attendees: ${request.attendees.join(', ')}`);
      }

      const response = await calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event,
        sendUpdates: request.attendees && request.attendees.length > 0 ? 'all' : 'none'
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

  /**
   * Create a single recurring event with multiple days
   * Uses Google Calendar's built-in RRULE support
   */
  async createRecurringEvent(request: RecurringEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating recurring event: ${request.summary} on ${request.days.join(', ')}`);

      // Find the next occurrence of the first day
      const startDate = new Date();
      const firstDayIndex = this.getDayIndex(request.days[0]);
      
      while (startDate.getDay() !== firstDayIndex) {
        startDate.setDate(startDate.getDate() + 1);
      }

      // Set the start time
      const [startHour, startMinute] = request.startTime.split(':').map(Number);
      startDate.setHours(startHour, startMinute, 0, 0);

      // Set the end time
      const endDate = new Date(startDate);
      const [endHour, endMinute] = request.endTime.split(':').map(Number);
      endDate.setHours(endHour, endMinute, 0, 0);

      // Build RRULE with all days
      const dayAbbreviations = request.days.map(day => this.getDayAbbreviation(day));
      let rrule = `RRULE:FREQ=WEEKLY;BYDAY=${dayAbbreviations.join(',')}`;
      
      // Add UNTIL if provided, otherwise use COUNT
      if (request.until) {
        rrule += `;UNTIL=${request.until}`;
      } else {
        rrule += ';COUNT=100';
      }

      // Create the recurring event
      const event = {
        summary: request.summary,
        start: {
          dateTime: startDate.toISOString(),
          timeZone: 'Asia/Jerusalem'
        },
        end: {
          dateTime: endDate.toISOString(),
          timeZone: 'Asia/Jerusalem'
        },
        description: request.description,
        location: request.location,
        recurrence: [rrule]
      };

      this.logger.info(`Creating recurring event with RRULE: ${rrule}`);

      const response = await calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: event
      });

      this.logger.info(`✅ Created recurring event: ${response.data.id}`);

      return {
        success: true,
        data: {
          id: response.data.id,
          summary: response.data.summary,
          start: response.data.start?.dateTime,
          end: response.data.end?.dateTime,
          recurrence: response.data.recurrence,
          recurringEventId: response.data.id
        },
        message: `Recurring event created successfully`
      };
    } catch (error) {
      this.logger.error('Error creating recurring event:', error);
      return {
        success: false,
        error: 'Failed to create recurring event'
      };
    }
  }

  /**
   * Get recurring event instances
   * Returns all occurrences of a recurring event
   */
  async getRecurringEventInstances(recurringEventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting instances of recurring event: ${recurringEventId}`);
      
      const response = await calendar.events.instances({
        calendarId: this.calendarId,
        eventId: recurringEventId
      });

      const instances = (response.data.items || []).map((item: any) => ({
        id: item.id,
        summary: item.summary,
        start: item.start?.dateTime || item.start?.date,
        end: item.end?.dateTime || item.end?.date,
        recurringEventId: item.recurringEventId
      }));

      this.logger.info(`✅ Retrieved ${instances.length} instances`);
      
      return {
        success: true,
        data: { instances }
      };
    } catch (error) {
      this.logger.error('Error getting recurring event instances:', error);
      return {
        success: false,
        error: 'Failed to get recurring event instances'
      };
    }
  }

  /**
   * Truncate a recurring event series (end future occurrences but keep past ones)
   * This is useful when you want to stop a recurring event from continuing
   */
  async truncateRecurringEvent(eventId: string, until: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Truncating recurring event: ${eventId} until ${until}`);
      
      // Get the current event
      const eventResponse = await calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });

      const currentEvent = eventResponse.data;
      
      if (!currentEvent.recurrence) {
        return {
          success: false,
          error: 'Event is not a recurring event'
        };
      }

      // Update the RRULE to add UNTIL
      const updatedRecurrence = currentEvent.recurrence.map((rule: string) => {
        if (rule.startsWith('RRULE:')) {
          // Remove COUNT if it exists
          const withoutCount = rule.replace(/;COUNT=\d+/, '');
          // Add UNTIL
          return `${withoutCount};UNTIL=${until}`;
        }
        return rule;
      });

      // Update the event
      const response = await calendar.events.patch({
        calendarId: this.calendarId,
        eventId: eventId,
        requestBody: {
          recurrence: updatedRecurrence
        }
      });

      this.logger.info(`✅ Truncated recurring event: ${eventId}`);
      
      return {
        success: true,
        data: response.data,
        message: 'Recurring event truncated successfully'
      };
    } catch (error) {
      this.logger.error('Error truncating recurring event:', error);
      return {
        success: false,
        error: 'Failed to truncate recurring event'
      };
    }
  }

  /**
   * Check for conflicts in calendar
   */
  async checkConflicts(timeMin: string, timeMax: string): Promise<IResponse> {
    try {
      this.logger.info(`🔍 Checking for conflicts between ${timeMin} and ${timeMax}`);

      const response = await calendar.events.list({
        calendarId: this.calendarId,
        timeMin: timeMin,
        timeMax: timeMax,
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      const conflicts: any[] = [];

      // Check for overlapping events
      for (let i = 0; i < events.length - 1; i++) {
        const event1 = events[i];
        const event2 = events[i + 1];

        if (!event1.start?.dateTime || !event1.end?.dateTime || 
            !event2.start?.dateTime || !event2.end?.dateTime) {
          continue;
        }

        const start1 = new Date(event1.start.dateTime);
        const end1 = new Date(event1.end.dateTime);
        const start2 = new Date(event2.start.dateTime);
        const end2 = new Date(event2.end.dateTime);

        // Check if events overlap
        if (start1 < end2 && start2 < end1) {
          conflicts.push({
            event1: {
              id: event1.id,
              summary: event1.summary,
              start: event1.start.dateTime,
              end: event1.end.dateTime
            },
            event2: {
              id: event2.id,
              summary: event2.summary,
              start: event2.start.dateTime,
              end: event2.end.dateTime
            }
          });
        }
      }

      this.logger.info(`🔍 Found ${conflicts.length} conflicts`);

      return {
        success: true,
        data: {
          conflicts,
          count: conflicts.length
        }
      };
    } catch (error) {
      this.logger.error('Error checking conflicts:', error);
      return {
        success: false,
        error: 'Failed to check conflicts'
      };
    }
  }

  /**
   * Helper: Get day index (0 = Sunday, 1 = Monday, etc.)
   */
  private getDayIndex(day: string): number {
    const dayMap: Record<string, number> = {
      'Sunday': 0,
      'Monday': 1,
      'Tuesday': 2,
      'Wednesday': 3,
      'Thursday': 4,
      'Friday': 5,
      'Saturday': 6
    };
    return dayMap[day] || 0;
  }

  /**
   * Helper: Get day abbreviation for RRULE
   */
  private getDayAbbreviation(day: string): string {
    const dayMap: Record<string, string> = {
      'Sunday': 'SU',
      'Monday': 'MO',
      'Tuesday': 'TU',
      'Wednesday': 'WE',
      'Thursday': 'TH',
      'Friday': 'FR',
      'Saturday': 'SA'
    };
    return dayMap[day] || 'SU';
  }
}
