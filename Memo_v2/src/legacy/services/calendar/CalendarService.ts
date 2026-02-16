import { calendar_v3, google } from 'googleapis';
import { RequestContext } from '../../core/context/RequestContext';
import { IResponse } from '../../core/types/AgentTypes';
import { RequestUserContext } from '../../types/UserContext';
import { UpsertGoogleTokenPayload, UserService } from '../database/UserService';

export interface CalendarReminderOverride {
  method: 'popup' | 'email';
  minutes: number;
}

export interface CalendarReminders {
  useDefault: boolean;
  overrides?: CalendarReminderOverride[];
}

export interface CalendarEvent {
  id?: string;
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
  reminders?: CalendarReminders;
}

export interface CreateEventRequest {
  summary: string;
  start: string;
  end: string;
  attendees?: string[];
  description?: string;
  location?: string;
  timeZone?: string;
  reminders?: CalendarReminders;
  allDay?: boolean; // If true, use date format (YYYY-MM-DD) instead of dateTime
}

export interface UpdateEventRequest {
  eventId: string;
  summary?: string;
  start?: string;
  end?: string;
  attendees?: string[];
  description?: string;
  location?: string;
  timeZone?: string;
  reminders?: CalendarReminders;
  calendarId?: string;
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
  reminders?: CalendarReminders;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  (process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback` : undefined);

export class CalendarService {
  private userService: UserService;

  constructor(
    private logger: any = logger
  ) {
    this.userService = new UserService(logger);
  }

  // getRequestContext() removed - context is now passed as parameter to all methods

  /**
   * Detects if a date string is in date-only format (YYYY-MM-DD) vs datetime format
   */
  private isDateOnlyFormat(dateStr: string): boolean {
    if (!dateStr || typeof dateStr !== 'string') return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !dateStr.includes('T');
  }

  private buildOAuthClient(context: RequestUserContext) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth client is not configured properly.');
    }
    if (!context.googleTokens) {
      throw new Error('Google account is not connected for this user.');
    }

    const oauthClient = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const credentials: {
      access_token?: string;
      refresh_token?: string;
      expiry_date?: number;
      token_type?: string;
    } = {};

    if (context.googleTokens.access_token) {
      credentials.access_token = context.googleTokens.access_token;
    }
    if (context.googleTokens.refresh_token) {
      credentials.refresh_token = context.googleTokens.refresh_token;
    }
    if (context.googleTokens.expires_at) {
      credentials.expiry_date = new Date(context.googleTokens.expires_at).getTime();
    }
    if (context.googleTokens.token_type) {
      credentials.token_type = context.googleTokens.token_type;
    }

    oauthClient.setCredentials(credentials);
    oauthClient.on('tokens', tokens => {
      this.persistTokens(tokens, context).catch(error =>
        this.logger.error('Failed to persist Google tokens after refresh', error)
      );
    });

    return oauthClient;
  }

  private buildCalendar(context: RequestUserContext): calendar_v3.Calendar {
    const oauthClient = this.buildOAuthClient(context);
    return google.calendar({ version: 'v3', auth: oauthClient });
  }

  private resolveCalendarId(context: RequestUserContext, requestedId?: string): string {
    if (requestedId) {
      return requestedId;
    }
    return context.user.google_email || 'primary';
  }

  private async persistTokens(tokens: any, context: RequestUserContext): Promise<void> {
    const payload: UpsertGoogleTokenPayload = {
      accessToken: tokens.access_token ?? context.googleTokens?.access_token ?? null,
      refreshToken: tokens.refresh_token ?? context.googleTokens?.refresh_token ?? null,
      expiresAt: tokens.expiry_date ?? context.googleTokens?.expires_at ?? null,
      scope: tokens.scope
        ? Array.isArray(tokens.scope)
          ? tokens.scope
          : tokens.scope.split(' ')
        : context.googleTokens?.scope ?? null,
      tokenType: tokens.token_type ?? context.googleTokens?.token_type ?? null
    };

    const updatedTokens = await this.userService.upsertGoogleTokens(context.user.id, payload);
    context.googleTokens = updatedTokens;
  }

  async createEvent(context: RequestUserContext, request: CreateEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating calendar event: "${request.summary}"`);
      const timeZone = request.timeZone || process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem';

      const event: calendar_v3.Schema$Event = {
        summary: request.summary,
        attendees: request.attendees?.map(email => ({ email })),
        description: request.description,
        location: request.location
      };

      // Handle all-day events vs timed events
      if (request.allDay) {
        // All-day event: use date format (YYYY-MM-DD)
        // For all-day events, end date should be exclusive (day after last day)
        event.start = {
          date: request.start
        };
        event.end = {
          date: request.end
        };
        this.logger.info(`📅 Creating all-day event from ${request.start} to ${request.end}`);
      } else {
        // Timed event: use dateTime format
        event.start = {
          dateTime: request.start,
          timeZone
        };
        event.end = {
          dateTime: request.end,
          timeZone
        };
      }

      if (request.reminders) {
        event.reminders = request.reminders;
      }

      if (request.attendees && request.attendees.length > 0) {
        this.logger.info(`📧 Adding ${request.attendees.length} attendees: ${request.attendees.join(', ')}`);
      }

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      const response = await calendarClient.events.insert({
        calendarId,
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
          attendees: request.attendees,
          htmlLink: response.data.htmlLink
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

  async createMultipleEvents(context: RequestUserContext, request: BulkEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating ${request.events.length} calendar events`);

      const results = [];
      const errors = [];

      // Create events sequentially to avoid rate limits
      for (let i = 0; i < request.events.length; i++) {
        const eventRequest = request.events[i];

        try {
          const result = await this.createEvent(context, eventRequest);

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

  async getEvents(context: RequestUserContext, request: GetEventsRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting calendar events from ${request.timeMin} to ${request.timeMax}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context, request.calendarId);

      const response = await calendarClient.events.list({
        calendarId,
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
        location: event.location,
        recurringEventId: event.recurringEventId, // Include recurring event ID
        htmlLink: event.htmlLink
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

  async updateEvent(context: RequestUserContext, request: UpdateEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Updating calendar event: ${request.eventId}`);

      const updates: any = {};
      const timeZone = request.timeZone || process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem';

      if (request.summary) updates.summary = request.summary;
      if (request.description) updates.description = request.description;
      if (request.location) updates.location = request.location;

      if (request.start) {
        updates.start = {
          dateTime: request.start,
          timeZone
        };
      }

      if (request.end) {
        updates.end = {
          dateTime: request.end,
          timeZone
        };
      }

      if (request.attendees) {
        updates.attendees = request.attendees.map((email: string) => ({ email }));
      }

      if (request.reminders) {
        updates.reminders = request.reminders;
      }

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context, request.calendarId);

      try {
        const response = await calendarClient.events.patch({
          calendarId,
          eventId: request.eventId,
          requestBody: updates
        });

        this.logger.info(`✅ Event updated: ${request.eventId}`);

        return {
          success: true,
          data: { ...response.data, htmlLink: response.data?.htmlLink },
          message: 'Event updated successfully'
        };
      } catch (error: any) {
        // Retry with date format if format mismatch (all-day event)
        // Check for: 1) Invalid error, 2) Bad Request with date-only input, 3) date-only format in request
        const isFormatError = error?.status === 400 && (
          error?.errors?.[0]?.message?.includes('Invalid') ||
          error?.errors?.[0]?.reason === 'badRequest'
        );
        const hasDateOnlyInput = (request.start && this.isDateOnlyFormat(request.start)) ||
          (request.end && this.isDateOnlyFormat(request.end));

        if (isFormatError || hasDateOnlyInput) {
          this.logger.warn(`⚠️  Format mismatch detected, retrying with date format for event: ${request.eventId}`);
          if (updates.start?.dateTime) {
            const dateOnly = updates.start.dateTime.split('T')[0];
            updates.start = { date: dateOnly };
          }
          if (updates.end?.dateTime) {
            const dateOnly = updates.end.dateTime.split('T')[0];
            updates.end = { date: dateOnly };
          }
          const retryResponse = await calendarClient.events.patch({
            calendarId,
            eventId: request.eventId,
            requestBody: updates
          });
          this.logger.info(`✅ Event updated (retry with date format): ${request.eventId}`);
          return {
            success: true,
            data: { ...retryResponse.data, htmlLink: retryResponse.data?.htmlLink },
            message: 'Event updated successfully'
          };
        }
        throw error;
      }
    } catch (error) {
      this.logger.error('Error updating calendar event:', error);
      return {
        success: false,
        error: 'Failed to update calendar event'
      };
    }
  }

  async deleteEvent(context: RequestUserContext, eventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Deleting calendar event: ${eventId}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      await calendarClient.events.delete({
        calendarId,
        eventId
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

  /**
   * Delete an entire recurring event series
   * Deleting the master event removes all instances
   */
  async deleteRecurringSeries(context: RequestUserContext, recurringEventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Deleting recurring series: ${recurringEventId}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      // Get the master event info before deletion for response
      let eventSummary = 'Recurring Event';
      try {
        const eventResp = await calendarClient.events.get({
          calendarId,
          eventId: recurringEventId
        });
        eventSummary = eventResp.data.summary || 'Recurring Event';
      } catch {
        // Event might be an instance ID, try to get it anyway
      }

      // Deleting the master event removes all instances
      await calendarClient.events.delete({
        calendarId,
        eventId: recurringEventId
      });

      this.logger.info(`✅ Recurring series deleted: ${recurringEventId}`);

      return {
        success: true,
        message: 'Recurring event series deleted successfully',
        data: {
          recurringEventId,
          summary: eventSummary,
          isRecurringSeries: true
        }
      };
    } catch (error) {
      this.logger.error('Error deleting recurring series:', error);
      return {
        success: false,
        error: 'Failed to delete recurring event series'
      };
    }
  }

  /**
   * Update an entire recurring event series
   * Updating the master event updates all future instances
   */
  async updateRecurringSeries(context: RequestUserContext, recurringEventId: string, updates: Partial<UpdateEventRequest>): Promise<IResponse> {
    try {
      this.logger.info(`📅 Updating recurring series: ${recurringEventId}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);
      const timeZone = updates.timeZone || process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem';

      // Build update payload
      const updatePayload: any = {};

      if (updates.summary) updatePayload.summary = updates.summary;
      if (updates.description) updatePayload.description = updates.description;
      if (updates.location) updatePayload.location = updates.location;

      if (updates.start) {
        updatePayload.start = {
          dateTime: updates.start,
          timeZone
        };
      }

      if (updates.end) {
        updatePayload.end = {
          dateTime: updates.end,
          timeZone
        };
      }

      if (updates.attendees) {
        updatePayload.attendees = updates.attendees.map((email: string) => ({ email }));
      }

      if (updates.reminders) {
        updatePayload.reminders = updates.reminders;
      }

      // Update the master event (applies to all future instances)
      const response = await calendarClient.events.patch({
        calendarId,
        eventId: recurringEventId,
        requestBody: updatePayload
      });

      this.logger.info(`✅ Recurring series updated: ${recurringEventId}`);

      return {
        success: true,
        message: 'Recurring event series updated successfully',
        data: {
          ...response.data,
          isRecurringSeries: true
        }
      };
    } catch (error) {
      this.logger.error('Error updating recurring series:', error);
      return {
        success: false,
        error: 'Failed to update recurring event series'
      };
    }
  }

  async getEventById(context: RequestUserContext, eventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting calendar event: ${eventId}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      const response = await calendarClient.events.get({
        calendarId,
        eventId
      });

      const event = {
        id: response.data.id,
        summary: response.data.summary,
        start: response.data.start?.dateTime || response.data.start?.date,
        end: response.data.end?.dateTime || response.data.end?.date,
        attendees: response.data.attendees?.map(attendee => attendee.email),
        description: response.data.description,
        location: response.data.location,
        recurringEventId: response.data.recurringEventId // Include recurring event ID
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
  async createRecurringEvent(context: RequestUserContext, request: RecurringEventRequest): Promise<IResponse> {
    try {
      this.logger.info(`📅 Creating recurring event: ${request.summary} on ${request.days.join(', ')} (${request.recurrence})`);

      const startDate = new Date();
      let rrule: string;

      // Handle different recurrence types
      if (request.recurrence === 'monthly') {
        // Monthly recurrence: days are day of month (1-31)
        const dayOfMonth = parseInt(request.days[0], 10);
        if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
          return {
            success: false,
            error: 'Invalid day of month. Must be between 1 and 31.'
          };
        }

        // Find the next occurrence of this day of month
        const today = new Date();
        const currentDay = today.getDate();

        if (currentDay < dayOfMonth) {
          // This month, set to the day
          startDate.setDate(dayOfMonth);
        } else {
          // Next month, set to the day
          startDate.setMonth(today.getMonth() + 1);
          startDate.setDate(dayOfMonth);
        }

        // Handle months with fewer days (e.g., Feb 30 -> Feb 28/29)
        const maxDayInMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
        if (dayOfMonth > maxDayInMonth) {
          startDate.setDate(maxDayInMonth);
        }

        // Set the start time
        const [startHour, startMinute] = request.startTime.split(':').map(Number);
        startDate.setHours(startHour, startMinute, 0, 0);

        // Build RRULE for monthly recurrence
        const monthDays = request.days.map(day => parseInt(day, 10)).filter(day => !isNaN(day) && day >= 1 && day <= 31);
        rrule = `RRULE:FREQ=MONTHLY;BYMONTHDAY=${monthDays.join(',')}`;

      } else if (request.recurrence === 'daily') {
        // Daily recurrence
        const [startHour, startMinute] = request.startTime.split(':').map(Number);
        startDate.setHours(startHour, startMinute, 0, 0);
        rrule = 'RRULE:FREQ=DAILY';

      } else {
        // Weekly recurrence (default): days are day names
        // Find the NEAREST day from the requested days (not just the first one)
        const today = new Date();
        const currentDayIndex = today.getDay();

        // Map all requested days to their indices and find nearest occurrence
        const dayIndices = request.days.map(day => this.getDayIndex(day));
        let nearestDayIndex = -1;
        let daysToAdd = 7; // Max days to look ahead

        // Find the nearest day (including today if it's one of the requested days)
        for (let i = 0; i <= 6; i++) {
          const checkDayIndex = (currentDayIndex + i) % 7;
          if (dayIndices.includes(checkDayIndex)) {
            nearestDayIndex = checkDayIndex;
            daysToAdd = i;
            break;
          }
        }

        // If no day found (shouldn't happen), fall back to first day
        if (nearestDayIndex === -1) {
          nearestDayIndex = dayIndices[0];
          daysToAdd = 0;
          while (startDate.getDay() !== nearestDayIndex) {
            startDate.setDate(startDate.getDate() + 1);
            daysToAdd++;
          }
        } else {
          // Set to the nearest day
          startDate.setDate(startDate.getDate() + daysToAdd);
        }

        // Log which day we're starting from
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        this.logger.info(`📅 Starting recurring event from ${dayNames[nearestDayIndex]} (${startDate.toDateString()}), days to add: ${daysToAdd}`);

        // Set the start time
        const [startHour, startMinute] = request.startTime.split(':').map(Number);
        startDate.setHours(startHour, startMinute, 0, 0);

        // Build RRULE for weekly recurrence
        const dayAbbreviations = request.days.map(day => this.getDayAbbreviation(day));
        rrule = `RRULE:FREQ=WEEKLY;BYDAY=${dayAbbreviations.join(',')}`;
      }

      // Set the end time
      const endDate = new Date(startDate);
      const [endHour, endMinute] = request.endTime.split(':').map(Number);
      endDate.setHours(endHour, endMinute, 0, 0);

      // Add UNTIL if provided, otherwise default to 1 year from start date
      if (request.until) {
        // Convert until date to UTC and format as YYYYMMDDTHHMMSSZ (RRULE format)
        const untilDate = new Date(request.until);
        const year = untilDate.getUTCFullYear();
        const month = String(untilDate.getUTCMonth() + 1).padStart(2, '0');
        const day = String(untilDate.getUTCDate()).padStart(2, '0');
        const hours = String(untilDate.getUTCHours()).padStart(2, '0');
        const minutes = String(untilDate.getUTCMinutes()).padStart(2, '0');
        const seconds = String(untilDate.getUTCSeconds()).padStart(2, '0');
        const untilFormatted = `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
        rrule += `;UNTIL=${untilFormatted}`;
      } else {
        // Default to 1 year from start date
        const oneYearLater = new Date(startDate);
        oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
        const year = oneYearLater.getUTCFullYear();
        const month = String(oneYearLater.getUTCMonth() + 1).padStart(2, '0');
        const day = String(oneYearLater.getUTCDate()).padStart(2, '0');
        const hours = String(oneYearLater.getUTCHours()).padStart(2, '0');
        const minutes = String(oneYearLater.getUTCMinutes()).padStart(2, '0');
        const seconds = String(oneYearLater.getUTCSeconds()).padStart(2, '0');
        const untilFormatted = `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
        rrule += `;UNTIL=${untilFormatted}`;
      }

      // Create the recurring event
      const event: any = {
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

      if (request.reminders) {
        event.reminders = request.reminders;
      }

      this.logger.info(`Creating recurring event with RRULE: ${rrule}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);
      const response = await calendarClient.events.insert({
        calendarId,
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
          recurringEventId: response.data.id,
          htmlLink: response.data.htmlLink
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
  async getRecurringEventInstances(context: RequestUserContext, recurringEventId: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Getting instances of recurring event: ${recurringEventId}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      const response = await calendarClient.events.instances({
        calendarId,
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
  async truncateRecurringEvent(context: RequestUserContext, eventId: string, until: string): Promise<IResponse> {
    try {
      this.logger.info(`📅 Truncating recurring event: ${eventId} until ${until}`);

      // Get the current event
      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      const eventResponse = await calendarClient.events.get({
        calendarId,
        eventId
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
      const response = await calendarClient.events.patch({
        calendarId,
        eventId,
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
  async checkConflicts(context: RequestUserContext, timeMin: string, timeMax: string): Promise<IResponse> {
    try {
      this.logger.info(`🔍 Checking for conflicts between ${timeMin} and ${timeMax}`);

      const calendarClient = this.buildCalendar(context);
      const calendarId = this.resolveCalendarId(context);

      const response = await calendarClient.events.list({
        calendarId,
        timeMin,
        timeMax,
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
