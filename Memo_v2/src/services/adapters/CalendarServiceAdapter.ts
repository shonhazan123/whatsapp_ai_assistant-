/**
 * CalendarServiceAdapter
 * 
 * Adapter for V1 CalendarService.
 * Converts resolver args (calendarOperations) into CalendarService method calls.
 */

import { getCalendarService } from '../v1-services.js';
import { UserService } from '../../legacy/services/database/UserService.js';
import type { UserContext } from '../../types/index.js';
import type { RequestUserContext } from '../../legacy/types/UserContext.js';

export interface CalendarReminders {
  useDefault: boolean;
  overrides?: Array<{ method: string; minutes: number }>;
}

export interface CalendarOperationArgs {
  operation: string;
  eventId?: string;
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
  attendees?: string[];
  reminderMinutesBefore?: number;
  allDay?: boolean;
  timeMin?: string;
  timeMax?: string;
  excludeSummaries?: string[];
  searchCriteria?: {
    summary?: string;
    timeMin?: string;
    timeMax?: string;
  };
  updateFields?: {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
  };
  // For recurring
  startTime?: string;
  endTime?: string;
  days?: string[];
  until?: string;
  // For multiple events
  events?: any[];
  recurringEvents?: any[];
  language?: 'he' | 'en';
  // For bulk operations (deleteByWindow, updateByWindow)
  eventIds?: string[];
  deletedSummaries?: string[];
  originalEvents?: any[];
  // For recurring series operations
  isRecurringSeries?: boolean;      // True when operating on entire series
  recurringSeriesIntent?: boolean;  // From LLM resolver - user's explicit intent
}

export interface CalendarOperationResult {
  success: boolean;
  data?: any;
  error?: string;
  calendarLink?: string;
}

export class CalendarServiceAdapter {
  private userPhone: string;
  private userContext: UserContext;
  private userService: UserService;

  constructor(userPhone: string, userContext: UserContext) {
    this.userPhone = userPhone;
    this.userContext = userContext;
    this.userService = new UserService();
  }

  /**
   * Build RequestUserContext from MemoState user context
   */
  private async buildRequestContext(): Promise<RequestUserContext> {
    const userRecord = await this.userService.findByWhatsappNumber(this.userPhone);
    if (!userRecord) {
      throw new Error(`User not found: ${this.userPhone}`);
    }

    const googleTokens = await this.userService.getGoogleTokens(userRecord.id);

    return {
      user: userRecord,
      planType: userRecord.plan_type,
      whatsappNumber: this.userPhone,
      capabilities: {
        database: this.userContext.capabilities.database,
        calendar: this.userContext.capabilities.calendar,
        gmail: this.userContext.capabilities.gmail,
      },
      googleTokens: googleTokens,
      googleConnected: this.userContext.googleConnected,
    };
  }

  /**
   * Execute a calendar operation
   */
  async execute(args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const { operation } = args;
    const calendarService = getCalendarService();

    if (!calendarService) {
      return { success: false, error: 'CalendarService not available' };
    }

    // Build context from state
    const context = await this.buildRequestContext();

    try {
      switch (operation) {
        case 'create':
          return await this.createEvent(calendarService, context, args);

        case 'createMultiple':
          return await this.createMultipleEvents(calendarService, context, args);

        case 'createRecurring':
          return await this.createRecurringEvent(calendarService, context, args);

        case 'get':
          return await this.getEvent(calendarService, context, args);

        case 'getEvents':
          return await this.getEvents(calendarService, context, args);

        case 'update':
          return await this.updateEvent(calendarService, context, args);

        case 'delete':
          return await this.deleteEvent(calendarService, context, args);

        case 'deleteByWindow':
          return await this.deleteByWindow(calendarService, context, args);

        case 'updateByWindow':
          return await this.updateByWindow(calendarService, context, args);

        case 'checkConflicts':
          return await this.checkConflicts(calendarService, context, args);

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      console.error(`[CalendarServiceAdapter] Error in ${operation}:`, error);
      return { success: false, error: error.message || String(error) };
    }
  }

  // ========================================================================
  // OPERATION IMPLEMENTATIONS
  // ========================================================================

  private async createEvent(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    // Build reminders if specified
    let reminders: CalendarReminders | undefined;
    if (args.reminderMinutesBefore !== undefined) {
      reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: args.reminderMinutesBefore }]
      };
    }

    const result = await calendarService.createEvent(context, {
      summary: args.summary || '',
      start: args.start || '',
      end: args.end || '',
      description: args.description,
      location: args.location,
      attendees: args.attendees,
      reminders,
      allDay: args.allDay,
    });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      calendarLink: result.data?.htmlLink,
    };
  }

  private async createMultipleEvents(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const events = (args.events || []).map((e: any) => ({
      summary: e.summary,
      start: e.start,
      end: e.end,
      description: e.description,
      location: e.location,
      attendees: e.attendees,
      allDay: e.allDay,
    }));

    const result = await calendarService.createMultipleEvents(context, { events });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  private async createRecurringEvent(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    // Build reminders if specified
    let reminders: CalendarReminders | undefined;
    if (args.reminderMinutesBefore !== undefined) {
      reminders = {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: args.reminderMinutesBefore }]
      };
    }

    // Determine recurrence type based on days pattern
    let recurrence: 'weekly' | 'daily' | 'monthly' = 'weekly';
    if (args.days?.length === 1 && /^\d+$/.test(args.days[0])) {
      recurrence = 'monthly';
    }

    const result = await calendarService.createRecurringEvent(context, {
      summary: args.summary || '',
      startTime: args.startTime || args.start || '',
      endTime: args.endTime || args.end || '',
      days: args.days || [],
      recurrence,
      description: args.description,
      location: args.location,
      until: args.until,
      reminders,
    });

    // Include original request parameters for response formatting
    return {
      success: result.success,
      data: {
        ...result.data,
        // Original request parameters (preserved for response formatting)
        days: args.days || [],
        startTime: args.startTime || args.start || '',
        endTime: args.endTime || args.end || '',
        recurrence: recurrence,
      },
      error: result.error,
    };
  }

  private async getEvent(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    // Get events in a time range and filter by summary if provided
    const timeMin = args.timeMin || new Date().toISOString();
    const timeMax = args.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const result = await calendarService.getEvents({
      timeMin,
      timeMax,
    });

    if (result.success && args.summary && result.data?.events) {
      // Filter by summary
      const filtered = result.data.events.filter((e: any) =>
        e.summary?.toLowerCase().includes(args.summary!.toLowerCase())
      );
      return {
        success: true,
        data: { events: filtered },
      };
    }

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  private async getEvents(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const result = await calendarService.getEvents({
      timeMin: args.timeMin || new Date().toISOString(),
      timeMax: args.timeMax || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Apply excludeSummaries filter if provided
    if (result.success && args.excludeSummaries && result.data?.events) {
      const filtered = result.data.events.filter((e: any) =>
        !args.excludeSummaries!.some(exclude =>
          e.summary?.toLowerCase().includes(exclude.toLowerCase())
        )
      );
      return {
        success: true,
        data: { ...result.data, events: filtered },
      };
    }

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  private async updateEvent(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    // If using searchCriteria, first find the event
    let eventId = args.eventId;
    const isRecurringSeries = args.isRecurringSeries || false;

    if (!eventId && args.searchCriteria?.summary) {
      const searchResult = await this.getEvent(calendarService, context, {
        operation: 'get',
        summary: args.searchCriteria.summary,
        timeMin: args.searchCriteria.timeMin,
        timeMax: args.searchCriteria.timeMax,
      });

      if (searchResult.success && searchResult.data?.events?.length > 0) {
        eventId = searchResult.data.events[0].id;
      } else {
        return { success: false, error: `Event not found: ${args.searchCriteria.summary}` };
      }
    }

    if (!eventId) {
      return { success: false, error: 'Event ID is required for update' };
    }

    const updateFields = args.updateFields || {};

    // Check if we should update the entire recurring series
    if (isRecurringSeries) {
      console.log(`[CalendarServiceAdapter] Updating recurring series: ${eventId}`);
      const result = await calendarService.updateRecurringSeries(context, eventId, updateFields);
      return {
        success: result.success,
        data: {
          ...result.data,
          isRecurringSeries: true,
        },
        error: result.error,
      };
    }

    // Update single event (or single instance of recurring)
        const result = await calendarService.updateEvent(context, {
      eventId,
      summary: updateFields.summary,
      start: updateFields.start,
      end: updateFields.end,
      description: updateFields.description,
      location: updateFields.location,
    });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  private async deleteEvent(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    let eventId = args.eventId;
    let fetchedEvent: any = null;
    const isRecurringSeries = args.isRecurringSeries || false;

    // If no eventId but have summary, find the event first
    if (!eventId && args.summary) {
      const searchResult = await this.getEvent(calendarService, context, {
        operation: 'get',
        summary: args.summary,
        timeMin: args.timeMin,
        timeMax: args.timeMax,
      });

      if (searchResult.success && searchResult.data?.events?.length > 0) {
        fetchedEvent = searchResult.data.events[0];
        eventId = fetchedEvent.id;
      } else {
        return { success: false, error: `Event not found: ${args.summary}` };
      }
    }

    if (!eventId) {
      return { success: false, error: 'Event ID is required for delete' };
    }

    // Check if we should delete the entire recurring series
    if (isRecurringSeries) {
      console.log(`[CalendarServiceAdapter] Deleting recurring series: ${eventId}`);
      const result = await calendarService.deleteRecurringSeries(context, eventId);
      return {
        success: result.success,
        data: {
          ...result.data,
          isRecurringSeries: true,
        },
        error: result.error,
      };
    }

    // Delete single event (or single instance of recurring)
    const result = await calendarService.deleteEvent(eventId);

    // Include event data for response formatting
    // Priority: fetchedEvent (from search) > args (from entity resolver)
    return {
      success: result.success,
      data: {
        ...result.data,
        // Include event details for response formatting
        summary: fetchedEvent?.summary || args.summary,
        start: fetchedEvent?.start?.dateTime || fetchedEvent?.start?.date || args.start,
        end: fetchedEvent?.end?.dateTime || fetchedEvent?.end?.date || args.end,
      },
      error: result.error,
    };
  }

  /**
   * Delete all events in a time window
   * Bulk operation with resolved eventIds from EntityResolver
   */
  private async deleteByWindow(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const eventIds = args.eventIds || [];
    const originalEvents = args.originalEvents || [];

    if (eventIds.length === 0) {
      return { success: false, error: 'No events to delete' };
    }

    console.log(`[CalendarServiceAdapter] deleteByWindow: Deleting ${eventIds.length} events`);

    // Build a map of master event ID to event data for quick lookup
    const eventMap = new Map<string, any>();
    originalEvents.forEach((event: any) => {
      const masterId = event.recurringEventId || event.id;
      if (masterId && !eventMap.has(masterId)) {
        eventMap.set(masterId, event);
      }
    });

    const deleted: string[] = [];
    const errors: Array<{ eventId: string; error: string }> = [];

    for (const eventId of eventIds) {
      try {
        const result = await calendarService.deleteEvent(context, eventId);
        if (result.success) {
          deleted.push(eventId);
        } else {
          errors.push({ eventId, error: result.error || 'Unknown error' });
        }
      } catch (error: any) {
        errors.push({ eventId, error: error.message || String(error) });
      }
    }

    console.log(`[CalendarServiceAdapter] deleteByWindow: Deleted ${deleted.length}, errors: ${errors.length}`);

    // Map deleted eventIds to their corresponding event data
    const events = deleted.map(id => {
      const event = eventMap.get(id);
      if (event) {
        return {
          id: event.id,
          summary: event.summary || 'Untitled Event',
          start: event.start?.dateTime || event.start?.date,
          end: event.end?.dateTime || event.end?.date,
        };
      }
      return null;
    }).filter((e): e is NonNullable<typeof e> => e !== null);

    return {
      success: deleted.length > 0,
      data: {
        deleted: deleted.length,
        eventIds: deleted,
        summaries: args.deletedSummaries,
        events: events.length > 0 ? events : undefined,
        errors: errors.length > 0 ? errors : undefined,
      },
      error: errors.length > 0 ? `Failed to delete ${errors.length} events` : undefined,
    };
  }

  /**
   * Update all events in a time window
   * Bulk operation with resolved eventIds from EntityResolver
   */
  private async updateByWindow(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const eventIds = args.eventIds || [];
    const updateFields = args.updateFields || {};
    const originalEvents = args.originalEvents || [];

    if (eventIds.length === 0) {
      return { success: false, error: 'No events to update' };
    }

    console.log(`[CalendarServiceAdapter] updateByWindow: Updating ${eventIds.length} events`);

    const updated: any[] = [];
    const errors: Array<{ eventId: string; error: string }> = [];

    for (let i = 0; i < eventIds.length; i++) {
      const eventId = eventIds[i];
      const originalEvent = originalEvents[i];

      try {
        // Calculate new start/end based on original event duration
        const calculatedUpdate = this.calculateUpdatedTimes(originalEvent, updateFields);

        const result = await calendarService.updateEvent(context, {
          eventId,
          ...calculatedUpdate,
        });

        if (result.success) {
          updated.push(result.data || { id: eventId });
        } else {
          errors.push({ eventId, error: result.error || 'Unknown error' });
        }
      } catch (error: any) {
        errors.push({ eventId, error: error.message || String(error) });
      }
    }

    console.log(`[CalendarServiceAdapter] updateByWindow: Updated ${updated.length}, errors: ${errors.length}`);

    return {
      success: updated.length > 0,
      data: {
        updated: updated.length,
        events: updated,
        errors: errors.length > 0 ? errors : undefined,
      },
      error: errors.length > 0 ? `Failed to update ${errors.length} events` : undefined,
    };
  }

  /**
   * Calculate updated times for bulk update
   * Preserves original event duration and time-of-day when moving to a new date
   */
  private calculateUpdatedTimes(originalEvent: any, updateFields: any): any {
    // If both start and end provided, use them directly
    if (updateFields.start && updateFields.end) {
      return updateFields;
    }

    // If only new date provided, preserve original time-of-day and duration
    if (updateFields.start && originalEvent) {
      const origStartStr = originalEvent.start?.dateTime || originalEvent.start?.date || originalEvent.start;
      const origEndStr = originalEvent.end?.dateTime || originalEvent.end?.date || originalEvent.end;

      if (origStartStr && origEndStr) {
        const origStart = new Date(origStartStr);
        const origEnd = new Date(origEndStr);
        const duration = origEnd.getTime() - origStart.getTime();

        const newStart = new Date(updateFields.start);
        // Preserve original time-of-day
        newStart.setHours(origStart.getHours(), origStart.getMinutes(), origStart.getSeconds(), 0);
        const newEnd = new Date(newStart.getTime() + duration);

        return {
          ...updateFields,
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
        };
      }
    }

    return updateFields;
  }

  private async checkConflicts(calendarService: any, context: RequestUserContext, args: CalendarOperationArgs): Promise<CalendarOperationResult> {
    const result = await calendarService.checkConflicts(context,
      args.timeMin || args.start || '',
      args.timeMax || args.end || ''
    );

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
}
