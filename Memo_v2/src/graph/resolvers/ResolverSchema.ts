/**
 * ResolverSchema - Structured capability definitions for each resolver
 * 
 * This module provides the Planner with explicit contract information about
 * what each resolver can handle, enabling deterministic routing decisions.
 * 
 * Each schema includes:
 * - Name and capability
 * - Summary of responsibilities
 * - Action hints the resolver handles
 * - Trigger patterns (Hebrew + English) for pattern matching
 * - Examples for the LLM to learn from
 */

import type { Capability } from '../../types/index.js';

// ============================================================================
// SCHEMA INTERFACE
// ============================================================================

export interface ResolverSchema {
  /** Resolver name (e.g., "calendar_find_resolver") */
  name: string;
  
  /** Capability domain (calendar, database, gmail, second-brain, general, meta) */
  capability: Capability;
  
  /** Brief description for Planner context */
  summary: string;
  
  /** Action hints this resolver can handle */
  actionHints: string[];
  
  /** Trigger patterns for pattern matching */
  triggerPatterns: {
    /** Hebrew keywords/phrases that trigger this resolver */
    hebrew: string[];
    /** English keywords/phrases that trigger this resolver */
    english: string[];
  };
  
  /** Examples for the LLM to learn from */
  examples: Array<{
    /** Example user message */
    input: string;
    /** Expected action hint */
    action: string;
  }>;
  
  /** Priority for conflict resolution (higher = checked first) */
  priority: number;
}

// ============================================================================
// RESOLVER SCHEMAS
// ============================================================================

/**
 * CalendarFindResolver Schema
 * Handles: Query/search calendar events, check schedule, find conflicts
 */
export const CALENDAR_FIND_SCHEMA: ResolverSchema = {
  name: 'calendar_find_resolver',
  capability: 'calendar',
  summary: 'Query and search calendar events. Lists events, checks schedule, finds specific events, analyzes availability and conflicts.',
  actionHints: [
    'list_events',
    'find_event',
    'get_events',
    'check_conflicts',
    'check_availability',
    'get_recurring',
    'analyze_schedule',
  ],
  triggerPatterns: {
    hebrew: [
      'מה יש לי',
      'מה האירועים',
      'מתי יש לי',
      'מתי הפגישה',
      'הראה לי את היומן',
      'האם יש לי משהו',
      'האם אני פנוי',
      'בדוק את הלוז',
      'מה בלוז',
      'מה ביומן',
      'כמה שעות',
    ],
    english: [
      'what do i have',
      'what events',
      'when is my',
      'show my calendar',
      'show my schedule',
      'am i free',
      'am i available',
      'check calendar',
      'check schedule',
      'what\'s on',
      'how many hours',
    ],
  },
  examples: [
    { input: 'מה האירועים שלי מחר?', action: 'list events' },
    { input: 'מתי הפגישה עם דני?', action: 'find event' },
    { input: 'האם יש לי משהו ביום שני?', action: 'check availability' },
    { input: 'מה יש לי השבוע?', action: 'list events' },
    { input: 'כמה שעות עבודה יש לי השבוע?', action: 'analyze schedule' },
    { input: 'What do I have tomorrow?', action: 'list events' },
    { input: 'When is my meeting with Sarah?', action: 'find event' },
  ],
  priority: 50,
};

/**
 * CalendarMutateResolver Schema
 * Handles: Create/update/delete calendar events
 */
export const CALENDAR_MUTATE_SCHEMA: ResolverSchema = {
  name: 'calendar_mutate_resolver',
  capability: 'calendar',
  summary: 'Create, update, and delete calendar events. Handles single events, multiple events, recurring events, and event modifications.',
  actionHints: [
    'create_event',
    'create_multiple_events',
    'create_recurring',
    'update_event',
    'delete_event',
    'move_event',
    'cancel_event',
  ],
  triggerPatterns: {
    hebrew: [
      'תוסיף ליומן',
      'תקבע',
      'קבע לי',
      'צור אירוע',
      'שים ביומן',
      'הוסף פגישה',
      'מחק אירוע',
      'בטל פגישה',
      'הזז את',
      'שנה את הפגישה',
      'עדכן אירוע',
      'כל יום',
      'כל שבוע',
    ],
    english: [
      'add to calendar',
      'schedule',
      'create event',
      'book',
      'set up meeting',
      'delete event',
      'cancel meeting',
      'move the',
      'reschedule',
      'update event',
      'change the meeting',
      'every day',
      'every week',
      'recurring',
    ],
  },
  examples: [
    { input: 'תקבע פגישה עם דני מחר ב-10', action: 'create event' },
    { input: 'תוסיף ליומן ארוחת צהריים ביום רביעי', action: 'create event' },
    { input: 'מחק את הפגישה של מחר', action: 'delete event' },
    { input: 'הזז את הפגישה עם שרה לשעה 3', action: 'update event' },
    { input: 'עבודה כל יום א\', ג\', ד\' מ-9 עד 18', action: 'create recurring' },
    { input: 'Schedule a meeting with John tomorrow at 2pm', action: 'create event' },
    { input: 'Cancel my 3pm appointment', action: 'delete event' },
  ],
  priority: 49, // Slightly lower than find to prefer read operations when ambiguous
};

/**
 * DatabaseTaskResolver Schema
 * Handles: Tasks and reminders CRUD operations
 */
export const DATABASE_TASK_SCHEMA: ResolverSchema = {
  name: 'database_task_resolver',
  capability: 'database',
  summary: 'Manage tasks and reminders. Create, complete, update, delete, and list tasks/reminders. Handles one-time and recurring reminders, nudges.',
  actionHints: [
    'create_task',
    'create_reminder',
    'create_multiple_tasks',
    'list_tasks',
    'get_tasks',
    'complete_task',
    'delete_task',
    'delete_reminder',
    'update_task',
  ],
  triggerPatterns: {
    hebrew: [
      'תזכיר לי',
      'תזכורת',
      'משימה',
      'משימות',
      'מה המשימות',
      'מה התזכורות',
      'סיימתי',
      'עשיתי',
      'בוצע',
      'מחק תזכורת',
      'מחק משימה',
      'הוסף משימה',
      'נדנד אותי',
      'תציק לי',
    ],
    english: [
      'remind me',
      'reminder',
      'task',
      'tasks',
      'to-do',
      'todo',
      'what are my tasks',
      'what reminders',
      'done',
      'finished',
      'completed',
      'delete task',
      'delete reminder',
      'add task',
      'nudge me',
    ],
  },
  examples: [
    { input: 'תזכיר לי מחר בשעה 8 לקנות חלב', action: 'create reminder' },
    { input: 'מה המשימות שלי?', action: 'list tasks' },
    { input: 'סיימתי לבדוק את הפיצ\'ר', action: 'complete task' },
    { input: 'מחק את התזכורת של הבוקר', action: 'delete reminder' },
    { input: 'תזכיר לי כל בוקר ב-9 לעשות ספורט', action: 'create reminder' },
    { input: 'Remind me to call mom at 5pm', action: 'create reminder' },
    { input: 'What are my tasks for today?', action: 'list tasks' },
    { input: 'I\'m done with the report', action: 'complete task' },
  ],
  priority: 60, // Higher priority - common use case
};

/**
 * DatabaseListResolver Schema
 * Handles: Named list management (shopping, movies, etc.)
 */
export const DATABASE_LIST_SCHEMA: ResolverSchema = {
  name: 'database_list_resolver',
  capability: 'database',
  summary: 'Manage named lists (shopping, movies, etc.). Create lists, add/remove items, check off items. ONLY when user explicitly says "list" or "רשימה".',
  actionHints: [
    'create_list',
    'add_to_list',
    'delete_list',
    'get_list',
    'list_lists',
    'toggle_item',
    'delete_item',
  ],
  triggerPatterns: {
    hebrew: [
      'רשימה',
      'רשימת',
      'תיצור רשימה',
      'הוסף לרשימה',
      'תוסיף לרשימת',
      'מחק רשימה',
      'אילו רשימות',
    ],
    english: [
      'list',
      'shopping list',
      'create a list',
      'add to list',
      'add to the list',
      'delete list',
      'what lists',
      'my lists',
    ],
  },
  examples: [
    { input: 'תיצור רשימת קניות: חלב, לחם, ביצים', action: 'create list' },
    { input: 'תוסיף לרשימת הקניות חמאה', action: 'add to list' },
    { input: 'אילו רשימות יש לי?', action: 'list lists' },
    { input: 'מחק את רשימת הקניות', action: 'delete list' },
    { input: 'Create a shopping list with milk, bread, eggs', action: 'create list' },
    { input: 'Add butter to my shopping list', action: 'add to list' },
  ],
  priority: 55, // Higher than task for explicit list mentions
};

/**
 * GmailResolver Schema
 * Handles: Email read/send/reply operations
 */
export const GMAIL_SCHEMA: ResolverSchema = {
  name: 'gmail_resolver',
  capability: 'gmail',
  summary: 'Email management. Read inbox, search emails, send new emails, reply to emails, mark as read/unread.',
  actionHints: [
    'list_emails',
    'get_email',
    'search_emails',
    'send_email',
    'reply_email',
    'mark_read',
    'mark_unread',
  ],
  triggerPatterns: {
    hebrew: [
      'מייל',
      'אימייל',
      'מה יש לי במייל',
      'שלח מייל',
      'תשלח מייל',
      'ענה למייל',
      'תענה על המייל',
      'תיבת דואר',
    ],
    english: [
      'email',
      'mail',
      'inbox',
      'check my email',
      'send email',
      'send an email',
      'reply to',
      'reply email',
      'mailbox',
    ],
  },
  examples: [
    { input: 'מה יש לי במייל?', action: 'list emails' },
    { input: 'שלח מייל לדני על הפגישה', action: 'send email' },
    { input: 'תענה על המייל משרה', action: 'reply email' },
    { input: 'האם יש לי מיילים מהבוס?', action: 'search emails' },
    { input: 'Check my email', action: 'list emails' },
    { input: 'Send an email to john@example.com', action: 'send email' },
    { input: 'Reply to Sarah\'s email', action: 'reply email' },
  ],
  priority: 45,
};

/**
 * SecondBrainResolver Schema
 * Handles: Store/search personal knowledge and facts
 */
export const SECONDBRAIN_SCHEMA: ResolverSchema = {
  name: 'secondbrain_resolver',
  capability: 'second-brain',
  summary: 'Personal knowledge management. Store facts, notes, and information. Search and retrieve previously saved memories.',
  actionHints: [
    'store_memory',
    'save_memory',
    'search_memory',
    'find_memory',
    'delete_memory',
    'update_memory',
    'list_memories',
  ],
  triggerPatterns: {
    hebrew: [
      'תזכור ש',
      'זכור ש',
      'שמור ש',
      'שמור את זה',
      'מה אמרתי על',
      'מה שמרתי',
      'מה אתה זוכר',
      'תמחק את מה ששמרתי',
    ],
    english: [
      'remember that',
      'save that',
      'store that',
      'note that',
      'what did i say about',
      'what did i save',
      'what do you remember',
      'delete what i saved',
    ],
  },
  examples: [
    { input: 'תזכור שדני אוהב פיצה', action: 'store memory' },
    { input: 'מה אמרתי על הפרויקט?', action: 'search memory' },
    { input: 'מה שמרתי?', action: 'list memories' },
    { input: 'תמחק את מה ששמרתי על דני', action: 'delete memory' },
    { input: 'Remember that the project deadline is January 15th', action: 'store memory' },
    { input: 'What did I save about the meeting?', action: 'search memory' },
  ],
  priority: 40,
};

/**
 * GeneralResolver Schema
 * Handles: Conversational responses, advice, brainstorming (fallback)
 */
export const GENERAL_SCHEMA: ResolverSchema = {
  name: 'general_resolver',
  capability: 'general',
  summary: 'Conversational responses for questions, advice, brainstorming, and general chat. Used when no specific tool/capability is needed.',
  actionHints: [
    'respond',
    'chat',
    'greet',
    'clarify',
    'acknowledge',
    'advise',
    'brainstorm',
  ],
  triggerPatterns: {
    hebrew: [
      'שלום',
      'היי',
      'בוקר טוב',
      'ערב טוב',
      'תודה',
      'מה שלומך',
      'עזור לי לחשוב',
      'תן לי עצה',
    ],
    english: [
      'hello',
      'hi',
      'hey',
      'good morning',
      'good evening',
      'thanks',
      'thank you',
      'how are you',
      'help me think',
      'give me advice',
    ],
  },
  examples: [
    { input: 'שלום!', action: 'greet' },
    { input: 'תודה על העזרה', action: 'acknowledge' },
    { input: 'עזור לי לחשוב על רעיונות לפרויקט', action: 'brainstorm' },
    { input: 'Hello!', action: 'greet' },
    { input: 'Thanks for your help', action: 'acknowledge' },
    { input: 'Help me brainstorm ideas', action: 'brainstorm' },
  ],
  priority: 10, // Lowest priority - fallback
};

/**
 * MetaResolver Schema
 * Handles: Bot capabilities description, help, status
 */
export const META_SCHEMA: ResolverSchema = {
  name: 'meta_resolver',
  capability: 'meta',
  summary: 'Information about the bot itself. Describes capabilities, provides help, shows status and connected services.',
  actionHints: [
    'describe_capabilities',
    'what_can_you_do',
    'help',
    'status',
  ],
  triggerPatterns: {
    hebrew: [
      'מה אתה יכול',
      'מה היכולות שלך',
      'עזרה',
      'איך להשתמש',
      'מה אתה עושה',
      'סטטוס',
    ],
    english: [
      'what can you do',
      'what are your capabilities',
      'help',
      'how to use',
      'what do you do',
      'status',
    ],
  },
  examples: [
    { input: 'מה אתה יכול לעשות?', action: 'describe capabilities' },
    { input: 'עזרה', action: 'help' },
    { input: 'What can you do?', action: 'describe capabilities' },
    { input: 'Help', action: 'help' },
    { input: 'Status', action: 'status' },
  ],
  priority: 100, // Highest priority - meta commands always take precedence
};

// ============================================================================
// SCHEMA REGISTRY
// ============================================================================

/**
 * All resolver schemas in priority order
 */
export const RESOLVER_SCHEMAS: ResolverSchema[] = [
  META_SCHEMA,
  DATABASE_TASK_SCHEMA,
  DATABASE_LIST_SCHEMA,
  CALENDAR_FIND_SCHEMA,
  CALENDAR_MUTATE_SCHEMA,
  GMAIL_SCHEMA,
  SECONDBRAIN_SCHEMA,
  GENERAL_SCHEMA,
].sort((a, b) => b.priority - a.priority);

/**
 * Get all resolver schemas
 */
export function getResolverSchemas(): ResolverSchema[] {
  return RESOLVER_SCHEMAS;
}

/**
 * Get schema by resolver name
 */
export function getSchemaByName(name: string): ResolverSchema | undefined {
  return RESOLVER_SCHEMAS.find(s => s.name === name);
}

/**
 * Get schemas for a specific capability
 */
export function getSchemasForCapability(capability: Capability): ResolverSchema[] {
  return RESOLVER_SCHEMAS.filter(s => s.capability === capability);
}

/**
 * Format schemas as prompt text for the Planner
 */
export function formatSchemasForPrompt(): string {
  const lines: string[] = ['## RESOLVER CAPABILITIES (USE FOR ROUTING)\n'];
  
  for (const schema of RESOLVER_SCHEMAS) {
    lines.push(`### ${schema.name}`);
    lines.push(`- **Capability**: ${schema.capability}`);
    lines.push(`- **Purpose**: ${schema.summary}`);
    lines.push(`- **Actions**: ${schema.actionHints.join(', ')}`);
    lines.push(`- **Patterns HE**: ${schema.triggerPatterns.hebrew.slice(0, 5).join(', ')}`);
    lines.push(`- **Patterns EN**: ${schema.triggerPatterns.english.slice(0, 5).join(', ')}`);
    
    // Add top 2 examples
    const topExamples = schema.examples.slice(0, 2);
    if (topExamples.length > 0) {
      lines.push(`- **Examples**:`);
      for (const ex of topExamples) {
        lines.push(`  - "${ex.input}" → action="${ex.action}"`);
      }
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Pattern matching result
 */
export interface PatternMatchResult {
  schema: ResolverSchema;
  score: number;
  matchedPatterns: string[];
}

/**
 * Match a message against all resolver patterns
 * Returns schemas sorted by match score (highest first)
 */
export function matchPatterns(message: string): PatternMatchResult[] {
  const normalizedMessage = message.toLowerCase();
  const results: PatternMatchResult[] = [];
  
  for (const schema of RESOLVER_SCHEMAS) {
    const matchedPatterns: string[] = [];
    let score = 0;
    
    // Check Hebrew patterns
    for (const pattern of schema.triggerPatterns.hebrew) {
      if (normalizedMessage.includes(pattern.toLowerCase())) {
        matchedPatterns.push(pattern);
        score += 10;
      }
    }
    
    // Check English patterns
    for (const pattern of schema.triggerPatterns.english) {
      if (normalizedMessage.includes(pattern.toLowerCase())) {
        matchedPatterns.push(pattern);
        score += 10;
      }
    }
    
    // Add priority bonus
    score += schema.priority / 10;
    
    if (score > 0) {
      results.push({ schema, score, matchedPatterns });
    }
  }
  
  // Sort by score descending
  return results.sort((a, b) => b.score - a.score);
}

/**
 * Get the best matching schema for a message
 * Returns undefined if no patterns match
 */
export function getBestMatch(message: string): PatternMatchResult | undefined {
  const matches = matchPatterns(message);
  return matches.length > 0 ? matches[0] : undefined;
}

