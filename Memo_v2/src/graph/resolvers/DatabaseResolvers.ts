/**
 * Database Resolvers
 * 
 * Converts database-related PlanSteps into task/list operation arguments.
 * 
 * Based on V1: src/agents/functions/DatabaseFunctions.ts
 *              src/config/system-prompts.ts (getDatabaseAgentPrompt)
 * 
 * CRITICAL V1 RULES:
 * - Database agent handles REMINDERS only (not general tasks)
 * - NUDGE vs DAILY differentiation: "כל X דקות" → nudge, "כל יום ב-X" → daily
 * - Lists require explicit "list"/"רשימה" keyword
 * - No confirmation for deletions
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// DATABASE TASK RESOLVER
// ============================================================================

/**
 * DatabaseTaskResolver - Reminder/Task CRUD operations
 * 
 * Actions: create_task, get_task, list_tasks, update_task, delete_task, 
 *          complete_task, create_multiple_tasks, add_subtask
 */
export class DatabaseTaskResolver extends LLMResolver {
  readonly name = 'database_task_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'create_task',
    'get_task',
    'list_tasks',
    'update_task',
    'delete_task',
    'complete_task',
    'create_multiple_tasks',
    'add_subtask',
    'update_multiple_tasks',
    'delete_multiple_tasks',
    'delete_all_tasks',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A DATABASE-INTEGRATED AGENT FOR REMINDER AND TASK MANAGEMENT.

## YOUR ROLE:
Convert natural language commands into structured JSON for taskOperations function.
You handle REMINDERS and to-do items - NOT calendar events.

## ⚠️ NUDGE vs DAILY - KEY RULE ⚠️
**"כל X דקות/שעות" or "every X minutes/hours" → type: "nudge" + interval field**
**"כל יום ב-X" or "every day at X" → type: "daily" + time field**

## AVAILABLE OPERATIONS:
- **create**: Create a single task/reminder
- **createMultiple**: Create multiple tasks at once (CRITICAL: always use for multiple items, even with same time)
- **get**: Get a specific task by ID or text
- **getAll**: List all tasks with optional filters
- **update**: Update task properties or add reminder
- **updateMultiple**: Update multiple tasks at once
- **delete**: Delete a single task
- **deleteMultiple**: Delete multiple tasks
- **deleteAll**: Delete all tasks (with optional filters)
- **complete**: Mark task as complete
- **addSubtask**: Add a subtask to a parent task

## OUTPUT FORMAT for create:
{
  "operation": "create",
  "text": "Task description",
  "category": "optional category",
  "dueDate": "ISO datetime if specified",
  "reminder": "0 minutes | 30 minutes | 1 hour | 2 days",
  "reminderRecurrence": { 
    "type": "daily | weekly | monthly | nudge",
    "time": "HH:mm",
    "days": [0-6],
    "interval": "5 minutes"
  }
}

## REMINDER DETECTION RULES (CHECK IN THIS ORDER):

### 1. Explicit time specified → reminder: "0 minutes"
Pattern: "תזכיר לי [date] בשעה [time]" / "remind me at [time]"
Meaning: Fire the reminder AT that exact time
Examples:
- "תזכיר לי היום בשעה 20:10 לעבור לאחותי" → { dueDate: "...20:10...", reminder: "0 minutes" }
- "Remind me tomorrow at 6pm to buy groceries" → { dueDate: "...18:00...", reminder: "0 minutes" }

### 2. "X before" specified → reminder: exact interval
Pattern: "תזכיר לי X לפני" / "remind me X before"
Examples:
- "remind me 30 minutes before" → { reminder: "30 minutes" }
- "תזכיר לי שעה לפני" → { reminder: "1 hour" }

### 3. Date only, no time → dueDate 08:00 AM, reminder: "0 minutes"
Pattern: "תזכיר לי מחר" / "remind me tomorrow" (no time mentioned)
Examples:
- "תזכיר לי מחר לקנות חלב" → { dueDate: "...T08:00:00...", reminder: "0 minutes" }

## RECURRING REMINDERS (reminderRecurrence):

### Daily: "כל יום ב-X" / "every day at X"
{ "type": "daily", "time": "08:00" }

### Weekly: "כל יום ראשון ב-X" / "every Sunday at X"  
{ "type": "weekly", "days": [0], "time": "14:00" }
Note: days array = [0=Sunday, 1=Monday, ..., 6=Saturday]

### Monthly: "בכל 10 לחודש" / "every 10th of the month"
{ "type": "monthly", "dayOfMonth": 10, "time": "09:00" }

### NUDGE: "כל X דקות/שעות" / "every X minutes/hours"
{ "type": "nudge", "interval": "10 minutes" }
Detection patterns (Hebrew): "נדנד אותי", "תציק לי", "תחפור לי", "כל X דקות"
Detection patterns (English): "nudge me", "keep reminding", "every X minutes"
Default: 10 minutes if not specified

## VALIDATION RULES:
- ❌ Cannot use dueDate+reminder AND reminderRecurrence together (EXCEPT for nudge)
- ✅ NUDGE CAN have dueDate (nudge starts from that time)
- ❌ Daily/weekly/monthly reminders cannot have dueDate
- ✅ Tasks without dueDate MUST NOT include reminder parameter

## EXAMPLES:

Example 1 - One-time reminder with explicit time:
User: "תזכיר לי היום בשעה 20:10 לעבור לאחותי"
→ { "operation": "create", "text": "לעבור לאחותי", "dueDate": "2025-01-02T20:10:00+02:00", "reminder": "0 minutes" }

Example 2 - Multiple tasks at SAME time:
User: "תזכיר לי היום בשמונה לנתק חשמל ולשלוח מייל"
→ {
  "operation": "createMultiple",
  "tasks": [
    { "text": "לנתק חשמל", "dueDate": "2025-01-02T20:00:00+02:00", "reminder": "0 minutes" },
    { "text": "לשלוח מייל", "dueDate": "2025-01-02T20:00:00+02:00", "reminder": "0 minutes" }
  ]
}

Example 3 - Nudge reminder:
User: "תזכיר לי בשמונה בערב ותציק לי על זה כל עשר דקות"
→ {
  "operation": "create",
  "text": "...",
  "dueDate": "2025-01-02T20:00:00+02:00",
  "reminderRecurrence": { "type": "nudge", "interval": "10 minutes" }
}

Example 4 - Daily recurring:
User: "תזכיר לי כל בוקר ב-9 לעשות ספורט"
→ { "operation": "create", "text": "לעשות ספורט", "reminderRecurrence": { "type": "daily", "time": "09:00" } }

Example 5 - Weekly recurring:
User: "תזכיר לי כל יום ראשון ב-14:00 להתקשר לאמא"
→ { "operation": "create", "text": "להתקשר לאמא", "reminderRecurrence": { "type": "weekly", "days": [0], "time": "14:00" } }

Example 6 - Complete a task:
User: "סיימתי לבדוק את הפיצ'ר"
→ { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

Example 7 - Delete all overdue:
User: "תמחק את כל המשימות שזמנם עבר"
→ { "operation": "deleteAll", "where": { "window": "overdue" }, "preview": false }

## LANGUAGE RULE:
Output only the JSON, no explanation. NEVER include IDs you don't have.`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'taskOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 
                   'delete', 'deleteMultiple', 'deleteAll', 'complete', 'addSubtask'],
          },
          taskId: { type: 'string', description: 'Task ID (only if known from prior lookup)' },
          text: { type: 'string', description: 'Task text/description' },
          category: { type: 'string', description: 'Task category' },
          dueDate: { type: 'string', description: 'Due date/time (ISO format)' },
          reminder: { 
            type: 'string', 
            description: 'Reminder interval before dueDate: "0 minutes", "30 minutes", "1 hour", "2 days"' 
          },
          reminderRecurrence: {
            type: 'object',
            description: 'Recurring reminder settings',
            properties: {
              type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
              time: { type: 'string', description: 'HH:mm format for daily/weekly/monthly' },
              interval: { type: 'string', description: 'Interval for nudge: "5 minutes", "1 hour"' },
              days: { type: 'array', items: { type: 'number' }, description: 'Days for weekly: [0-6]' },
              dayOfMonth: { type: 'number', description: 'Day of month for monthly: 1-31' },
              until: { type: 'string', description: 'End date for recurrence (ISO)' },
            },
          },
          reminderDetails: {
            type: 'object',
            description: 'For updates: new reminder settings to apply',
            properties: {
              dueDate: { type: 'string' },
              reminder: { type: 'string' },
              reminderRecurrence: { type: 'object' },
            },
          },
          filters: {
            type: 'object',
            description: 'Filters for getAll/deleteAll',
            properties: {
              completed: { type: 'boolean' },
              category: { type: 'string' },
              window: { type: 'string', enum: ['today', 'this_week', 'overdue', 'upcoming'] },
              reminderRecurrence: { type: 'string', enum: ['none', 'any', 'daily', 'weekly', 'monthly'] },
            },
          },
          tasks: {
            type: 'array',
            description: 'Array of tasks for createMultiple',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                category: { type: 'string' },
                dueDate: { type: 'string' },
                reminder: { type: 'string' },
                reminderRecurrence: { type: 'object' },
              },
            },
          },
          updates: {
            type: 'array',
            description: 'Array of updates for updateMultiple',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                reminderDetails: { type: 'object' },
              },
            },
          },
          where: {
            type: 'object',
            description: 'Filter for deleteAll',
            properties: {
              window: { type: 'string' },
              reminderRecurrence: { type: 'string' },
            },
          },
          preview: { type: 'boolean', description: 'Always false - no confirmation needed' },
          subtaskText: { type: 'string', description: 'Subtask text for addSubtask' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action, constraints, changes } = step;
    
    // Map semantic action to operation
    const operationMap: Record<string, string> = {
      'create_task': 'create',
      'get_task': 'get',
      'list_tasks': 'getAll',
      'update_task': 'update',
      'delete_task': 'delete',
      'complete_task': 'delete', // V1 behavior: completion = deletion for reminders
      'create_multiple_tasks': 'createMultiple',
      'add_subtask': 'addSubtask',
      'update_multiple_tasks': 'updateMultiple',
      'delete_multiple_tasks': 'deleteMultiple',
      'delete_all_tasks': 'deleteAll',
    };
    
    const operation = operationMap[action] || 'getAll';
    
    // Build args based on operation
    const args: Record<string, any> = { operation };
    
    switch (operation) {
      case 'create':
        args.text = constraints.text;
        if (constraints.category) args.category = constraints.category;
        if (constraints.dueDate) {
          args.dueDate = constraints.dueDate;
          // Default reminder to "0 minutes" if dueDate but no reminder specified
          args.reminder = constraints.reminder || '0 minutes';
        }
        if (constraints.recurring) {
          args.reminderRecurrence = this.normalizeReminderRecurrence(constraints.reminderRecurrence);
        }
        break;
        
      case 'createMultiple':
        args.tasks = (constraints.tasks || []).map((task: any) => {
          const t: any = { text: task.text };
          if (task.category) t.category = task.category;
          if (task.dueDate) {
            t.dueDate = task.dueDate;
            t.reminder = task.reminder || '0 minutes';
          }
          if (task.reminderRecurrence) {
            t.reminderRecurrence = this.normalizeReminderRecurrence(task.reminderRecurrence);
          }
          return t;
        });
        break;
        
      case 'get':
        args.taskId = constraints.taskId;
        if (!args.taskId && constraints.text) {
          args.text = constraints.text;
        }
        break;
        
      case 'getAll':
        if (constraints.filters) args.filters = constraints.filters;
        if (constraints.window) {
          args.filters = { ...args.filters, window: constraints.window };
        }
        break;
        
      case 'update':
        // For update, prefer text-based lookup (V1 pattern)
        if (constraints.text) args.text = constraints.text;
        if (constraints.taskId) args.taskId = constraints.taskId;
        
        // Build reminderDetails for reminder updates
        if (changes.dueDate || changes.reminder || changes.reminderRecurrence) {
          args.reminderDetails = {};
          if (changes.dueDate) args.reminderDetails.dueDate = changes.dueDate;
          if (changes.reminder) args.reminderDetails.reminder = changes.reminder;
          if (changes.reminderRecurrence) {
            args.reminderDetails.reminderRecurrence = this.normalizeReminderRecurrence(changes.reminderRecurrence);
          }
        }
        
        // Other field updates
        if (changes.text) args.newText = changes.text;
        if (changes.category) args.category = changes.category;
        break;
        
      case 'updateMultiple':
        args.updates = (constraints.updates || []).map((u: any) => ({
          text: u.text,
          reminderDetails: u.reminderDetails,
        }));
        break;
        
      case 'delete':
        if (constraints.taskId) args.taskId = constraints.taskId;
        if (constraints.text) args.text = constraints.text;
        break;
        
      case 'deleteAll':
        args.where = constraints.where || {};
        args.preview = false; // V1: No confirmation needed
        break;
        
      case 'addSubtask':
        args.taskId = constraints.taskId;
        args.text = constraints.text;
        args.subtaskText = constraints.subtaskText;
        break;
    }
    
    // Handle disambiguation for operations that need task lookup
    if (['update', 'delete'].includes(operation) && !args.taskId && !args.text) {
      if (constraints.taskText) {
        args.text = constraints.taskText;
      }
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
  }
  
  /**
   * Normalize reminder recurrence to V1 format
   */
  private normalizeReminderRecurrence(recurrence: any): any {
    if (!recurrence) return undefined;
    
    const normalized: any = { type: recurrence.type };
    
    switch (recurrence.type) {
      case 'daily':
        normalized.time = recurrence.time || '08:00';
        break;
      case 'weekly':
        normalized.days = recurrence.days || [0];
        normalized.time = recurrence.time || '08:00';
        break;
      case 'monthly':
        normalized.dayOfMonth = recurrence.dayOfMonth || 1;
        normalized.time = recurrence.time || '09:00';
        break;
      case 'nudge':
        normalized.interval = recurrence.interval || '10 minutes';
        break;
    }
    
    if (recurrence.until) normalized.until = recurrence.until;
    
    return normalized;
  }
  
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'database';
  }
}

// ============================================================================
// DATABASE LIST RESOLVER
// ============================================================================

/**
 * DatabaseListResolver - List CRUD operations
 * 
 * V1 CRITICAL RULE:
 * ONLY use listOperations when user explicitly says "list" (EN) or "רשימה" (HE)
 * Otherwise, create tasks instead.
 * 
 * Actions: create_list, get_list, list_lists, update_list, delete_list, add_item, toggle_item
 */
export class DatabaseListResolver extends LLMResolver {
  readonly name = 'database_list_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'create_list',
    'get_list',
    'list_lists',
    'update_list',
    'delete_list',
    'add_item',
    'toggle_item',
    'delete_item',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A LIST MANAGEMENT AGENT.

## CRITICAL RULE - LIST KEYWORD DETECTION:
ONLY use listOperations when user EXPLICITLY says "list" (English) or "רשימה" (Hebrew).

Examples that SHOULD create lists:
- "create a list for groceries" → listOperations
- "תיצור רשימה חדשה" → listOperations
- "תוסיף לרשימה את הפריט" → listOperations
- "make a list and add..." → listOperations

Examples that should NOT create lists (route to tasks instead):
- "אני רוצה ללמוד את הדברים הבאים: 1. ... 2. ..." → Use tasks (createMultiple)
- "things to do: item1, item2" → Use tasks (createMultiple)
- Any enumeration WITHOUT the word "list"/"רשימה" → Use tasks

## AVAILABLE OPERATIONS:
- **create**: Create a new list with optional items
- **get**: Get a specific list by ID or name
- **getAll**: List all user's lists
- **update**: Update list name or items
- **delete**: Delete a list
- **addItem**: Add item to existing list
- **toggleItem**: Toggle item completed status
- **deleteItem**: Remove item from list

## OUTPUT FORMAT for create:
{
  "operation": "create",
  "name": "List name",
  "items": ["item 1", "item 2"],
  "isChecklist": true
}

## OUTPUT FORMAT for addItem:
{
  "operation": "addItem",
  "listId": "list ID (if known)",
  "listName": "list name (for lookup)",
  "item": "new item text"
}

## NO CONFIRMATION FOR DELETIONS:
All delete operations execute immediately without confirmation.

## EXAMPLES:

Example 1 - Create shopping list:
User: "תיצור רשימה לקניות: חלב, לחם, ביצים"
→ { "operation": "create", "name": "קניות", "items": ["חלב", "לחם", "ביצים"], "isChecklist": true }

Example 2 - Add to existing list:
User: "תוסיף לרשימת הקניות חמאה"
→ { "operation": "addItem", "listName": "קניות", "item": "חמאה" }

Example 3 - Delete list:
User: "תמחק את רשימת הקניות"
→ { "operation": "delete", "listName": "קניות" }

Example 4 - Get all lists:
User: "אילו רשימות יש לי?"
→ { "operation": "getAll" }

Output only the JSON, no explanation.`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'listOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['create', 'get', 'getAll', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem'],
          },
          listId: { type: 'string', description: 'List ID (only if known)' },
          listName: { type: 'string', description: 'List name for lookup' },
          name: { type: 'string', description: 'List name (for create/update)' },
          items: { type: 'array', items: { type: 'string' }, description: 'List items' },
          item: { type: 'string', description: 'Single item text' },
          itemIndex: { type: 'number', description: 'Item index for toggle/delete' },
          isChecklist: { type: 'boolean', description: 'Whether list has checkboxes' },
          selectedIndex: { type: 'number', description: 'For disambiguation selection' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action, constraints, changes } = step;
    
    // Map semantic action to operation
    const operationMap: Record<string, string> = {
      'create_list': 'create',
      'get_list': 'get',
      'list_lists': 'getAll',
      'update_list': 'update',
      'delete_list': 'delete',
      'add_item': 'addItem',
      'toggle_item': 'toggleItem',
      'delete_item': 'deleteItem',
    };
    
    const operation = operationMap[action] || 'getAll';
    
    // Build args based on operation
    const args: Record<string, any> = { operation };
    
    switch (operation) {
      case 'create':
        args.name = constraints.name;
        if (constraints.items) args.items = constraints.items;
        args.isChecklist = constraints.isChecklist !== false; // Default to checklist
        break;
        
      case 'get':
        if (constraints.listId) args.listId = constraints.listId;
        if (constraints.listName || constraints.name) {
          args.listName = constraints.listName || constraints.name;
        }
        break;
        
      case 'getAll':
        // No additional args needed
        break;
        
      case 'update':
        if (constraints.listId) args.listId = constraints.listId;
        if (constraints.listName) args.listName = constraints.listName;
        if (changes.name) args.name = changes.name;
        if (changes.items) args.items = changes.items;
        break;
        
      case 'delete':
        if (constraints.listId) args.listId = constraints.listId;
        if (constraints.listName || constraints.name) {
          args.listName = constraints.listName || constraints.name;
        }
        break;
        
      case 'addItem':
        if (constraints.listId) args.listId = constraints.listId;
        if (constraints.listName) args.listName = constraints.listName;
        args.item = constraints.item || constraints.text;
        break;
        
      case 'toggleItem':
      case 'deleteItem':
        if (constraints.listId) args.listId = constraints.listId;
        if (constraints.listName) args.listName = constraints.listName;
        args.itemIndex = constraints.itemIndex;
        break;
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
  }
  
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'database';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createDatabaseTaskResolver() {
  const resolver = new DatabaseTaskResolver();
  return resolver.asNodeFunction();
}

export function createDatabaseListResolver() {
  const resolver = new DatabaseListResolver();
  return resolver.asNodeFunction();
}
