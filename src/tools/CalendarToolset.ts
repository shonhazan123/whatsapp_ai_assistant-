import { IToolset, ToolResult } from '../types/interfaces';
import { CalendarService } from '../services/calendar/CalendarService';
import { logger } from '../utils/logger';
import { EventSchema, RecurringEventSchema } from '../types/schema';

/**
 * CalendarToolset - Clean CRUD operations for Google Calendar
 * No LLM, just pure Calendar API operations
 */
export class CalendarToolset implements IToolset {
  name = 'CalendarToolset';
  description = 'Handles all Google Calendar operations including recurring events';

  private calendarService: CalendarService;

  constructor(calendarId?: string) {
    // CalendarService constructor only accepts optional logger parameter
    // calendarId is resolved internally via resolveCalendarId() method
    this.calendarService = new CalendarService(logger);
  }

  async execute(operation: string, params: any): Promise<ToolResult> {
    try {
      logger.info(`📅 CalendarToolset.${operation}`, { params });

      switch (operation) {
        case 'event.create':
          return await this.createEvent(params);
        case 'event.createMultiple':
          return await this.createMultipleEvents(params);
        case 'event.createRecurring':
          return await this.createRecurringEvent(params);
        case 'event.getAll':
          return await this.getEvents(params);
        case 'event.getById':
          return await this.getEventById(params);
        case 'event.update':
          return await this.updateEvent(params);
        case 'event.updateMultiple':
          return await this.updateMultipleEvents(params);
        case 'event.delete':
          return await this.deleteEvent(params);
        case 'event.deleteBySummary':
          return await this.deleteEventsBySummary(params);
        case 'event.deleteMultiple':
          return await this.deleteMultipleEvents(params);
        case 'event.checkConflicts':
          return await this.checkConflicts(params);
        case 'event.findFreeSlots':
          return await this.findFreeSlots(params);
        case 'event.truncateRecurring':
          return await this.truncateRecurring(params);
        
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`
          };
      }
    } catch (error) {
      logger.error(`CalendarToolset error in ${operation}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async createEvent(params: any): Promise<ToolResult> {
    const response = await this.calendarService.createEvent(params);
    return this.toToolResult(response);
  }

  private async createMultipleEvents(params: any): Promise<ToolResult> {
    const response = await this.calendarService.createMultipleEvents({
      events: params.events
    });
    return this.toToolResult(response);
  }

  private async createRecurringEvent(params: any): Promise<ToolResult> {
    const validated = RecurringEventSchema.parse(params);
    const recurringParams = {
      ...validated,
      recurrence: 'weekly' as const // Default to weekly
    };
    const response = await this.calendarService.createRecurringEvent(recurringParams);
    return this.toToolResult(response);
  }

  private async getEvents(params: any): Promise<ToolResult> {
    const response = await this.calendarService.getEvents({
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      calendarId: params.calendarId
    });
    return this.toToolResult(response);
  }

  private async getEventById(params: any): Promise<ToolResult> {
    const response = await this.calendarService.getEventById(params.eventId);
    return this.toToolResult(response);
  }

  private async updateEvent(params: any): Promise<ToolResult> {
    const response = await this.calendarService.updateEvent({
      eventId: params.eventId,
      ...params.updates
    });
    return this.toToolResult(response);
  }

  private async updateMultipleEvents(params: any): Promise<ToolResult> {
    const results = [];
    const errors = [];

    for (const item of params.items) {
      try {
        const response = await this.calendarService.updateEvent({
          eventId: item.eventId,
          ...item.updates
        });
        if (response.success) {
          results.push(response.data);
        } else {
          errors.push({ eventId: item.eventId, error: response.message });
        }
      } catch (error) {
        errors.push({ eventId: item.eventId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return {
      success: results.length > 0,
      data: { updated: results, errors },
      message: `Updated ${results.length} events${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    };
  }

  private async deleteEvent(params: any): Promise<ToolResult> {
    const response = await this.calendarService.deleteEvent(params.eventId);
    return this.toToolResult(response);
  }

  private async deleteEventsBySummary(params: any): Promise<ToolResult> {
    // Find events by summary then delete them
    try {
      const now = new Date();
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      
      const eventsResponse = await this.calendarService.getEvents({
        timeMin: now.toISOString(),
        timeMax: future.toISOString()
      });

      if (!eventsResponse.success || !eventsResponse.data) {
        return { success: false, error: 'Could not fetch events' };
      }

      const matchingEvents = eventsResponse.data.filter((e: any) => 
        e.summary && e.summary.toLowerCase().includes(params.summary.toLowerCase())
      );

      if (matchingEvents.length === 0) {
        return { success: false, error: 'No matching events found' };
      }

      // Delete all matching events
      const deletePromises = matchingEvents.map((e: any) => 
        this.calendarService.deleteEvent(e.id)
      );

      await Promise.all(deletePromises);

      return {
        success: true,
        message: `Deleted ${matchingEvents.length} events`,
        data: { deleted: matchingEvents.length }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async deleteMultipleEvents(params: any): Promise<ToolResult> {
    const results = [];
    const errors = [];

    for (const eventId of params.eventIds) {
      try {
        const response = await this.calendarService.deleteEvent(eventId);
        if (response.success) {
          results.push(eventId);
        } else {
          errors.push({ eventId, error: response.message });
        }
      } catch (error) {
        errors.push({ eventId, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return {
      success: results.length > 0,
      data: { deleted: results, errors },
      message: `Deleted ${results.length} events${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    };
  }

  private async checkConflicts(params: any): Promise<ToolResult> {
    const response = await this.calendarService.checkConflicts(params.start, params.end);
    return this.toToolResult(response);
  }

  private async findFreeSlots(params: any): Promise<ToolResult> {
    // Placeholder - implement free slot finding logic
    return {
      success: true,
      message: 'Free slot finding not yet implemented',
      data: []
    };
  }

  private async truncateRecurring(params: any): Promise<ToolResult> {
    const response = await this.calendarService.truncateRecurringEvent(params.eventId, params.until);
    return this.toToolResult(response);
  }

  private toToolResult(serviceResponse: any): ToolResult {
    return {
      success: serviceResponse.success,
      data: serviceResponse.data,
      error: serviceResponse.message && !serviceResponse.success ? serviceResponse.message : undefined,
      message: serviceResponse.message
    };
  }
}

