/**
 * ResponseWriterNode
 * 
 * Generates the final user-facing message from formatted data.
 * 
 * Responsibilities:
 * - Use templates for common responses
 * - Use LLM for complex summarization
 * - Ensure Memo speaks (not the capabilities)
 * - Handle Hebrew/English language differences
 */

import type { FormattedResponse } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// RESPONSE TEMPLATES
// ============================================================================

interface Templates {
  he: Record<string, string>;
  en: Record<string, string>;
}

const TEMPLATES: Templates = {
  he: {
    // Task templates
    'task.create.success': '✅ יצרתי משימה: "{text}"',
    'task.create.with_reminder': '✅ יצרתי משימה: "{text}"\n⏰ תזכורת: {reminder}',
    'task.complete.success': '✅ סימנתי כהושלמה: "{text}"',
    'task.delete.success': '🗑️ מחקתי את המשימה',
    'task.update.success': '✏️ עדכנתי את המשימה',
    'task.list.empty': '📝 אין לך משימות כרגע',
    'task.list.found': '📝 המשימות שלך:\n{items}',
    
    // Calendar templates
    'event.create.success': '📅 יצרתי אירוע: "{summary}"\n📍 {startFormatted}',
    'event.create.recurring': '📅 יצרתי אירוע חוזר: "{summary}"\n🔄 {recurrence}',
    'event.update.success': '✏️ עדכנתי את האירוע',
    'event.delete.success': '🗑️ מחקתי את האירוע',
    'event.list.empty': '📅 אין לך אירועים בתקופה הזו',
    'event.list.found': '📅 האירועים שלך:\n{items}',
    
    // Email templates
    'email.list.empty': '📧 אין אימיילים חדשים',
    'email.list.found': '📧 האימיילים שלך:\n{items}',
    'email.send.preview': '📧 הנה טיוטת האימייל:\n\nלנמען: {to}\nנושא: {subject}\n\n{body}\n\nלשלוח?',
    'email.send.success': '✅ האימייל נשלח',
    
    // Memory templates
    'memory.store.success': '🧠 שמרתי: "{text}"',
    'memory.search.empty': '🧠 לא מצאתי מידע רלוונטי',
    'memory.search.found': '🧠 מצאתי:\n{items}',
    
    // List templates
    'list.create.success': '📋 יצרתי רשימה: "{name}"',
    'list.addItem.success': '✅ הוספתי לרשימה: "{item}"',
    'list.list.empty': '📋 אין לך רשימות',
    'list.list.found': '📋 הרשימות שלך:\n{items}',
    
    // General templates
    'general.error': '❌ משהו השתבש. נסה שוב בבקשה.',
    'general.unknown': 'לא הבנתי. אפשר לנסח אחרת?',
  },
  en: {
    // Task templates
    'task.create.success': '✅ Created task: "{text}"',
    'task.create.with_reminder': '✅ Created task: "{text}"\n⏰ Reminder: {reminder}',
    'task.complete.success': '✅ Marked as complete: "{text}"',
    'task.delete.success': '🗑️ Deleted the task',
    'task.update.success': '✏️ Updated the task',
    'task.list.empty': '📝 You have no tasks',
    'task.list.found': '📝 Your tasks:\n{items}',
    
    // Calendar templates
    'event.create.success': '📅 Created event: "{summary}"\n📍 {startFormatted}',
    'event.create.recurring': '📅 Created recurring event: "{summary}"\n🔄 {recurrence}',
    'event.update.success': '✏️ Updated the event',
    'event.delete.success': '🗑️ Deleted the event',
    'event.list.empty': '📅 No events in this period',
    'event.list.found': '📅 Your events:\n{items}',
    
    // Email templates
    'email.list.empty': '📧 No new emails',
    'email.list.found': '📧 Your emails:\n{items}',
    'email.send.preview': '📧 Here\'s the draft:\n\nTo: {to}\nSubject: {subject}\n\n{body}\n\nSend it?',
    'email.send.success': '✅ Email sent',
    
    // Memory templates
    'memory.store.success': '🧠 Saved: "{text}"',
    'memory.search.empty': '🧠 No relevant information found',
    'memory.search.found': '🧠 Found:\n{items}',
    
    // List templates
    'list.create.success': '📋 Created list: "{name}"',
    'list.addItem.success': '✅ Added to list: "{item}"',
    'list.list.empty': '📋 You have no lists',
    'list.list.found': '📋 Your lists:\n{items}',
    
    // General templates
    'general.error': '❌ Something went wrong. Please try again.',
    'general.unknown': "I didn't understand. Could you rephrase?",
  },
};

// ============================================================================
// RESPONSE WRITER NODE
// ============================================================================

export class ResponseWriterNode extends CodeNode {
  readonly name = 'response_writer';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const formattedResponse = state.formattedResponse;
    const language = state.user.language === 'he' ? 'he' : 'en';
    
    // Handle errors
    if (state.error) {
      console.log('[ResponseWriter] Writing error response');
      return {
        finalResponse: this.getTemplate('general.error', language, {}),
      };
    }
    
    // Handle missing formatted response
    if (!formattedResponse) {
      console.log('[ResponseWriter] No formatted response, using fallback');
      return {
        finalResponse: this.getTemplate('general.unknown', language, {}),
      };
    }
    
    console.log(`[ResponseWriter] Generating response for ${formattedResponse.agent}:${formattedResponse.operation}`);
    
    // Generate response based on type
    const response = this.generateResponse(formattedResponse, language);
    
    return {
      finalResponse: response,
    };
  }
  
  /**
   * Generate response from formatted data
   */
  private generateResponse(formatted: FormattedResponse, language: 'he' | 'en'): string {
    const { agent, operation, entityType, formattedData, context } = formatted;
    
    // Build template key
    const templateKey = this.buildTemplateKey(entityType, operation, formattedData, context);
    
    // Get data for template substitution
    const templateData = this.extractTemplateData(formattedData);
    
    // Get and fill template
    const template = this.getTemplate(templateKey, language, templateData);
    
    return template;
  }
  
  /**
   * Build template key from context
   */
  private buildTemplateKey(
    entityType: string,
    operation: string,
    data: any,
    context: any
  ): string {
    // Normalize operation name
    const normalizedOp = this.normalizeOperation(operation);
    
    // Check for special cases
    if (normalizedOp === 'create' && context.isRecurring) {
      return `${entityType}.create.recurring`;
    }
    
    if (normalizedOp === 'create' && data[0]?.reminder) {
      return `${entityType}.create.with_reminder`;
    }
    
    if (normalizedOp === 'getAll' || normalizedOp === 'list') {
      const items = Array.isArray(data) ? data : data[0]?.items;
      if (!items || items.length === 0) {
        return `${entityType}.list.empty`;
      }
      return `${entityType}.list.found`;
    }
    
    return `${entityType}.${normalizedOp}.success`;
  }
  
  /**
   * Normalize operation name to template-friendly format
   */
  private normalizeOperation(operation: string): string {
    const mappings: Record<string, string> = {
      'create_task': 'create',
      'create_event': 'create',
      'create_list': 'create',
      'list_tasks': 'list',
      'list_events': 'list',
      'get_all': 'list',
      'getAll': 'list',
      'getEvents': 'list',
      'listEmails': 'list',
      'complete_task': 'complete',
      'delete_task': 'delete',
      'delete_event': 'delete',
      'update_task': 'update',
      'update_event': 'update',
      'store_memory': 'store',
      'search_memory': 'search',
      'add_item': 'addItem',
      'sendPreview': 'send.preview',
      'sendConfirm': 'send',
    };
    
    return mappings[operation] || operation;
  }
  
  /**
   * Extract data for template substitution
   */
  private extractTemplateData(data: any): Record<string, string> {
    const result: Record<string, string> = {};
    
    // Handle array of results
    const items = Array.isArray(data) ? data : [data];
    const firstItem = items[0] || {};
    
    // Common fields
    if (firstItem.text) result.text = firstItem.text;
    if (firstItem.summary) result.summary = firstItem.summary;
    if (firstItem.name) result.name = firstItem.name;
    if (firstItem.item) result.item = firstItem.item;
    if (firstItem.to) result.to = Array.isArray(firstItem.to) ? firstItem.to.join(', ') : firstItem.to;
    if (firstItem.subject) result.subject = firstItem.subject;
    if (firstItem.body) result.body = firstItem.body;
    
    // Formatted dates
    if (firstItem.startFormatted) result.startFormatted = firstItem.startFormatted;
    if (firstItem.dueDateFormatted) result.reminder = firstItem.dueDateFormatted;
    
    // Recurrence
    if (firstItem.recurrence) result.recurrence = this.formatRecurrence(firstItem.recurrence);
    
    // Format items list
    if (items.length > 0) {
      result.items = this.formatItemsList(items);
    }
    
    return result;
  }
  
  /**
   * Format recurrence pattern to human-readable string
   */
  private formatRecurrence(recurrence: any): string {
    if (typeof recurrence === 'string') return recurrence;
    
    const { type, days, time } = recurrence;
    
    if (type === 'daily') return `Every day at ${time}`;
    if (type === 'weekly' && days) {
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayList = days.map((d: number) => dayNames[d]).join(', ');
      return `Every ${dayList} at ${time}`;
    }
    if (type === 'monthly') return `Monthly at ${time}`;
    
    return JSON.stringify(recurrence);
  }
  
  /**
   * Format list of items for display
   */
  private formatItemsList(items: any[]): string {
    return items
      .slice(0, 10) // Limit to 10 items
      .map((item, index) => {
        const text = item.text || item.summary || item.name || item.subject || JSON.stringify(item);
        const prefix = `${index + 1}. `;
        return `${prefix}${text}`;
      })
      .join('\n');
  }
  
  /**
   * Get template and fill with data
   */
  private getTemplate(key: string, language: 'he' | 'en', data: Record<string, string>): string {
    const templates = TEMPLATES[language] || TEMPLATES.en;
    let template = templates[key];
    
    // Fallback to English if not found
    if (!template && language === 'he') {
      template = TEMPLATES.en[key];
    }
    
    // Fallback to generic if still not found
    if (!template) {
      template = templates['general.unknown'];
    }
    
    // Substitute placeholders
    for (const [placeholder, value] of Object.entries(data)) {
      template = template.replace(new RegExp(`\\{${placeholder}\\}`, 'g'), value || '');
    }
    
    return template;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createResponseWriterNode() {
  const node = new ResponseWriterNode();
  return node.asNodeFunction();
}

// Export templates for testing
export { TEMPLATES };


