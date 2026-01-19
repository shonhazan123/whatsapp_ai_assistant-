/**
 * Database Resolvers
 * 
 * Converts database-related PlanSteps into task/list operation arguments.
 * 
 * Each resolver uses its OWN LLM call with domain-specific prompts to:
 * 1. Determine the specific operation (create, update, delete, etc.)
 * 2. Extract all required fields from the user's natural language
 * 
 * Based on V1: src/agents/functions/DatabaseFunctions.ts
 *              src/config/system-prompts.ts (getDatabaseAgentPrompt)
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
 * Uses LLM to determine operation and extract fields from natural language.
 */
export class DatabaseTaskResolver extends LLMResolver {
  readonly name = 'database_task_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'task_operation',  // Generic - LLM will determine specific operation
    'create_task',
    'get_task',
    'list_tasks',
    'update_task',
    'delete_task',
    'complete_task',
    'create_multiple_tasks',
    'add_subtask',
    'update_multiple_tasks',
    'update_all_tasks',
    'delete_multiple_tasks',
    'delete_all_tasks',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A DATABASE-INTEGRATED AGENT FOR REMINDER AND TASK MANAGEMENT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into structured JSON for the taskOperations function.
You handle REMINDERS and to-do items - NOT calendar events.

## ⚠️ CRITICAL RULES ⚠️

### NUDGE vs DAILY - KEY RULE
**"כל X דקות/שעות" or "every X minutes/hours" → type: "nudge" + interval field**
**"כל יום ב-X" or "every day at X" → type: "daily" + time field**

### OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to CREATE something new → "create" or "createMultiple"
- User wants to SEE/LIST items → "getAll"
- User wants to FIND specific item → "get"
- User asks "מה יש לי"/"what do I have" → "getAll"
- User says "סיימתי"/"done"/"עשיתי" → "delete" (completion = deletion for reminders)
- User wants to UPDATE/CHANGE → "update"
- User wants to DELETE/REMOVE/CANCEL → "delete" or "deleteAll"
- Multiple items mentioned → use "createMultiple" or "deleteMultiple"

## CONTEXT EXTRACTION RULES

### CRITICAL: Always Extract Task Context from Enhanced Message and Recent Conversation

The user message you receive may be enhanced with context:
- The message may start with "[Replying to: ...]" indicating the user is replying to a previous message
- Recent conversation history is provided below the user message

**When user says completion words without task name** ("סיימתי", "done", "עשיתי", "כן"):
1. Check if message starts with "[Replying to: ...]" - extract task name from the replied-to content
2. Check recent conversation for assistant messages mentioning tasks
3. Look for task lists, reminders, or task mentions in recent messages
4. Extract the task text and populate the "text" field

**Examples of context extraction**:
- User message contains: "[Replying to: \"תזכורת: לבדוק את הפיצ'ר\"]" followed by "סיימתי"
  → Extract: { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

- Recent conversation shows assistant said: "יש לך 2 משימות: 1. לקנות חלב 2. לנקות הבית"
  User message: "סיימתי את שתיהן"
  → Extract: { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

- User message contains: "[Replying to: \"האם התכוונת למשימה...\"]" followed by "כן"
  → Extract task name from the replied-to message and use: { "operation": "delete", "text": "extracted task name" }

**If no context found**: Still populate "text" field with empty string or best guess, let EntityResolver handle disambiguation.

## AVAILABLE OPERATIONS:
- **create**: Create a single task/reminder
- **createMultiple**: Create multiple tasks at once (use when user mentions multiple items)
- **get**: Get a specific task by text
- **getAll**: List all tasks with optional filters
- **update**: Update task properties or add reminder
- **updateMultiple**: Update multiple tasks at once (use "updates" array with "text" to identify each task)
- **updateAll**: Update all tasks matching a filter (use for bulk changes like "move all overdue to tomorrow")
- **delete**: Delete a single task
- **deleteMultiple**: Delete multiple specific tasks (use "tasks" array with "text" to identify each)
- **deleteAll**: Delete all tasks matching a filter (with optional "where" filter)
- **complete**: Mark task as complete (same as delete for reminders)
- **addSubtask**: Add a subtask to a parent task

## OUTPUT FORMAT:
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
Current time: Thursday, 02/01/2025 14:00
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

Example 6a - Complete/delete a task (with task name in message):
User: "סיימתי לבדוק את הפיצ'ר"
→ { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

Example 6b - Complete/delete a task (extracting from reply context):
User message: "[Replying to: \"תזכורת: לבדוק את הפיצ'ר\"]\n\nסיימתי"
→ { "operation": "delete", "text": "לבדוק את הפיצ'ר" }

Example 6c - Complete multiple tasks (extracting from recent conversation):
Recent conversation: assistant: "יש לך 2 משימות: 1. לקנות חלב 2. לנקות הבית"
User: "סיימתי את שתיהן"
→ { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

Example 6d - Confirm disambiguation (extracting from reply context):
User message: "[Replying to: \"האם התכוונת למשימה \\\"לבדוק אם אלי דלתות מגיע ולפנות את החדר עבודה (one-time)\"? (כן/לא)\"]\n\nכן"
→ { "operation": "delete", "text": "לבדוק אם אלי דלתות מגיע ולפנות את החדר עבודה" }

Example 7 - List tasks:
User: "מה התזכורות שלי להיום?"
→ { "operation": "getAll", "filters": { "window": "today" } }

Example 8 - Delete all overdue:
User: "תמחק את כל המשימות שזמנם עבר"
→ { "operation": "deleteAll", "where": { "window": "overdue" }, "preview": false }

Example 9 - Update task:
User: "תשנה את התזכורת לקנות חלב ל-10 בבוקר"
→ { "operation": "update", "text": "לקנות חלב", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } }

Example 10 - Simple reminder without time:
User: "תזכיר לי לקנות מתנה"
→ { "operation": "create", "text": "לקנות מתנה" }

Example 11 - Update multiple tasks:
User: "תשנה את שתי המשימות האלה: לקנות חלב ולנקות הבית ל-10 בבוקר"
→ {
  "operation": "updateMultiple",
  "updates": [
    { "text": "לקנות חלב", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } },
    { "text": "לנקות הבית", "reminderDetails": { "dueDate": "2025-01-03T10:00:00+02:00" } }
  ]
}

Example 12 - Delete multiple specific tasks:
User: "תמחק את המשימה לקנות חלב ואת המשימה לנקות הבית"
→ { "operation": "deleteMultiple", "tasks": [{"text": "לקנות חלב"}, {"text": "לנקות הבית"}] }

Example 13 - Delete all tasks (no filter):
User: "תמחק את כל המשימות שלי"
→ { "operation": "deleteAll", "where": {}, "preview": false }

Example 14 - Update all overdue tasks:
User: "תזיז את כל המשימות שעברו לשעה 10 מחר"
→ { "operation": "updateAll", "where": { "window": "overdue" }, "patch": { "dueDate": "2025-01-03T10:00:00+02:00" } }

Example 15 - Delete all overdue tasks:
User: "תמחק את כל המשימות שעברו"
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
            enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'updateAll',
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
            description: 'Filters for getAll',
            properties: {
              completed: { type: 'boolean' },
              category: { type: 'string' },
              window: { type: 'string', enum: ['today', 'this_week', 'overdue', 'upcoming'] },
              reminderRecurrence: { type: 'string', enum: ['none', 'any', 'daily', 'weekly', 'monthly'] },
            },
          },
          tasks: {
            type: 'array',
            description: 'Array of tasks for createMultiple OR deleteMultiple. For deleteMultiple, each object must have "text" to identify the task.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Task text - used to identify for delete, or content for create' },
                category: { type: 'string' },
                dueDate: { type: 'string' },
                reminder: { type: 'string' },
                reminderRecurrence: { type: 'object' },
              },
            },
          },
          updates: {
            type: 'array',
            description: 'Array of updates for updateMultiple. Each object must have "text" to identify the task and "reminderDetails" with new values.',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Task text to identify which task to update' },
                reminderDetails: { type: 'object', description: 'New values: { dueDate, reminder, reminderRecurrence }' },
              },
            },
          },
          where: {
            type: 'object',
            description: 'Filter for deleteAll/updateAll bulk operations',
            properties: {
              window: { 
                type: 'string', 
                enum: ['today', 'this_week', 'overdue', 'upcoming', 'all'],
                description: 'Time window filter: today, this_week, overdue, upcoming, all' 
              },
              reminderRecurrence: { type: 'string' },
            },
          },
          patch: {
            type: 'object',
            description: 'Fields to update for updateAll bulk operation',
            properties: {
              dueDate: { type: 'string', description: 'New due date (ISO format)' },
              category: { type: 'string' },
              completed: { type: 'boolean' },
              reminder: { type: 'string' },
              reminderRecurrence: { type: 'object' },
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
    // Always use LLM to extract operation and fields from natural language
    try {
      console.log(`[${this.name}] Calling LLM to extract task operation from: "${step.constraints.rawMessage?.substring(0, 50)}..."`);
      
      const args = await this.callLLM(step, state);
      
      // Validate that we got an operation
      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'getAll'`);
        args.operation = 'getAll';
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      // Normalize reminderRecurrence if present
      if (args.reminderRecurrence) {
        args.reminderRecurrence = this.normalizeReminderRecurrence(args.reminderRecurrence);
      }
      
      // Normalize tasks array if present
      if (args.tasks && Array.isArray(args.tasks)) {
        args.tasks = args.tasks.map((task: any) => {
          if (task.reminderRecurrence) {
            task.reminderRecurrence = this.normalizeReminderRecurrence(task.reminderRecurrence);
          }
          return task;
        });
      }
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          ...args,
          _entityType: 'task',  // Explicit entity type for downstream routing
        },
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback: try to infer basic operation from raw message
      return this.createFallbackArgs(step, state);
    }
  }
  
  /**
   * Fallback when LLM fails - basic inference from keywords
   */
  private createFallbackArgs(step: PlanStep, state: MemoState): ResolverOutput {
    const message = step.constraints.rawMessage || state.input.message || '';
    const lowerMessage = message.toLowerCase();
    
    let operation = 'getAll';
    
    // Basic keyword detection
    if (/מחק|בטל|הסר|delete|remove|cancel/i.test(message)) {
      operation = 'delete';
    } else if (/סיימתי|עשיתי|בוצע|done|complete|finish/i.test(message)) {
      operation = 'delete'; // Completion = deletion for reminders
    } else if (/מה יש|מה התזכורות|הראה|show|list|what.*remind/i.test(message)) {
      operation = 'getAll';
    } else if (/תזכיר|תזכורת|remind|create|add/i.test(message)) {
      operation = 'create';
    } else if (/שנה|עדכן|update|change|move/i.test(message)) {
      operation = 'update';
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args: {
        operation,
        text: message,
        _fallback: true,
        _entityType: 'task',  // Explicit entity type for downstream routing
      },
    };
  }
  
  /**
   * Normalize reminder recurrence to consistent format
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
 * Uses LLM to determine operation and extract fields.
 * 
 * CRITICAL RULE: ONLY use listOperations when user explicitly says "list" (EN) or "רשימה" (HE)
 */
export class DatabaseListResolver extends LLMResolver {
  readonly name = 'database_list_resolver';
  readonly capability: Capability = 'database';
  readonly actions = [
    'list_operation',  // Generic - LLM will determine specific operation
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

## OPERATION SELECTION
Analyze the user's intent:
- User wants to CREATE a new list → "create"
- User wants to SEE all lists → "getAll"
- User wants to ADD item to existing list → "addItem"
- User wants to MARK item as done → "toggleItem"
- User wants to DELETE list → "delete"
- User wants to DELETE item from list → "deleteItem"

Examples that SHOULD create lists:
- "create a list for groceries" → "create"
- "תיצור רשימה חדשה" → "create"
- "תוסיף לרשימה את הפריט" → "addItem"
- "make a list and add..." → "create"

Examples that should NOT be handled by this resolver:
- "אני רוצה ללמוד את הדברים הבאים: 1. ... 2. ..." → Route to TaskResolver
- "things to do: item1, item2" → Route to TaskResolver
- Any enumeration WITHOUT the word "list"/"רשימה" → Route to TaskResolver

## AVAILABLE OPERATIONS:
- **create**: Create a new list with optional items
- **get**: Get a specific list by name
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
  "listName": "list name to find",
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

Example 5 - Toggle item:
User: "סמן את החלב ברשימת הקניות כקנוי"
→ { "operation": "toggleItem", "listName": "קניות", "itemIndex": 0 }

Example 6 - Create list with items:
User: "create a list called 'movies to watch' with Inception, Matrix, and Interstellar"
→ { "operation": "create", "name": "movies to watch", "items": ["Inception", "Matrix", "Interstellar"], "isChecklist": true }

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
          isChecklist: { type: 'boolean', description: 'Whether list has checkboxes (default: true)' },
          selectedIndex: { type: 'number', description: 'For disambiguation selection' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Check if this should actually be a list operation
    const message = step.constraints.rawMessage || state.input.message || '';
    
    // If no explicit list keyword, this might be routed incorrectly
    if (!/list|רשימה/i.test(message)) {
      console.log(`[${this.name}] Message doesn't contain 'list'/'רשימה', might be wrong resolver`);
    }
    
    // Use LLM to extract operation and fields
    try {
      console.log(`[${this.name}] Calling LLM to extract list operation`);
      
      const args = await this.callLLM(step, state);
      
      // Validate operation
      if (!args.operation) {
        args.operation = 'getAll';
      }
      
      // Default isChecklist to true
      if (args.operation === 'create' && args.isChecklist === undefined) {
        args.isChecklist = true;
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          ...args,
          _entityType: 'list',  // Explicit entity type for downstream routing
        },
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'getAll',
          _fallback: true,
          _entityType: 'list',  // Explicit entity type for downstream routing
        },
      };
    }
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
