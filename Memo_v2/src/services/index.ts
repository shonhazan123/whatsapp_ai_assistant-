/**
 * Service Imports from V1
 * 
 * These services are reused from V1 without modification.
 * The V1 services are dynamically loaded at runtime via v1-services.ts
 * to avoid TypeScript rootDir issues.
 */

// ============================================================================
// V1 SERVICE BRIDGE (for runtime access)
// ============================================================================

export {
  clearMockServices, getCalendarService, getConversationWindow, getGmailService, getListService, getSecondBrainService, getTaskService, getUserService, setMockService
} from './v1-services.js';

// ============================================================================
// PLACEHOLDER EXPORTS (for development/testing when V1 not available)
// ============================================================================

/**
 * Placeholder for CalendarService
 * Will be replaced with V1 import
 */
export const CalendarService = {
  // Stub methods for development
  async getEvents(userId: string, options: any) {
    console.log('[STUB] CalendarService.getEvents', userId, options);
    return [];
  },
  async createEvent(userId: string, event: any) {
    console.log('[STUB] CalendarService.createEvent', userId, event);
    return { id: 'stub-event-id', ...event };
  },
  async updateEvent(userId: string, eventId: string, updates: any) {
    console.log('[STUB] CalendarService.updateEvent', userId, eventId, updates);
    return { id: eventId, ...updates };
  },
  async deleteEvent(userId: string, eventId: string) {
    console.log('[STUB] CalendarService.deleteEvent', userId, eventId);
    return true;
  },
};

/**
 * Placeholder for TaskService
 * Will be replaced with V1 import
 */
export const TaskService = {
  async getTasks(userId: string, options: any) {
    console.log('[STUB] TaskService.getTasks', userId, options);
    return [];
  },
  async createTask(userId: string, task: any) {
    console.log('[STUB] TaskService.createTask', userId, task);
    return { id: 'stub-task-id', ...task };
  },
  async updateTask(userId: string, taskId: string, updates: any) {
    console.log('[STUB] TaskService.updateTask', userId, taskId, updates);
    return { id: taskId, ...updates };
  },
  async deleteTask(userId: string, taskId: string) {
    console.log('[STUB] TaskService.deleteTask', userId, taskId);
    return true;
  },
  async completeTask(userId: string, taskId: string) {
    console.log('[STUB] TaskService.completeTask', userId, taskId);
    return { id: taskId, completed: true };
  },
};

/**
 * Placeholder for ListService
 * Will be replaced with V1 import
 */
export const ListService = {
  async getLists(userId: string) {
    console.log('[STUB] ListService.getLists', userId);
    return [];
  },
  async createList(userId: string, list: any) {
    console.log('[STUB] ListService.createList', userId, list);
    return { id: 'stub-list-id', ...list };
  },
  async updateList(userId: string, listId: string, updates: any) {
    console.log('[STUB] ListService.updateList', userId, listId, updates);
    return { id: listId, ...updates };
  },
  async deleteList(userId: string, listId: string) {
    console.log('[STUB] ListService.deleteList', userId, listId);
    return true;
  },
};

/**
 * Placeholder for GmailService
 * Will be replaced with V1 import
 */
export const GmailService = {
  async searchEmails(userId: string, query: string) {
    console.log('[STUB] GmailService.searchEmails', userId, query);
    return [];
  },
  async draftEmail(userId: string, email: any) {
    console.log('[STUB] GmailService.draftEmail', userId, email);
    return { id: 'stub-draft-id', ...email };
  },
  async sendEmail(userId: string, email: any) {
    console.log('[STUB] GmailService.sendEmail', userId, email);
    return { id: 'stub-email-id', ...email };
  },
};

/**
 * Placeholder for SecondBrainService
 * Will be replaced with V1 import
 */
export const SecondBrainService = {
  async storeNote(userId: string, note: any) {
    console.log('[STUB] SecondBrainService.storeNote', userId, note);
    return { id: 'stub-note-id', ...note };
  },
  async searchNotes(userId: string, query: string) {
    console.log('[STUB] SecondBrainService.searchNotes', userId, query);
    return [];
  },
  async getUserSummary(userId: string) {
    console.log('[STUB] SecondBrainService.getUserSummary', userId);
    return undefined;
  },
};

