/**
 * V1 Services Bridge
 * 
 * This file provides access to V1 services for use in Memo V2.
 * We use dynamic require to avoid TypeScript rootDir issues.
 * 
 * In test environments, returns mock services that can be configured.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

// Check if we're in a test environment
const isTestEnvironment = process.env.NODE_ENV === 'test' || 
  process.env.VITEST === 'true' || 
  typeof (globalThis as any).vi !== 'undefined';

// V1 Services - loaded dynamically to avoid TypeScript issues
// These are used by the adapters to call actual V1 implementations

let _TaskService: any;
let _ListService: any;
let _CalendarService: any;
let _GmailService: any;
let _SecondBrainService: any;
let _UserService: any;
let _ConversationWindow: any;

// Mock services for testing
const mockServices: Record<string, any> = {};

export function setMockService(name: string, service: any): void {
  mockServices[name] = service;
}

export function clearMockServices(): void {
  Object.keys(mockServices).forEach(key => delete mockServices[key]);
}

function getV1Module(path: string): any {
  // In test environment, return null (adapters will handle gracefully)
  if (isTestEnvironment) {
    return null;
  }
  
  try {
    // Use require to dynamically load V1 modules
    return require(path);
  } catch (error) {
    console.error(`[V1Services] Failed to load module: ${path}`, error);
    return null;
  }
}

export function getTaskService(): any {
  // Check for mock service first (for testing)
  if (mockServices.TaskService) {
    return mockServices.TaskService;
  }
  
  if (!_TaskService) {
    const module = getV1Module('../../../src/services/database/TaskService');
    _TaskService = module?.TaskService;
  }
  return _TaskService ? new _TaskService() : null;
}

export function getListService(): any {
  // Check for mock service first (for testing)
  if (mockServices.ListService) {
    return mockServices.ListService;
  }
  
  if (!_ListService) {
    const module = getV1Module('../../../src/services/database/ListService');
    _ListService = module?.ListService;
  }
  return _ListService ? new _ListService() : null;
}

export function getCalendarService(): any {
  // Check for mock service first (for testing)
  if (mockServices.CalendarService) {
    return mockServices.CalendarService;
  }
  
  if (!_CalendarService) {
    const module = getV1Module('../../../src/services/calendar/CalendarService');
    _CalendarService = module?.CalendarService;
  }
  return _CalendarService ? new _CalendarService() : null;
}

export function getGmailService(): any {
  // Check for mock service first (for testing)
  if (mockServices.GmailService) {
    return mockServices.GmailService;
  }
  
  if (!_GmailService) {
    const module = getV1Module('../../../src/services/email/GmailService');
    _GmailService = module?.GmailService;
  }
  return _GmailService ? new _GmailService() : null;
}

export function getSecondBrainService(): any {
  // Check for mock service first (for testing)
  if (mockServices.SecondBrainService) {
    return mockServices.SecondBrainService;
  }
  
  if (!_SecondBrainService) {
    const module = getV1Module('../../../src/services/memory/SecondBrainService');
    _SecondBrainService = module?.SecondBrainService;
  }
  return _SecondBrainService ? new _SecondBrainService() : null;
}

export function getUserService(): any {
  // Check for mock service first (for testing)
  if (mockServices.UserService) {
    return mockServices.UserService;
  }
  
  if (!_UserService) {
    const module = getV1Module('../../../src/services/database/UserService');
    _UserService = module?.UserService;
  }
  return _UserService ? new _UserService() : null;
}

export function getConversationWindow(): any {
  // Check for mock service first (for testing)
  if (mockServices.ConversationWindow) {
    return mockServices.ConversationWindow;
  }
  
  if (!_ConversationWindow) {
    const module = getV1Module('../../../src/core/memory/ConversationWindow');
    _ConversationWindow = module?.ConversationWindow?.getInstance?.();
  }
  return _ConversationWindow;
}

// Re-export types that we need (these are just for documentation)
export interface V1TaskService {
  create(request: any): Promise<any>;
  createMultiple(request: any): Promise<any>;
  get(request: any): Promise<any>;
  getAll(request: any): Promise<any>;
  update(request: any): Promise<any>;
  delete(request: any): Promise<any>;
  addSubtask(request: any): Promise<any>;
}

export interface V1ListService {
  create(request: any): Promise<any>;
  getAll(request: any): Promise<any>;
  update(request: any): Promise<any>;
  delete(request: any): Promise<any>;
  addItem(request: any): Promise<any>;
  toggleItem(request: any): Promise<any>;
  deleteItem(request: any): Promise<any>;
}

export interface V1CalendarService {
  createEvent(request: any): Promise<any>;
  createMultipleEvents(request: any): Promise<any>;
  createRecurringEvent(request: any): Promise<any>;
  getEvents(request: any): Promise<any>;
  updateEvent(request: any): Promise<any>;
  deleteEvent(eventId: string): Promise<any>;
  checkConflicts(start: string, end: string): Promise<any>;
}

export interface V1GmailService {
  listEmails(options: any): Promise<any>;
  getEmailById(messageId: string, options: any): Promise<any>;
  sendEmail(request: any, options?: any): Promise<any>;
  replyToEmail(request: any): Promise<any>;
}

export interface V1SecondBrainService {
  embedText(text: string): Promise<number[]>;
  insertOrMergeMemory(userId: string, text: string, embedding: number[], metadata?: any): Promise<any>;
  searchMemory(userId: string, query: string, limit?: number): Promise<any>;
}

export interface V1UserService {
  findByWhatsappNumber(phone: string): Promise<any>;
}

