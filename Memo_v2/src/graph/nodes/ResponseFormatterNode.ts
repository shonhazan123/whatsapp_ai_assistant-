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
 * - Build response context for templating
 * - Handle Hebrew/English formatting differences
 */

import type { FormattedResponse, ResponseContext } from '../../types/index.js';
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
      // Keep original for certain keys, add formatted version
      if (['start', 'end', 'dueDate', 'createdAt', 'updatedAt', 'reminderTime'].includes(key)) {
        formatted[key] = value;
        formatted[`${key}Formatted`] = formatDatesInObject(value, timezone, language);
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
  overdue: any[];
  today: any[];
  upcoming: any[];
  recurring: any[];
  noDueDate: any[];
}

function categorizeTasks(tasks: any[]): CategorizedTasks {
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
    // Check for recurring tasks
    if (task.reminderRecurrence || task.isRecurring) {
      categories.recurring.push(task);
      continue;
    }
    
    // Check due date
    if (!task.dueDate) {
      categories.noDueDate.push(task);
      continue;
    }
    
    const dueDate = new Date(task.dueDate);
    
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
    
    // Collect all execution data
    const allData: any[] = [];
    for (const [stepId, result] of executionResults) {
      if (result.success && result.data) {
        allData.push(result.data);
      }
    }
    
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
    };
    
    console.log(`[ResponseFormatter] Built response for ${capability}:${action}`);
    
    return {
      formattedResponse,
    };
  }
  
  /**
   * Build context information for response generation
   */
  private buildResponseContext(data: any[], capability: string, action: string): ResponseContext {
    const context: ResponseContext = {
      isRecurring: false,
      isNudge: false,
      hasDueDate: false,
      isToday: false,
      isTomorrowOrLater: false,
    };
    
    const now = new Date();
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);
    
    for (const item of data) {
      // Check for recurring patterns
      if (item.reminderRecurrence || item.recurrence || item.isRecurring) {
        context.isRecurring = true;
      }
      
      // Check for nudge reminders
      if (item.reminderRecurrence?.type === 'nudge') {
        context.isNudge = true;
      }
      
      // Check due dates
      const dueDate = item.dueDate || item.start;
      if (dueDate) {
        context.hasDueDate = true;
        const date = new Date(dueDate);
        
        if (date <= todayEnd && date >= now) {
          context.isToday = true;
        } else if (date > todayEnd) {
          context.isTomorrowOrLater = true;
        }
      }
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


