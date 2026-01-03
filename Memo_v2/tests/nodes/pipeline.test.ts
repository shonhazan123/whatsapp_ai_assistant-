/**
 * Pipeline Node Tests
 * 
 * Tests for JoinNode, ResponseFormatterNode, ResponseWriterNode, MemoryUpdateNode
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { JoinNode } from '../../src/graph/nodes/JoinNode.js';
import {
  MemoryUpdateNode,
  enforceMemoryLimits,
  estimateTokens
} from '../../src/graph/nodes/MemoryUpdateNode.js';
import {
  ResponseFormatterNode,
  categorizeTasks,
  formatDate,
  formatRelativeDate
} from '../../src/graph/nodes/ResponseFormatterNode.js';
import {
  ResponseWriterNode,
  TEMPLATES
} from '../../src/graph/nodes/ResponseWriterNode.js';
import type { MemoState } from '../../src/graph/state/MemoState.js';
import { createInitialState } from '../../src/graph/state/MemoState.js';
import type { ConversationMessage, ResolverResult } from '../../src/types/index.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestState(overrides: Partial<MemoState> = {}): MemoState {
  return createInitialState({
    user: {
      phone: '+1234567890',
      timezone: 'Asia/Jerusalem',
      language: 'en',
      planTier: 'free',
      googleConnected: true,
      capabilities: {
        calendar: true,
        gmail: true,
        database: true,
        secondBrain: true,
      },
    },
    input: {
      message: 'Test message',
      triggerType: 'user',
    },
    ...overrides,
  });
}

// ============================================================================
// JOIN NODE TESTS
// ============================================================================

describe('JoinNode', () => {
  let node: JoinNode;
  
  beforeEach(() => {
    node = new JoinNode();
  });
  
  it('should process successful resolver results', async () => {
    const resolverResults = new Map<string, ResolverResult>();
    resolverResults.set('step-1', {
      stepId: 'step-1',
      type: 'execute',
      args: { operation: 'create', text: 'Test task' },
    });
    
    const state = createTestState({
      resolverResults,
      plannerOutput: {
        intentType: 'operation',
        confidence: 0.9,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{ id: 'step-1', capability: 'database', action: 'create_task', constraints: {}, changes: {}, dependsOn: [] }],
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.executionResults).toBeDefined();
    expect(result.executionResults?.get('step-1')?.success).toBe(true);
  });
  
  it('should handle failed resolver results', async () => {
    const resolverResults = new Map<string, ResolverResult>();
    resolverResults.set('step-1', {
      stepId: 'step-1',
      type: 'execute',
      args: { error: 'Something went wrong' },
    });
    
    const state = createTestState({
      resolverResults,
      plannerOutput: {
        intentType: 'operation',
        confidence: 0.9,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{ id: 'step-1', capability: 'database', action: 'create_task', constraints: {}, changes: {}, dependsOn: [] }],
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.error).toContain('Something went wrong');
    expect(result.executionResults?.get('step-1')?.success).toBe(false);
  });
  
  it('should return empty result when no resolver results', async () => {
    const state = createTestState();
    const result = await node['process'](state);
    expect(result.executionResults?.size || 0).toBe(0);
  });
});

// ============================================================================
// RESPONSE FORMATTER NODE TESTS
// ============================================================================

describe('ResponseFormatterNode', () => {
  let node: ResponseFormatterNode;
  
  beforeEach(() => {
    node = new ResponseFormatterNode();
  });
  
  it('should format execution results', async () => {
    const executionResults = new Map();
    executionResults.set('step-1', {
      stepId: 'step-1',
      success: true,
      data: { created: true, text: 'Buy groceries' },
      durationMs: 100,
    });
    
    const state = createTestState({
      executionResults,
      plannerOutput: {
        intentType: 'operation',
        confidence: 0.9,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{ id: 'step-1', capability: 'database', action: 'create_task', constraints: {}, changes: {}, dependsOn: [] }],
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.formattedResponse).toBeDefined();
    expect(result.formattedResponse?.agent).toBe('database');
    expect(result.formattedResponse?.operation).toBe('create_task');
  });
  
  it('should build correct response context', async () => {
    const executionResults = new Map();
    executionResults.set('step-1', {
      stepId: 'step-1',
      success: true,
      data: { 
        created: true, 
        text: 'Daily standup',
        reminderRecurrence: { type: 'daily', time: '09:00' },
      },
      durationMs: 100,
    });
    
    const state = createTestState({
      executionResults,
      plannerOutput: {
        intentType: 'operation',
        confidence: 0.9,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{ id: 'step-1', capability: 'database', action: 'create_task', constraints: {}, changes: {}, dependsOn: [] }],
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.formattedResponse?.context.isRecurring).toBe(true);
  });
});

describe('formatDate', () => {
  it('should format dates for English', () => {
    const isoDate = new Date().toISOString();
    const formatted = formatDate(isoDate, 'Asia/Jerusalem', 'en');
    expect(formatted).toContain('Today');
  });
  
  it('should format dates for Hebrew', () => {
    const isoDate = new Date().toISOString();
    const formatted = formatDate(isoDate, 'Asia/Jerusalem', 'he');
    expect(formatted).toContain('היום');
  });
});

describe('formatRelativeDate', () => {
  it('should format future dates', () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now
    const formatted = formatRelativeDate(future, 'en');
    expect(formatted).toContain('hours');
  });
  
  it('should format past dates', () => {
    const past = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 minutes ago
    const formatted = formatRelativeDate(past, 'en');
    expect(formatted).toContain('minutes ago');
  });
});

describe('categorizeTasks', () => {
  it('should categorize tasks correctly', () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    // Use a time later today (2 hours from now) to ensure it's in the future
    const laterToday = new Date(now);
    laterToday.setHours(now.getHours() + 2, 0, 0, 0);
    // If that pushes past midnight, just use 11:59 PM today
    if (laterToday.getDate() !== now.getDate()) {
      laterToday.setHours(23, 59, 0, 0);
      laterToday.setDate(now.getDate());
    }
    
    const tasks = [
      { id: '1', text: 'Overdue task', dueDate: yesterday.toISOString() },
      { id: '2', text: 'Today task', dueDate: laterToday.toISOString() },
      { id: '3', text: 'Future task', dueDate: tomorrow.toISOString() },
      { id: '4', text: 'Recurring task', reminderRecurrence: { type: 'daily' } },
      { id: '5', text: 'No due date task' },
    ];
    
    const categorized = categorizeTasks(tasks);
    
    expect(categorized.overdue.length).toBe(1);
    expect(categorized.today.length).toBe(1);
    expect(categorized.upcoming.length).toBe(1);
    expect(categorized.recurring.length).toBe(1);
    expect(categorized.noDueDate.length).toBe(1);
  });
});

// ============================================================================
// RESPONSE WRITER NODE TESTS
// ============================================================================

describe('ResponseWriterNode', () => {
  let node: ResponseWriterNode;
  
  beforeEach(() => {
    node = new ResponseWriterNode();
  });
  
  it('should generate task create response (English)', async () => {
    const state = createTestState({
      formattedResponse: {
        agent: 'database',
        operation: 'create',
        entityType: 'task',
        rawData: [{ text: 'Buy groceries' }],
        formattedData: [{ text: 'Buy groceries' }],
        context: {
          isRecurring: false,
          isNudge: false,
          hasDueDate: false,
          isToday: false,
          isTomorrowOrLater: false,
        },
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.finalResponse).toContain('Created task');
    expect(result.finalResponse).toContain('Buy groceries');
  });
  
  it('should generate task create response (Hebrew)', async () => {
    const state = createInitialState({
      user: {
        phone: '+1234567890',
        timezone: 'Asia/Jerusalem',
        language: 'he',
        planTier: 'free',
        googleConnected: true,
        capabilities: { calendar: true, gmail: true, database: true, secondBrain: true },
      },
      formattedResponse: {
        agent: 'database',
        operation: 'create',
        entityType: 'task',
        rawData: [{ text: 'לקנות מכולת' }],
        formattedData: [{ text: 'לקנות מכולת' }],
        context: {
          isRecurring: false,
          isNudge: false,
          hasDueDate: false,
          isToday: false,
          isTomorrowOrLater: false,
        },
      },
    });
    
    const result = await node['process'](state);
    
    expect(result.finalResponse).toContain('יצרתי משימה');
    expect(result.finalResponse).toContain('לקנות מכולת');
  });
  
  it('should handle error state', async () => {
    const state = createTestState({
      error: 'Something went wrong',
    });
    
    const result = await node['process'](state);
    
    expect(result.finalResponse).toContain('Something went wrong');
  });
});

describe('TEMPLATES', () => {
  it('should have matching English and Hebrew templates', () => {
    const enKeys = Object.keys(TEMPLATES.en);
    const heKeys = Object.keys(TEMPLATES.he);
    
    // All English keys should have Hebrew equivalents
    for (const key of enKeys) {
      expect(heKeys).toContain(key);
    }
  });
});

// ============================================================================
// MEMORY UPDATE NODE TESTS
// ============================================================================

describe('MemoryUpdateNode', () => {
  let node: MemoryUpdateNode;
  
  beforeEach(() => {
    node = new MemoryUpdateNode();
  });
  
  it('should add messages to recentMessages', async () => {
    const state = createTestState({
      input: {
        message: 'Create a task',
        triggerType: 'user',
      },
      finalResponse: 'Task created!',
    });
    
    const result = await node['process'](state);
    
    expect(result.recentMessages?.length).toBe(2);
    expect(result.recentMessages?.[0].role).toBe('user');
    expect(result.recentMessages?.[1].role).toBe('assistant');
  });
  
  it('should enforce memory limits', async () => {
    const existingMessages: ConversationMessage[] = [];
    for (let i = 0; i < 15; i++) {
      existingMessages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: Date.now() - (15 - i) * 1000,
      });
    }
    
    const state = createTestState({
      recentMessages: existingMessages,
      input: { message: 'New message', triggerType: 'user' },
      finalResponse: 'Response',
    });
    
    const result = await node['process'](state);
    
    // Should be limited to 10 messages
    expect(result.recentMessages?.length).toBeLessThanOrEqual(10);
  });
});

describe('Memory Utilities', () => {
  it('should estimate tokens correctly', () => {
    const text = 'Hello world'; // 11 characters
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });
  
  it('should enforce memory limits', () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        role: 'user',
        content: `Message ${i}`,
        timestamp: Date.now(),
      });
    }
    
    const limited = enforceMemoryLimits(messages, 10, 500);
    expect(limited.length).toBe(10);
  });
});


