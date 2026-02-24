/**
 * Resolver Tests
 * 
 * Tests for all resolver implementations.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    CalendarFindResolver,
    CalendarMutateResolver,
    DatabaseListResolver,
    DatabaseTaskResolver,
    findResolver,
    GeneralResolver,
    getResolversForCapability,
    GmailResolver,
    RESOLVER_REGISTRY,
    SecondBrainResolver,
} from '../../src/graph/resolvers/index.js';
import { createInitialState } from '../../src/graph/state/MemoState.js';
import type { PlanStep } from '../../src/types/index.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

function createPlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'test-step-1',
    capability: 'calendar',
    action: 'list_events',
    constraints: {},
    changes: {},
    dependsOn: [],
    ...overrides,
  };
}

function createTestState() {
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
  });
}

// ============================================================================
// RESOLVER REGISTRY TESTS
// ============================================================================

describe('Resolver Registry', () => {
  it('should have all expected resolvers', () => {
    expect(RESOLVER_REGISTRY.length).toBe(8);
    
    const names = RESOLVER_REGISTRY.map(r => r.name);
    expect(names).toContain('calendar_find_resolver');
    expect(names).toContain('calendar_mutate_resolver');
    expect(names).toContain('database_task_resolver');
    expect(names).toContain('database_list_resolver');
    expect(names).toContain('gmail_resolver');
    expect(names).toContain('secondbrain_resolver');
    expect(names).toContain('general_resolver');
    expect(names).toContain('meta_resolver');
  });
  
  it('should find correct resolver for capability and action', () => {
    const calendarFind = findResolver('calendar', 'list_events');
    expect(calendarFind?.name).toBe('calendar_find_resolver');
    
    const calendarMutate = findResolver('calendar', 'create_event');
    expect(calendarMutate?.name).toBe('calendar_mutate_resolver');
    
    const task = findResolver('database', 'create_task');
    expect(task?.name).toBe('database_task_resolver');
    
    const list = findResolver('database', 'create_list');
    expect(list?.name).toBe('database_list_resolver');
  });
  
  it('should get all resolvers for a capability', () => {
    const calendarResolvers = getResolversForCapability('calendar');
    expect(calendarResolvers.length).toBe(2);
    
    const databaseResolvers = getResolversForCapability('database');
    expect(databaseResolvers.length).toBe(2);
  });
});

// ============================================================================
// CALENDAR RESOLVER TESTS
// ============================================================================

describe('CalendarFindResolver', () => {
  let resolver: CalendarFindResolver;
  
  beforeEach(() => {
    resolver = new CalendarFindResolver();
  });
  
  it('should handle list_events action', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'list_events',
      constraints: {},
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('getEvents');
    expect(result.args?.timeMin).toBeDefined();
    expect(result.args?.timeMax).toBeDefined();
  });
  
  it('should use provided time range', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'list_events',
      constraints: {
        timeMin: '2025-01-01T00:00:00Z',
        timeMax: '2025-01-31T23:59:59Z',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.args?.timeMin).toBe('2025-01-01T00:00:00Z');
    expect(result.args?.timeMax).toBe('2025-01-31T23:59:59Z');
  });
  
  it('should handle find_event action', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'find_event',
      constraints: { summary: 'Team Meeting' },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('get');
    expect(result.args?.summary).toBe('Team Meeting');
  });
  
  it('should have correct schema slice', () => {
    const schema = resolver.getSchemaSlice() as any;
    expect(schema.name).toBe('calendarOperations');
    expect(schema.parameters.properties.operation.enum).toContain('getEvents');
    expect(schema.parameters.properties.operation.enum).toContain('checkConflicts');
  });
});

describe('CalendarMutateResolver', () => {
  let resolver: CalendarMutateResolver;
  
  beforeEach(() => {
    resolver = new CalendarMutateResolver();
  });
  
  it('should handle create_event action', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'create_event',
      constraints: {
        summary: 'New Meeting',
        start: '2025-01-15T10:00:00Z',
        end: '2025-01-15T11:00:00Z',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.summary).toBe('New Meeting');
    expect(result.args?.start).toBe('2025-01-15T10:00:00Z');
  });
  
  it('should handle update_event with searchCriteria', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'update_event',
      constraints: { summary: 'Old Title' },
      changes: { summary: 'New Title' },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('update');
    expect(result.args?.searchCriteria?.summary).toBe('Old Title');
    expect(result.args?.updateFields?.summary).toBe('New Title');
  });
  
  it('should handle event with reminderMinutesBefore (V1 calendar reminder)', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'create_event',
      constraints: {
        summary: 'Wedding',
        start: '2025-12-25T19:00:00+02:00',
        end: '2025-12-25T21:00:00+02:00',
        reminderMinutesBefore: 1440, // 1 day before
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.reminderMinutesBefore).toBe(1440);
  });
  
  it('should handle all-day multi-day event', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'create_event',
      constraints: {
        summary: 'Vacation',
        start: '2025-01-05',
        end: '2025-01-09',
        allDay: true,
        location: 'Beach',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.allDay).toBe(true);
    expect(result.args?.start).toBe('2025-01-05');
    expect(result.args?.end).toBe('2025-01-09');
    expect(result.args?.location).toBe('Beach');
  });
  
  it('should handle createRecurring with days', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'create_recurring',
      constraints: {
        summary: 'Work',
        startTime: '09:00',
        endTime: '18:00',
        days: ['Sunday', 'Tuesday', 'Wednesday'],
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('createRecurring');
    expect(result.args?.days).toEqual(['Sunday', 'Tuesday', 'Wednesday']);
    expect(result.args?.startTime).toBe('09:00');
    expect(result.args?.endTime).toBe('18:00');
  });
  
  it('should include language in response', async () => {
    const step = createPlanStep({
      capability: 'calendar',
      action: 'create_event',
      constraints: {
        summary: 'Meeting',
        start: '2025-01-15T10:00:00+02:00',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.args?.language).toBe('en');
  });
});

// ============================================================================
// DATABASE RESOLVER TESTS
// ============================================================================

describe('DatabaseTaskResolver', () => {
  let resolver: DatabaseTaskResolver;
  
  beforeEach(() => {
    resolver = new DatabaseTaskResolver();
  });
  
  it('should handle create_task action', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_task',
      constraints: {
        text: 'Buy groceries',
        category: 'Shopping',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.text).toBe('Buy groceries');
    expect(result.args?.category).toBe('Shopping');
  });
  
  it('should handle list_tasks action', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'list_tasks',
      constraints: {
        filters: { completed: false },
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('getAll');
    expect(result.args?.filters?.completed).toBe(false);
  });
  
  it('should handle complete_task with taskId (V1: completion = deletion)', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'complete_task',
      constraints: { taskId: 'task-123' },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    // V1 behavior: completing a reminder task = deleting it
    expect(result.args?.operation).toBe('delete');
    expect(result.args?.taskId).toBe('task-123');
  });
  
  it('should handle create_task with reminder (V1 reminder logic)', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_task',
      constraints: {
        text: 'Call mom',
        dueDate: '2025-01-03T20:00:00+02:00',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.text).toBe('Call mom');
    expect(result.args?.dueDate).toBe('2025-01-03T20:00:00+02:00');
    // V1: default to "0 minutes" when dueDate but no reminder specified
    expect(result.args?.reminder).toBe('0 minutes');
  });
  
  it('should handle nudge reminder recurrence', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_task',
      constraints: {
        text: 'Check emails',
        dueDate: '2025-01-03T20:00:00+02:00',
        reminderRecurrence: { type: 'nudge', interval: '10 minutes' },
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.reminderRecurrence?.type).toBe('nudge');
    expect(result.args?.reminderRecurrence?.interval).toBe('10 minutes');
  });
  
  it('should handle weekly recurring reminder', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_task',
      constraints: {
        text: 'Call mom',
        reminderRecurrence: { type: 'weekly', days: [0], time: '14:00' },
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.reminderRecurrence?.type).toBe('weekly');
    expect(result.args?.reminderRecurrence?.days).toEqual([0]);
    expect(result.args?.reminderRecurrence?.time).toBe('14:00');
  });
});

describe('DatabaseListResolver', () => {
  let resolver: DatabaseListResolver;
  
  beforeEach(() => {
    resolver = new DatabaseListResolver();
  });
  
  it('should handle create_list action', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_list',
      constraints: {
        name: 'Shopping List',
        items: ['Milk', 'Bread', 'Eggs'],
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('create');
    expect(result.args?.name).toBe('Shopping List');
    expect(result.args?.items).toEqual(['Milk', 'Bread', 'Eggs']);
  });
  
  it('should handle add_item action', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'add_item',
      constraints: {
        listId: 'list-123',
        item: 'Butter',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('addItem');
    expect(result.args?.listId).toBe('list-123');
    expect(result.args?.item).toBe('Butter');
  });
  
  it('should default to isChecklist: true (V1 behavior)', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'create_list',
      constraints: {
        name: 'Shopping List',
        items: ['Milk', 'Bread'],
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.isChecklist).toBe(true);
  });
  
  it('should handle add_item with listName for lookup', async () => {
    const step = createPlanStep({
      capability: 'database',
      action: 'add_item',
      constraints: {
        listName: 'Shopping',
        item: 'Cheese',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('addItem');
    expect(result.args?.listName).toBe('Shopping');
    expect(result.args?.item).toBe('Cheese');
  });
});

// ============================================================================
// GMAIL RESOLVER TESTS
// ============================================================================

describe('GmailResolver', () => {
  let resolver: GmailResolver;
  
  beforeEach(() => {
    resolver = new GmailResolver();
  });
  
  it('should handle list_emails action', async () => {
    const step = createPlanStep({
      capability: 'gmail',
      action: 'list_emails',
      constraints: {
        from: 'boss@example.com',
        maxResults: 5,
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('listEmails');
    expect(result.args?.filters?.from).toBe('boss@example.com');
    expect(result.args?.filters?.maxResults).toBe(5);
  });
  
  it('should always use preview for send_email', async () => {
    const step = createPlanStep({
      capability: 'gmail',
      action: 'send_email',
      constraints: {
        to: ['colleague@example.com'],
        subject: 'Hello',
        body: 'Hi there!',
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('sendPreview'); // Not 'send'!
    expect(result.args?.to).toEqual(['colleague@example.com']);
  });
});

// ============================================================================
// SECONDBRAIN RESOLVER TESTS
// ============================================================================

describe('SecondBrainResolver', () => {
  let resolver: SecondBrainResolver;
  
  beforeEach(() => {
    resolver = new SecondBrainResolver();
  });
  
  it('should handle store_memory action', async () => {
    const step = createPlanStep({
      capability: 'second-brain',
      action: 'store_memory',
      constraints: {
        text: "John's phone number is 555-1234",
        tags: ['contacts', 'john'],
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('storeMemory');
    expect(result.args?.text).toBe("John's phone number is 555-1234");
    expect(result.args?.metadata?.tags).toContain('contacts');
  });
  
  it('should handle search_memory action', async () => {
    const step = createPlanStep({
      capability: 'second-brain',
      action: 'search_memory',
      constraints: {
        query: "John's phone number",
      },
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.operation).toBe('searchMemory');
    expect(result.args?.query).toBe("John's phone number");
    expect(result.args?.limit).toBe(5); // Default
  });
});

// ============================================================================
// GENERAL/META RESOLVER TESTS
// ============================================================================

describe('GeneralResolver', () => {
  let resolver: GeneralResolver;
  
  beforeEach(() => {
    resolver = new GeneralResolver();
  });
  
  it('should handle respond action', async () => {
    const step = createPlanStep({
      capability: 'general',
      action: 'respond',
      constraints: {},
    });
    const state = createTestState();
    
    const result = await resolver.resolve(step, state);
    
    expect(result.type).toBe('execute');
    expect(result.args?.userMessage).toBe('Test message');
    expect(result.args?.language).toBe('en');
  });
});

describe('GeneralResolver (former meta actions)', () => {
  let resolver: GeneralResolver;

  beforeEach(() => {
    resolver = new GeneralResolver();
  });

  it('should handle describe_capabilities with capability general', async () => {
    const step = createPlanStep({
      capability: 'general',
      action: 'describe_capabilities',
    });
    const state = createTestState();

    const result = await resolver.resolve(step, state);

    expect(result.type).toBe('execute');
    expect(result.args).toHaveProperty('response');
    expect(typeof result.args?.response).toBe('string');
    expect(result.args).toHaveProperty('language');
  });

  it('should handle help action with capability general', async () => {
    const step = createPlanStep({
      capability: 'general',
      action: 'help',
    });
    const state = createTestState();

    const result = await resolver.resolve(step, state);

    expect(result.type).toBe('execute');
    expect(result.args).toHaveProperty('response');
    expect(typeof result.args?.response).toBe('string');
  });
});


