/**
 * V1 Services Bridge
 * 
 * This file provides access to V1 services for use in Memo V2.
 * All services are initialized ONCE at program launch via initializeServices().
 * 
 * Key features:
 * - Eager initialization at startup (not lazy)
 * - Singleton pattern (same instance reused)
 * - Pre-loads src/utils/logger to avoid TDZ issues
 * - Fail-fast: errors surface at startup, not during execution
 * 
 * NOTE: Memory/ConversationWindow is now handled by Memo_v2's own MemoryService.
 * See services/memory/ for the new memory implementation.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import { logger } from '../utils/logger.js';

// ============================================================================
// SERVICE INSTANCES (Singleton Pattern)
// ============================================================================

let _calendarService: any = null;
let _gmailService: any = null;
let _taskService: any = null;
let _listService: any = null;
let _secondBrainService: any = null;
let _userService: any = null;

let _initialized = false;

// ============================================================================
// MOCK SERVICES (for testing)
// ============================================================================

const mockServices: Record<string, any> = {};

export function setMockService(name: string, service: any): void {
  mockServices[name] = service;
}

export function clearMockServices(): void {
  Object.keys(mockServices).forEach(key => delete mockServices[key]);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize all V1 services at program launch.
 * MUST be called before any service is used.
 * 
 * Pre-loads src/utils/logger to ensure it's in module cache before
 * loading CalendarService/GmailService (avoids TDZ issues).
 */
export function initializeServices(): void {
  if (_initialized) {
    console.log('[V1Services] Already initialized, skipping');
    return;
  }

  const isTestEnv = process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    typeof (globalThis as any).vi !== 'undefined';

  if (isTestEnv) {
    console.log('[V1Services] Test environment - skipping service initialization');
    _initialized = true;
    return;
  }

  console.log('[V1Services] Initializing all services...');

  try {
    // ========================================================================
    // CRITICAL: Pre-load src/utils/logger FIRST to populate module cache
    // This ensures logger is available when CalendarService/GmailService are parsed
    // (Avoids "Cannot access 'logger' before initialization" TDZ error)
    // ========================================================================
    require('../../../src/utils/logger');
    console.log('[V1Services] ✓ Pre-loaded src/utils/logger');

    // ========================================================================
    // Load and instantiate all services
    // ========================================================================

    // CalendarService
    const calendarModule = require('../../../src/services/calendar/CalendarService');
    if (calendarModule?.CalendarService) {
      _calendarService = new calendarModule.CalendarService(logger);
      console.log('[V1Services] ✓ CalendarService');
    } else {
      console.warn('[V1Services] ⚠ CalendarService not found in module');
    }

    // GmailService
    const gmailModule = require('../../../src/services/email/GmailService');
    if (gmailModule?.GmailService) {
      _gmailService = new gmailModule.GmailService(logger);
      console.log('[V1Services] ✓ GmailService');
    } else {
      console.warn('[V1Services] ⚠ GmailService not found in module');
    }

    // TaskService
    const taskModule = require('../../../src/services/database/TaskService');
    if (taskModule?.TaskService) {
      _taskService = new taskModule.TaskService(logger);
      console.log('[V1Services] ✓ TaskService');
    } else {
      console.warn('[V1Services] ⚠ TaskService not found in module');
    }

    // ListService
    const listModule = require('../../../src/services/database/ListService');
    if (listModule?.ListService) {
      _listService = new listModule.ListService(logger);
      console.log('[V1Services] ✓ ListService');
    } else {
      console.warn('[V1Services] ⚠ ListService not found in module');
    }

    // SecondBrainService
    const sbModule = require('../../../src/services/memory/SecondBrainService');
    if (sbModule?.SecondBrainService) {
      _secondBrainService = new sbModule.SecondBrainService(logger);
      console.log('[V1Services] ✓ SecondBrainService');
    } else {
      console.warn('[V1Services] ⚠ SecondBrainService not found in module');
    }

    // UserService
    const userModule = require('../../../src/services/database/UserService');
    if (userModule?.UserService) {
      _userService = new userModule.UserService(logger);
      console.log('[V1Services] ✓ UserService');
    } else {
      console.warn('[V1Services] ⚠ UserService not found in module');
    }

    // NOTE: ConversationWindow is now handled by Memo_v2's own MemoryService
    // See: Memo_v2/src/services/memory/

    _initialized = true;
    console.log('[V1Services] ✅ All services initialized successfully');

  } catch (error) {
    console.error('[V1Services] ❌ FATAL: Failed to initialize services:', error);
    throw error; // Fail fast at startup
  }
}

/**
 * Check if services have been initialized
 */
export function isInitialized(): boolean {
  return _initialized;
}

// ============================================================================
// SERVICE GETTERS (return pre-initialized singleton instances)
// ============================================================================

export function getCalendarService(): any {
  if (mockServices.CalendarService) {
    return mockServices.CalendarService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getCalendarService called before initialization!');
  }
  return _calendarService;
}

export function getGmailService(): any {
  if (mockServices.GmailService) {
    return mockServices.GmailService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getGmailService called before initialization!');
  }
  return _gmailService;
}

export function getTaskService(): any {
  if (mockServices.TaskService) {
    return mockServices.TaskService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getTaskService called before initialization!');
  }
  return _taskService;
}

export function getListService(): any {
  if (mockServices.ListService) {
    return mockServices.ListService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getListService called before initialization!');
  }
  return _listService;
}

export function getSecondBrainService(): any {
  if (mockServices.SecondBrainService) {
    return mockServices.SecondBrainService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getSecondBrainService called before initialization!');
  }
  return _secondBrainService;
}

export function getUserService(): any {
  if (mockServices.UserService) {
    return mockServices.UserService;
  }
  if (!_initialized) {
    console.warn('[V1Services] getUserService called before initialization!');
  }
  return _userService;
}

// ============================================================================
// TYPE INTERFACES (documentation only)
// ============================================================================

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
