/**
 * Resolution Configuration
 * 
 * Centralized thresholds and behaviors for entity resolution.
 * Based on V1's proven values.
 */

// ============================================================================
// THRESHOLDS
// ============================================================================

export const RESOLUTION_THRESHOLDS = {
  /**
   * Minimum fuzzy match score to consider a candidate
   * V1: FuzzyMatcher default threshold = 0.6
   */
  FUZZY_MATCH_MIN: 0.6,
  
  /**
   * Minimum score for low-confidence matches that require user confirmation
   * Matches between LOW_CONFIDENCE_MIN and FUZZY_MATCH_MIN will ask user to confirm
   */
  LOW_CONFIDENCE_MIN: 0.1,
  
  /**
   * Score above which we consider it a high-confidence match
   * If only one match above this, auto-resolve
   */
  HIGH_CONFIDENCE: 0.85,
  
  /**
   * Score above which we consider text "exactly the same"
   * Used for grouping identical items
   */
  EXACT_MATCH: 0.95,
  
  /**
   * Minimum gap between top 2 scores to avoid disambiguation
   * V1: QueryResolver uses 0.15 gap
   */
  DISAMBIGUATION_GAP: 0.15,
  
  /**
   * Calendar-specific threshold for delete operations
   * V1: CalendarFunction.DELETE_EVENT_SUMMARY_THRESHOLD = 0.6
   */
  CALENDAR_DELETE_THRESHOLD: 0.6,
} as const;

// ============================================================================
// BEHAVIOR CONFIGURATION
// ============================================================================

export interface OperationBehavior {
  /**
   * 'single' - Must resolve to exactly one entity
   * 'all' - Resolve all matches
   * 'nearest' - Pick the nearest upcoming (for calendar)
   */
  multipleMatchBehavior: 'single' | 'all' | 'nearest';
  
  /**
   * Whether to trigger disambiguation when multiple matches found
   */
  disambiguateOnMultiple: boolean;
  
  /**
   * Allow user to select "both" or "all" in disambiguation
   */
  allowSelectAll: boolean;
  
  /**
   * For tasks: check if items are truly identical before auto-resolving
   */
  checkFieldsForIdentity: boolean;
}

/**
 * Operation-specific behaviors
 */
export const OPERATION_BEHAVIORS: Record<string, OperationBehavior> = {
  // Calendar operations
  'calendar.get': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'calendar.update': {
    multipleMatchBehavior: 'nearest',  // V1: picks nearest upcoming
    disambiguateOnMultiple: false,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'calendar.delete': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'calendar.delete_window': {
    multipleMatchBehavior: 'all',  // Delete all in window
    disambiguateOnMultiple: false,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'calendar.deleteBySummary': {
    multipleMatchBehavior: 'all',  // Delete all matching
    disambiguateOnMultiple: false,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  
  // Database task operations
  'database.task.get': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: true,
  },
  'database.task.update': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: true,
  },
  'database.task.delete': {
    multipleMatchBehavior: 'all',  // V1: deletes ALL matching
    disambiguateOnMultiple: false,  // But check if truly identical
    allowSelectAll: true,
    checkFieldsForIdentity: true,  // Check if same text + fields
  },
  'database.task.complete': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: true,
  },
  
  // Database list operations
  'database.list.get': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'database.list.update': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'database.list.delete': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  
  // Gmail operations
  'gmail.get': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  'gmail.reply': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
  
  // Default
  'default': {
    multipleMatchBehavior: 'single',
    disambiguateOnMultiple: true,
    allowSelectAll: false,
    checkFieldsForIdentity: false,
  },
};

/**
 * Get operation behavior config
 */
export function getOperationBehavior(domain: string, operation: string): OperationBehavior {
  const key = `${domain}.${operation}`;
  return OPERATION_BEHAVIORS[key] || OPERATION_BEHAVIORS['default'];
}

// ============================================================================
// TIME WINDOW DEFAULTS
// ============================================================================

export const TIME_WINDOW_DEFAULTS = {
  /**
   * Default window for calendar searches when no time specified
   */
  CALENDAR_DEFAULT_DAYS_BACK: 1,
  CALENDAR_DEFAULT_DAYS_FORWARD: 90,
  
  /**
   * Default window for getEvents when only "today" implied
   */
  CALENDAR_TODAY_HOURS: 24,
  
  /**
   * Window for "this week" queries
   */
  CALENDAR_WEEK_DAYS: 7,
} as const;

// ============================================================================
// DISAMBIGUATION MESSAGES
// ============================================================================

export const DISAMBIGUATION_MESSAGES = {
  he: {
    // Task messages
    task_multiple_similar: 'מצאתי משימות דומות:\n{options}\n\nאיזו התכוונת? (או "שניהם" לבחירת כולם)',
    task_same_text_different_fields: 'מצאתי כמה משימות עם שם דומה אך הגדרות שונות:\n{options}\n\nאיזו התכוונת?',
    task_not_found: 'לא מצאתי משימה התואמת ל-"{searchedFor}"',
    task_confirm_match: 'האם התכוונת למשימה "{name}"? (כן/לא)',
    
    // Calendar messages
    event_multiple: 'מצאתי מספר אירועים תואמים:\n{options}\n\nאיזה התכוונת?',
    event_not_found: 'לא מצאתי אירוע התואם ל-"{searchedFor}"',
    event_specify_time: 'נא לציין זמן ספציפי יותר',
    recurring_choice: 'האירוע שאתה מנסה לשנות הוא אירוע חוזר כל {recurrence}.\nהאם תרצה לשנות את כולם או רק את המופע הזה?',
    
    // List messages
    list_multiple: 'מצאתי כמה רשימות תואמות:\n{options}\n\nאיזו התכוונת?',
    list_not_found: 'לא מצאתי רשימה התואמת ל-"{searchedFor}"',
    list_confirm_match: 'האם התכוונת לרשימה "{name}"? (כן/לא)',
    
    // Email messages
    email_multiple: 'מצאתי כמה אימיילים תואמים:\n{options}\n\nאיזה התכוונת?',
    email_not_found: 'לא מצאתי אימייל התואם ל-"{searchedFor}"',
    
    // Generic
    select_number: 'נא לבחור מספר.',
    or_both: ' (או "שניהם" לבחירת כולם)',
  },
  en: {
    // Task messages
    task_multiple_similar: 'I found similar tasks:\n{options}\n\nWhich one? (or "both" for all)',
    task_same_text_different_fields: 'I found tasks with similar names but different settings:\n{options}\n\nWhich one did you mean?',
    task_not_found: 'No task matching "{searchedFor}" found',
    task_confirm_match: 'Did you mean the task "{name}"? (yes/no)',
    
    // Calendar messages
    event_multiple: 'I found multiple matching events:\n{options}\n\nWhich one did you mean?',
    event_not_found: 'No event matching "{searchedFor}" found',
    event_specify_time: 'Please specify a more specific time',
    recurring_choice: 'The event you\'re trying to modify recurs every {recurrence}.\nDo you want to modify all occurrences or just this instance?',
    
    // List messages
    list_multiple: 'I found multiple matching lists:\n{options}\n\nWhich one?',
    list_not_found: 'No list matching "{searchedFor}" found',
    list_confirm_match: 'Did you mean the list "{name}"? (yes/no)',
    
    // Email messages
    email_multiple: 'I found multiple matching emails:\n{options}\n\nWhich one?',
    email_not_found: 'No email matching "{searchedFor}" found',
    
    // Generic
    select_number: 'Please reply with a number.',
    or_both: ' (or "both" for all)',
  },
} as const;

/**
 * Get localized message
 */
export function getDisambiguationMessage(
  key: keyof typeof DISAMBIGUATION_MESSAGES['en'],
  language: 'he' | 'en' | 'other',
  replacements?: Record<string, string>
): string {
  const lang = language === 'other' ? 'en' : language;
  let message: string = DISAMBIGUATION_MESSAGES[lang][key] || DISAMBIGUATION_MESSAGES['en'][key];
  
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      message = message.replace(`{${k}}`, v);
    }
  }
  
  return message;
}

// ============================================================================
// REMINDER TYPE TRANSLATIONS
// ============================================================================

export const REMINDER_TYPE_TRANSLATIONS = {
  he: {
    'nudge': 'נדנוד',
    'daily': 'יומי',
    'weekly': 'שבועי',
    'monthly': 'חודשי',
    'one-time': 'חד פעמי',
    'none': 'ללא תזכורת',
  },
  en: {
    'nudge': 'nudge',
    'daily': 'daily',
    'weekly': 'weekly',
    'monthly': 'monthly',
    'one-time': 'one-time',
    'none': 'no reminder',
  },
} as const;

export function translateReminderType(type: string, language: 'he' | 'en' | 'other'): string {
  const lang = language === 'other' ? 'en' : language;
  return REMINDER_TYPE_TRANSLATIONS[lang][type as keyof typeof REMINDER_TYPE_TRANSLATIONS['en']] || type;
}

