/**
 * ResponseFormatterNode
 * 
 * Formats execution results for human-readable output.
 * 
 * Based on V1: src/services/response/ResponseFormatter.ts
 * 
 * Responsibilities:
 * - Format dates to human-readable strings
 * - Categorize tasks (overdue, today, upcoming, recurring)
 * - Build CAPABILITY-SPECIFIC response context for templating
 * - Handle Hebrew/English formatting differences
 * 
 * IMPORTANT: V1 services return snake_case fields (due_date, reminder_recurrence)
 * This node uses snake_case consistently - NOT camelCase.
 */

import type {
  CalendarEventResult,
  CalendarResponseContext,
  DatabaseResponseContext,
  DatabaseTaskResult,
  FailedOperationContext,
  FormattedResponse,
  GmailResponseContext,
  GmailResult,
  PlanStep,
  ResponseContext,
  SecondBrainResponseContext,
  SecondBrainResult,
} from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// DATE FORMATTING UTILITIES
// ============================================================================

/**
 * Format ISO date to human-readable string
 */
function formatDate(isoString: string, timezone: string, language: 'he' | 'en' | 'other'): string {
  try {
    const date = new Date(isoString);
    const now = new Date();

    // Get locale based on language
    const locale = language === 'he' ? 'he-IL' : 'en-US';

    // Check if today
    const isToday = date.toDateString() === now.toDateString();

    // Check if tomorrow
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    // Format time
    const timeStr = date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });

    if (isToday) {
      return language === 'he' ? `היום ב-${timeStr}` : `Today at ${timeStr}`;
    }

    if (isTomorrow) {
      return language === 'he' ? `מחר ב-${timeStr}` : `Tomorrow at ${timeStr}`;
    }

    // Full date
    const dateStr = date.toLocaleDateString(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: timezone,
    });

    return `${dateStr}, ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Format relative date (e.g., "2 days ago", "in 3 hours")
 */
function formatRelativeDate(isoString: string, language: 'he' | 'en' | 'other'): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMins = Math.round(diffMs / 60000);
    const diffHours = Math.round(diffMs / 3600000);
    const diffDays = Math.round(diffMs / 86400000);

    if (language === 'he') {
      if (diffMins > 0 && diffMins < 60) return `בעוד ${diffMins} דקות`;
      if (diffMins < 0 && diffMins > -60) return `לפני ${Math.abs(diffMins)} דקות`;
      if (diffHours > 0 && diffHours < 24) return `בעוד ${diffHours} שעות`;
      if (diffHours < 0 && diffHours > -24) return `לפני ${Math.abs(diffHours)} שעות`;
      if (diffDays > 0) return `בעוד ${diffDays} ימים`;
      if (diffDays < 0) return `לפני ${Math.abs(diffDays)} ימים`;
      return 'עכשיו';
    }

    if (diffMins > 0 && diffMins < 60) return `in ${diffMins} minutes`;
    if (diffMins < 0 && diffMins > -60) return `${Math.abs(diffMins)} minutes ago`;
    if (diffHours > 0 && diffHours < 24) return `in ${diffHours} hours`;
    if (diffHours < 0 && diffHours > -24) return `${Math.abs(diffHours)} hours ago`;
    if (diffDays > 0) return `in ${diffDays} days`;
    if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
    return 'now';
  } catch {
    return isoString;
  }
}

/**
 * Recursively format dates in an object
 */
function formatDatesInObject(obj: any, timezone: string, language: 'he' | 'en' | 'other'): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Check if it looks like an ISO date
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(obj)) {
      return formatDate(obj, timezone, language);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => formatDatesInObject(item, timezone, language));
  }

  if (typeof obj === 'object') {
    const formatted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Keep original for date keys, add formatted version
      // IMPORTANT: V1 uses snake_case (due_date, created_at, next_reminder_at)
      if ([
        'start', 'end',
        'due_date', 'created_at', 'updated_at', 'next_reminder_at',  // snake_case from V1
        'dueDate', 'createdAt', 'updatedAt', 'reminderTime',          // camelCase fallback
      ].includes(key)) {
        formatted[key] = value;
        formatted[`${key}_formatted`] = formatDatesInObject(value, timezone, language);
      } else if (['days', 'startTime', 'endTime', 'recurrence', 'reminder_recurrence'].includes(key)) {
        // Preserve recurring event parameters as-is (not dates, don't format)
        formatted[key] = value;
      } else {
        formatted[key] = formatDatesInObject(value, timezone, language);
      }
    }
    return formatted;
  }

  return obj;
}

// ============================================================================
// TASK CATEGORIZATION
// ============================================================================

interface CategorizedTasks {
  overdue: DatabaseTaskResult[];
  today: DatabaseTaskResult[];
  upcoming: DatabaseTaskResult[];
  recurring: DatabaseTaskResult[];
  noDueDate: DatabaseTaskResult[];
}

/**
 * Categorize tasks by their due date status
 * IMPORTANT: V1 TaskService returns snake_case fields (due_date, reminder_recurrence)
 */
function categorizeTasks(tasks: DatabaseTaskResult[]): CategorizedTasks {
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);

  const categories: CategorizedTasks = {
    overdue: [],
    today: [],
    upcoming: [],
    recurring: [],
    noDueDate: [],
  };

  for (const task of tasks) {
    // Check for recurring tasks - use snake_case from V1
    if (task.reminder_recurrence) {
      categories.recurring.push(task);
      continue;
    }

    // Check due date - use snake_case from V1
    if (!task.due_date) {
      categories.noDueDate.push(task);
      continue;
    }

    const dueDate = new Date(task.due_date);

    if (dueDate < now) {
      categories.overdue.push(task);
    } else if (dueDate <= todayEnd) {
      categories.today.push(task);
    } else {
      categories.upcoming.push(task);
    }
  }

  return categories;
}

// ============================================================================
// RESPONSE FORMATTER NODE
// ============================================================================

export class ResponseFormatterNode extends CodeNode {
  readonly name = 'response_formatter';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const executionResults = state.executionResults;
    const plan = state.plannerOutput?.plan || [];
    const language = state.user.language;
    const timezone = state.user.timezone;

    console.log(`[ResponseFormatter] Formatting ${executionResults.size} results`);

    // Determine primary operation from plan
    const primaryStep = plan[0];
    const capability = primaryStep?.capability || 'general';
    const action = primaryStep?.action || 'respond';

    // Collect successful data AND failed operations
    const allData: any[] = [];
    const failedOperations: FailedOperationContext[] = [];

    for (const [stepId, result] of executionResults) {
      if (result.success && result.data) {
        allData.push(result.data);
      } else if (!result.success) {
        // Build failed operation context
        const step = plan.find(s => s.id === stepId);
        const failedOp = this.buildFailedOperationContext(stepId, result.error || 'Unknown error', step, state);
        failedOperations.push(failedOp);
        console.log(`[ResponseFormatter] Captured failed operation: ${failedOp.capability}/${failedOp.operation} - ${failedOp.errorMessage}`);
      }
    }

    // Skip formatting for general responses (no function calls, already LLM-generated)
    // General responses come from GeneralResolver and already have response text in data.response
    if (capability === 'general') {
      console.log('[ResponseFormatter] Skipping formatting for general response (already LLM-generated)');

      // For general responses, we still create a FormattedResponse but with minimal processing
      const formattedResponse: FormattedResponse = {
        agent: capability,
        operation: action,
        entityType: 'message',
        rawData: allData,
        formattedData: allData, // No date formatting needed
        context: {
          capability: 'general',
          // No capability-specific context for general responses
        },
        failedOperations: failedOperations.length > 0 ? failedOperations : undefined,
      };

      return {
        formattedResponse,
      };
    }

    // For function call results (calendar, database, gmail, second-brain), format dates and categorize

    // Build response context
    const context = this.buildResponseContext(allData, capability, action);

    // Format dates in all data
    const formattedData = formatDatesInObject(allData, timezone, language);

    // Build formatted response
    const formattedResponse: FormattedResponse = {
      agent: capability,
      operation: action,
      entityType: this.determineEntityType(capability, action),
      rawData: allData,
      formattedData,
      context,
      failedOperations: failedOperations.length > 0 ? failedOperations : undefined,
    };

    console.log(`[ResponseFormatter] Built response for ${capability}:${action}` +
      (failedOperations.length > 0 ? ` with ${failedOperations.length} failed operation(s)` : ''));

    return {
      formattedResponse,
    };
  }

  /**
   * Build context for a failed operation
   */
  private buildFailedOperationContext(
    stepId: string,
    errorMessage: string,
    step: PlanStep | undefined,
    state: MemoState
  ): FailedOperationContext {
    const capability = step?.capability || 'unknown';
    const action = step?.action || 'unknown';

    // Try to extract what was searched for from step constraints or error message
    let searchedFor: string | undefined;
    if (step?.constraints) {
      // Common fields that might contain what was being searched
      searchedFor = step.constraints.text ||
        step.constraints.title ||
        step.constraints.query ||
        step.constraints.eventTitle ||
        step.constraints.taskName ||
        step.constraints.name;
    }

    // Try to extract from error message if not found in constraints
    if (!searchedFor) {
      // Pattern: "Task 'xxx' not found" or "No event matching 'xxx'"
      const quotedMatch = errorMessage.match(/['"]([^'"]+)['"]/);
      if (quotedMatch) {
        searchedFor = quotedMatch[1];
      }
    }

    // Get user's original request from input
    const userRequest = step?.constraints?.rawMessage ||
      state.input?.message ||
      state.input?.enhancedMessage ||
      'Unknown request';

    return {
      stepId,
      capability,
      operation: action,
      searchedFor,
      userRequest,
      errorMessage,
    };
  }

  // ============================================================================
  // CAPABILITY-SPECIFIC CONTEXT EXTRACTORS
  // Each capability has its own extraction logic with clear field expectations
  // ============================================================================

  /**
   * Extract context from Database execution results
   * V1 TaskService returns snake_case fields: due_date, reminder_recurrence, etc.
   */
  private extractDatabaseContext(
    data: DatabaseTaskResult[],
    action: string
  ): DatabaseResponseContext {
    const context: DatabaseResponseContext = {
      isReminder: false,
      isTask: false,
      isNudge: false,
      isRecurring: false,
      hasDueDate: false,
      isToday: false,
      isTomorrowOrLater: false,
      isOverdue: false,
      isListing: action === 'getAll',
      isEmpty: data.length === 0,
    };

    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    for (const item of data) {
      // Use due_date (snake_case from V1) - NOT dueDate
      if (item.due_date) {
        context.hasDueDate = true;
        context.isReminder = true;

        const date = new Date(item.due_date);
        if (date < now) {
          context.isOverdue = true;
        } else if (date <= todayEnd) {
          context.isToday = true;
        } else {
          context.isTomorrowOrLater = true;
        }
      } else {
        context.isTask = true;
      }

      // Use reminder_recurrence (snake_case from V1)
      if (item.reminder_recurrence) {
        context.isRecurring = true;
        if (item.reminder_recurrence.type === 'nudge') {
          context.isNudge = true;
        }
      }
    }

    console.log(`[ResponseFormatter] Database context: isReminder=${context.isReminder}, hasDueDate=${context.hasDueDate}, isToday=${context.isToday}`);
    return context;
  }

  /**
   * Extract context from Calendar execution results
   */
  private extractCalendarContext(
    data: CalendarEventResult[],
    action: string
  ): CalendarResponseContext {
    const context: CalendarResponseContext = {
      isRecurring: false,
      isRecurringSeries: false,
      isToday: false,
      isTomorrowOrLater: false,
      isListing: action === 'getEvents',
      isBulkOperation: action === 'deleteByWindow' || action === 'updateByWindow',
      isEmpty: data.length === 0,
    };

    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    for (const item of data) {
      // Check recurring series - isRecurringSeries indicates successful series operation
      if (item.isRecurringSeries === true) {
        context.isRecurring = true;
        context.isRecurringSeries = true;
      }

      // Check for recurring patterns (days array or recurrence field)
      if (item.recurrence || (Array.isArray(item.days) && item.days.length > 0)) {
        context.isRecurring = true;
      }

      // Check start date
      if (item.start) {
        const date = new Date(item.start);
        if (date <= todayEnd && date >= now) {
          context.isToday = true;
        } else if (date > todayEnd) {
          context.isTomorrowOrLater = true;
        }
      }
    }

    console.log(`[ResponseFormatter] Calendar context: isRecurring=${context.isRecurring}, isRecurringSeries=${context.isRecurringSeries}`);
    return context;
  }

  /**
   * Extract context from Gmail execution results
   */
  private extractGmailContext(
    data: GmailResult[],
    action: string
  ): GmailResponseContext {
    const context: GmailResponseContext = {
      isPreview: false,
      isSent: false,
      isReply: action === 'reply',
      isListing: action === 'listEmails',
      isEmpty: data.length === 0,
    };

    for (const item of data) {
      if (item.preview === true) {
        context.isPreview = true;
      }
    }

    if (action === 'sendConfirm') {
      context.isSent = true;
    }

    console.log(`[ResponseFormatter] Gmail context: isPreview=${context.isPreview}, isSent=${context.isSent}`);
    return context;
  }

  /**
   * Extract context from Second Brain execution results
   */
  private extractSecondBrainContext(
    data: SecondBrainResult[],
    action: string
  ): SecondBrainResponseContext {
    const context: SecondBrainResponseContext = {
      isStored: action === 'storeMemory',
      isSearch: action === 'searchMemory',
      isEmpty: data.length === 0,
    };

    console.log(`[ResponseFormatter] SecondBrain context: isStored=${context.isStored}, isSearch=${context.isSearch}`);
    return context;
  }

  // ============================================================================
  // MAIN CONTEXT BUILDER - Routes to capability-specific extractors
  // ============================================================================

  /**
   * Build context information for response generation
   * Routes to capability-specific extractors based on the capability
   */
  private buildResponseContext(data: any[], capability: string, action: string): ResponseContext {
    const context: ResponseContext = {
      capability: capability as ResponseContext['capability'],
    };

    switch (capability) {
      case 'database':
        context.database = this.extractDatabaseContext(data as DatabaseTaskResult[], action);
        break;
      case 'calendar':
        context.calendar = this.extractCalendarContext(data as CalendarEventResult[], action);
        break;
      case 'gmail':
        context.gmail = this.extractGmailContext(data as GmailResult[], action);
        break;
      case 'second-brain':
        context.secondBrain = this.extractSecondBrainContext(data as SecondBrainResult[], action);
        break;
      default:
        // General capability - no specific context needed
        console.log(`[ResponseFormatter] General capability - no specific context extraction`);
    }

    return context;
  }

  /**
   * Determine entity type from capability and action
   */
  private determineEntityType(capability: string, action: string): string {
    switch (capability) {
      case 'calendar':
        return 'event';
      case 'database':
        if (action.includes('list')) return 'list';
        return 'task';
      case 'gmail':
        return 'email';
      case 'second-brain':
        return 'memory';
      default:
        return 'message';
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createResponseFormatterNode() {
  const node = new ResponseFormatterNode();
  return node.asNodeFunction();
}

// Export utilities for testing
export { categorizeTasks, formatDate, formatDatesInObject, formatRelativeDate };


