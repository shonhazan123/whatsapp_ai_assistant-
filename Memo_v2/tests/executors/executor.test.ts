/**
 * Executor Tests
 * 
 * Tests for all executor implementations
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { CalendarExecutor } from '../../src/graph/executors/CalendarExecutor.js';
import { DatabaseExecutor } from '../../src/graph/executors/DatabaseExecutor.js';
import { GmailExecutor } from '../../src/graph/executors/GmailExecutor.js';
import { SecondBrainExecutor } from '../../src/graph/executors/SecondBrainExecutor.js';
import { GeneralExecutor, MetaExecutor } from '../../src/graph/executors/GeneralExecutor.js';
import type { ExecutorContext } from '../../src/graph/executors/BaseExecutor.js';
import { setMockService, clearMockServices } from '../../src/services/v1-services.js';

const mockContext: ExecutorContext = {
  userPhone: '+972501234567',
  timezone: 'Asia/Jerusalem',
  language: 'he',
};

// ============================================================================
// MOCK SERVICES
// ============================================================================

const mockCalendarService = {
  createEvent: async (request: any) => ({
    success: true,
    data: { id: 'event-' + Date.now(), summary: request.summary, start: request.start, end: request.end },
  }),
  createMultipleEvents: async (request: any) => ({
    success: true,
    data: { created: request.events, count: request.events?.length || 0 },
  }),
  createRecurringEvent: async (request: any) => ({
    success: true,
    data: { id: 'recurring-' + Date.now(), summary: request.summary, days: request.days },
  }),
  getEvents: async (request: any) => ({
    success: true,
    data: { events: [{ id: 'e1', summary: 'Test Event' }], timeMin: request.timeMin, timeMax: request.timeMax },
  }),
  updateEvent: async (request: any) => ({
    success: true,
    data: { updated: true, eventId: request.eventId },
  }),
  deleteEvent: async (eventId: string) => ({
    success: true,
    data: { deleted: true, eventId },
  }),
  checkConflicts: async (start: string, end: string) => ({
    success: true,
    data: { hasConflicts: false, start, end },
  }),
};

const mockTaskService = {
  create: async (request: any) => ({
    success: true,
    data: { id: 'task-' + Date.now(), text: request.data?.text, category: request.data?.category },
  }),
  getAll: async (request: any) => ({
    success: true,
    data: [
      { id: 'task-1', text: 'Test task 1' },
      { id: 'task-2', text: 'Test task 2' },
    ],
  }),
  update: async (request: any) => ({
    success: true,
    data: { id: request.id, updated: true },
  }),
  delete: async (request: any) => ({
    success: true,
    data: { id: request.id, deleted: true },
  }),
  addSubtask: async (request: any) => ({
    success: true,
    data: { taskId: request.data?.taskId, subtaskText: request.data?.text },
  }),
};

const mockListService = {
  create: async (request: any) => ({
    success: true,
    data: { id: 'list-' + Date.now(), listName: request.data?.listName },
  }),
  getAll: async (request: any) => ({
    success: true,
    data: [{ id: 'list-1', list_name: 'Test list' }],
  }),
  update: async (request: any) => ({
    success: true,
    data: { id: request.id, updated: true },
  }),
  delete: async (request: any) => ({
    success: true,
    data: { id: request.id, deleted: true },
  }),
  addItem: async (request: any) => ({
    success: true,
    data: { listName: request.data?.listName, item: request.data?.item },
  }),
  toggleItem: async (request: any) => ({
    success: true,
    data: { toggled: true, itemIndex: request.data?.itemIndex },
  }),
  deleteItem: async (request: any) => ({
    success: true,
    data: { deleted: true, itemIndex: request.data?.itemIndex },
  }),
};

const mockGmailService = {
  listEmails: async (options: any) => ({
    success: true,
    data: { emails: [{ id: 'email-1', subject: 'Test email' }], count: 1 },
  }),
  getEmailById: async (messageId: string, options: any) => ({
    success: true,
    data: { id: messageId, subject: 'Test email', body: 'Test body' },
  }),
  sendEmail: async (request: any, options?: any) => ({
    success: true,
    data: { id: 'sent-' + Date.now(), preview: options?.previewOnly || false, to: request.to, subject: request.subject },
  }),
  replyToEmail: async (request: any) => ({
    success: true,
    data: { id: 'reply-' + Date.now(), messageId: request.messageId },
  }),
};

const mockSecondBrainService = {
  embedText: async (text: string) => new Array(1536).fill(0.1),
  insertOrMergeMemory: async (userId: string, text: string, embedding: number[], metadata?: any) => ({
    memory: { id: 'mem-' + Date.now(), text, userId },
    merged: false,
  }),
  searchMemory: async (userId: string, query: string, limit?: number) => [
    { id: 'mem-1', text: 'Matching memory', similarity: 0.95 },
  ],
};

// ============================================================================
// TESTS
// ============================================================================

describe('CalendarExecutor', () => {
  const executor = new CalendarExecutor();
  
  beforeEach(() => {
    clearMockServices();
    setMockService('CalendarService', mockCalendarService);
  });
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('calendar_executor');
    expect(executor.capability).toBe('calendar');
  });
  
  it('should execute create operation', async () => {
    const result = await executor.execute('step-1', {
      operation: 'create',
      summary: 'פגישה עם לקוח',
      start: '2025-01-03T10:00:00Z',
      end: '2025-01-03T11:00:00Z',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.stepId).toBe('step-1');
    expect(result.data).toHaveProperty('id');
    expect(result.data).toHaveProperty('summary', 'פגישה עם לקוח');
  });
  
  it('should execute getEvents operation', async () => {
    const result = await executor.execute('step-2', {
      operation: 'getEvents',
      timeMin: '2025-01-01T00:00:00Z',
      timeMax: '2025-01-07T23:59:59Z',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('events');
    expect(result.data).toHaveProperty('timeMin');
    expect(result.data).toHaveProperty('timeMax');
  });
  
  it('should execute update operation with eventId', async () => {
    const result = await executor.execute('step-3', {
      operation: 'update',
      eventId: 'event-123',
      updateFields: {
        summary: 'Updated meeting',
        start: '2025-01-03T11:00:00Z',
      },
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('updated', true);
  });
  
  it('should execute delete operation', async () => {
    const result = await executor.execute('step-4', {
      operation: 'delete',
      eventId: 'event-123',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('deleted', true);
  });
  
  it('should execute createRecurring operation', async () => {
    const result = await executor.execute('step-5', {
      operation: 'createRecurring',
      summary: 'פגישת צוות שבועית',
      startTime: '09:00',
      endTime: '10:00',
      days: ['Sunday', 'Thursday'],
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
    expect(result.data).toHaveProperty('days');
  });
  
  it('should handle unknown operation', async () => {
    const result = await executor.execute('step-6', {
      operation: 'unknownOp',
    }, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown operation');
  });
});

describe('DatabaseExecutor', () => {
  const executor = new DatabaseExecutor();
  
  beforeEach(() => {
    clearMockServices();
    setMockService('TaskService', mockTaskService);
    setMockService('ListService', mockListService);
  });
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('database_executor');
    expect(executor.capability).toBe('database');
  });
  
  it('should execute task create operation', async () => {
    const result = await executor.execute('step-1', {
      operation: 'create',
      text: 'לקנות חלב',
      category: 'קניות',
      // No list-specific fields, so it's a task operation
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
    expect(result.data).toHaveProperty('text', 'לקנות חלב');
  });
  
  it('should execute task getAll operation', async () => {
    const result = await executor.execute('step-2', {
      operation: 'getAll',
      filters: { completed: false },
      // No list-specific fields, so it's a task operation
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });
  
  it('should execute task complete operation', async () => {
    const result = await executor.execute('step-3', {
      operation: 'complete',
      taskId: 'task-123',
      // taskId indicates this is a task operation
    }, mockContext);
    
    expect(result.success).toBe(true);
  });
  
  it('should execute list create operation', async () => {
    const result = await executor.execute('step-4', {
      operation: 'create',
      listName: 'רשימת קניות', // listName indicates this is a list operation
      items: ['חלב', 'לחם', 'ביצים'],
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
    expect(result.data).toHaveProperty('listName', 'רשימת קניות');
  });
  
  it('should execute list addItem operation', async () => {
    const result = await executor.execute('step-5', {
      operation: 'addItem', // addItem is a list-specific operation
      listName: 'רשימת קניות',
      item: 'גבינה',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('item', 'גבינה');
  });
  
  it('should execute list toggleItem operation', async () => {
    const result = await executor.execute('step-6', {
      operation: 'toggleItem', // toggleItem is a list-specific operation
      listName: 'רשימת קניות',
      itemIndex: 0,
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('toggled', true);
  });
  
  it('should handle unknown database operation', async () => {
    const result = await executor.execute('step-7', {
      operation: 'unknownOperation',
    }, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown');
  });
});

describe('GmailExecutor', () => {
  const executor = new GmailExecutor();
  
  beforeEach(() => {
    clearMockServices();
    setMockService('GmailService', mockGmailService);
  });
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('gmail_executor');
    expect(executor.capability).toBe('gmail');
  });
  
  it('should execute listEmails operation', async () => {
    const result = await executor.execute('step-1', {
      operation: 'listEmails',
      filters: { isUnread: true, maxResults: 5 },
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('emails');
    expect(result.data).toHaveProperty('count');
  });
  
  it('should execute getEmailById operation', async () => {
    const result = await executor.execute('step-2', {
      operation: 'getEmailById',
      messageId: 'email-123',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id', 'email-123');
    expect(result.data).toHaveProperty('subject');
  });
  
  it('should execute sendPreview operation', async () => {
    const result = await executor.execute('step-3', {
      operation: 'sendPreview',
      to: ['recipient@example.com'],
      subject: 'Test email',
      body: 'Hello, this is a test.',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('preview', true);
    expect(result.data).toHaveProperty('to');
    expect(result.data).toHaveProperty('subject', 'Test email');
  });
  
  it('should execute sendConfirm operation', async () => {
    const result = await executor.execute('step-4', {
      operation: 'sendConfirm',
      to: ['recipient@example.com'],
      subject: 'Confirmed email',
      body: 'This is confirmed.',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
    expect(result.data.preview).toBeFalsy();
  });
  
  it('should execute reply operation', async () => {
    const result = await executor.execute('step-5', {
      operation: 'reply',
      messageId: 'email-123',
      body: 'Thanks for your message!',
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('id');
    expect(result.data).toHaveProperty('messageId', 'email-123');
  });
  
  it('should handle unknown Gmail operation', async () => {
    const result = await executor.execute('step-6', {
      operation: 'unknownOp',
    }, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown operation');
  });
});

describe('SecondBrainExecutor', () => {
  const executor = new SecondBrainExecutor();
  
  beforeEach(() => {
    clearMockServices();
    setMockService('SecondBrainService', mockSecondBrainService);
  });
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('secondbrain_executor');
    expect(executor.capability).toBe('second-brain');
  });
  
  it('should execute storeMemory operation', async () => {
    const result = await executor.execute('step-1', {
      operation: 'storeMemory',
      text: 'אני אוהב לשתות קפה בבוקר',
      metadata: { tags: ['preferences', 'food'] },
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty('memory');
    expect(result.data.memory).toHaveProperty('text');
  });
  
  it('should execute searchMemory operation', async () => {
    const result = await executor.execute('step-2', {
      operation: 'searchMemory',
      query: 'קפה',
      limit: 5,
    }, mockContext);
    
    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });
  
  it('should handle unknown SecondBrain operation', async () => {
    const result = await executor.execute('step-3', {
      operation: 'unknownOp',
    }, mockContext);
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown operation');
  });
});

describe('GeneralExecutor', () => {
  const executor = new GeneralExecutor();
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('general_executor');
    expect(executor.capability).toBe('general');
  });
  
  it('should pass through args for conversational response', async () => {
    const args = {
      operation: 'respond',
      message: 'Hello, how can I help you?',
    };
    
    const result = await executor.execute('step-1', args, mockContext);
    
    expect(result.success).toBe(true);
    // GeneralExecutor passes through args as data
    expect(result.data).toHaveProperty('operation', 'respond');
    expect(result.data).toHaveProperty('message');
  });
  
  it('should pass through args for greetings', async () => {
    const args = {
      operation: 'greet',
    };
    
    const result = await executor.execute('step-2', args, mockContext);
    
    expect(result.success).toBe(true);
    // GeneralExecutor passes through args as data
    expect(result.data).toHaveProperty('operation', 'greet');
  });
});

describe('MetaExecutor', () => {
  const executor = new MetaExecutor();
  
  it('should have correct name and capability', () => {
    expect(executor.name).toBe('meta_executor');
    expect(executor.capability).toBe('meta');
  });
  
  it('should pass through args for getCapabilities operation', async () => {
    const args = {
      operation: 'getCapabilities',
      capabilities: ['calendar', 'database', 'gmail'],
    };
    
    const result = await executor.execute('step-1', args, mockContext);
    
    expect(result.success).toBe(true);
    // MetaExecutor passes through args as data
    expect(result.data).toHaveProperty('operation', 'getCapabilities');
    expect(result.data).toHaveProperty('capabilities');
  });
  
  it('should pass through args for help operation', async () => {
    const args = {
      operation: 'help',
      helpText: 'I can help you with tasks, lists, and calendar.',
    };
    
    const result = await executor.execute('step-2', args, mockContext);
    
    expect(result.success).toBe(true);
    // MetaExecutor passes through args as data
    expect(result.data).toHaveProperty('operation', 'help');
    expect(result.data).toHaveProperty('helpText');
  });
});
