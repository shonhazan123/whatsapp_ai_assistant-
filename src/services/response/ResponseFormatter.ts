import { ResponseFormatterPrompt } from '../../config/response-formatter-prompt';
import { logger } from '../../utils/logger';
import { OpenAIService } from '../ai/OpenAIService';

/**
 * ResponseFormatter - Simple service to format function results into user-friendly messages
 * Uses gpt-4o-mini to keep costs low while maintaining quality
 * Uses ResponseFormatterPrompt which contains all the exact formatting instructions
 * 
 * Pre-processes JSON data to format ISO dates into human-readable strings
 * before sending to the LLM (since LLMs often misparse ISO date formats)
 */
export class ResponseFormatter {
  private openaiService: OpenAIService;
  private formatterModel: string = 'gpt-4o-mini'; // Use gpt-4o-mini (verified model name)
  
  // Hebrew day names for date formatting
  private static readonly HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  private static readonly HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  constructor(openaiService: OpenAIService) {
    this.openaiService = openaiService;
  }

  /**
   * Parse an ISO date string and extract the LOCAL time
   * Handles both local ISO (with timezone) and UTC formats
   */
  private parseISOToLocalTime(isoString: string): { date: Date; localTime: string; localDate: string } | null {
    if (!isoString || typeof isoString !== 'string') return null;
    
    // Parse the ISO string to a Date object
    const dateObj = new Date(isoString);
    if (isNaN(dateObj.getTime())) return null;
    
    // Check if the string ends with 'Z' or '.000Z' (UTC format)
    const isUTC = isoString.endsWith('Z');
    
    let localHours: number;
    let localMinutes: number;
    let localDay: number;
    let localMonth: number;
    let localYear: number;
    
    if (isUTC) {
      // Convert UTC to Israel local time
      const israelFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      const parts = israelFormatter.formatToParts(dateObj);
      localYear = parseInt(parts.find(p => p.type === 'year')?.value || '0');
      localMonth = parseInt(parts.find(p => p.type === 'month')?.value || '0');
      localDay = parseInt(parts.find(p => p.type === 'day')?.value || '0');
      localHours = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      localMinutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    } else {
      // For local times with timezone offset, extract directly
      const isoMatch = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!isoMatch) return null;
      
      [, localYear, localMonth, localDay, localHours, localMinutes] = isoMatch.map((v, i) => i === 0 ? 0 : parseInt(v));
    }
    
    // Create a date object for comparison (today/tomorrow detection)
    const date = new Date(localYear, localMonth - 1, localDay, localHours, localMinutes);
    
    // Format time as HH:mm
    const localTime = `${String(localHours).padStart(2, '0')}:${String(localMinutes).padStart(2, '0')}`;
    
    // Format date in Hebrew style
    const localDate = `${localDay} ב${ResponseFormatter.HEBREW_MONTHS[localMonth - 1]}`;
    
    return { date, localTime, localDate };
  }

  /**
   * Format a date relative to today (היום/מחר/[date])
   */
  private formatRelativeDate(parsed: { date: Date; localTime: string; localDate: string }): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const taskDate = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate());
    
    if (taskDate.getTime() === today.getTime()) {
      return `היום ב־${parsed.localTime}`;
    } else if (taskDate.getTime() === tomorrow.getTime()) {
      return `מחר ב־${parsed.localTime}`;
    } else {
      // Include day of week for other dates
      const dayName = ResponseFormatter.HEBREW_DAYS[parsed.date.getDay()];
      return `יום ${dayName}, ${parsed.localDate} ב־${parsed.localTime}`;
    }
  }

  /**
   * Recursively process an object/array and format all ISO date strings
   * Also adds a formatted_time field next to each date field for easy LLM access
   */
  private formatDatesInObject(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.formatDatesInObject(item));
    }
    
    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Check if this is a date field
        if (typeof value === 'string' && this.isISODateString(value)) {
          const parsed = this.parseISOToLocalTime(value);
          if (parsed) {
            // Keep original value but add formatted version
            result[key] = value;
            result[`${key}_formatted`] = this.formatRelativeDate(parsed);
          } else {
            result[key] = value;
          }
        } else if (typeof value === 'object') {
          result[key] = this.formatDatesInObject(value);
        } else {
          result[key] = value;
        }
      }
      return result;
    }
    
    return obj;
  }

  /**
   * Check if a string looks like an ISO date
   */
  private isISODateString(str: string): boolean {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str);
  }

  /**
   * Extract context metadata from assistant message and result message
   * This helps the LLM understand which agent made the call and what operation was performed
   */
  private extractResponseContext(assistantMessage: any, resultMessage: any): any {
    try {
      const metadata: any = {
        agent: 'unknown',
        functionName: 'unknown',
        operation: 'unknown',
        entityType: 'unknown',
        context: {
          isRecurring: false,
          isNudge: false,
          hasDueDate: false,
          isMultiple: false,
          isCalendarEvent: false,
          isReminder: false,
          isToday: false,
          isTomorrowOrLater: false
        }
      };

      // Extract from assistantMessage.tool_calls
      if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCall = assistantMessage.tool_calls[0];
        const functionName = toolCall?.function?.name || 'unknown';
        metadata.functionName = functionName;

        // Map function name to agent
        if (functionName === 'calendarOperations') {
          metadata.agent = 'calendar';
          metadata.entityType = 'event';
          metadata.context.isCalendarEvent = true;
        } else if (functionName === 'taskOperations') {
          metadata.agent = 'database';
          metadata.entityType = 'reminder';
          metadata.context.isReminder = true;
        } else if (functionName === 'listOperations') {
          metadata.agent = 'database';
          metadata.entityType = 'list';
        } else if (functionName === 'gmailOperations') {
          metadata.agent = 'gmail';
          metadata.entityType = 'email';
        } else if (functionName === 'memoryOperations') {
          metadata.agent = 'memory';
          metadata.entityType = 'memory';
        }

        // Parse function arguments
        try {
          const args = typeof toolCall?.function?.arguments === 'string' 
            ? JSON.parse(toolCall.function.arguments)
            : toolCall?.function?.arguments || {};
          
          metadata.operation = args.operation || 'unknown';

          // Detect listing operations (getAll, get)
          if (metadata.operation === 'getAll' || metadata.operation === 'get') {
            metadata.context.isListing = true;
          }

          // Detect multiple operations
          if (metadata.operation.includes('Multiple')) {
            metadata.context.isMultiple = true;
          }

          // Detect recurring operations
          if (metadata.operation.includes('Recurring') || args.recurrence || args.recurring) {
            metadata.context.isRecurring = true;
          }

          // Check for reminder recurrence (nudge)
          if (args.reminderRecurrence) {
            metadata.context.isRecurring = true;
            if (args.reminderRecurrence.type === 'nudge') {
              metadata.context.isNudge = true;
            }
          }

          // Check for due date
          if (args.dueDate || args.due_date) {
            metadata.context.hasDueDate = true;
          }

          // Extract date context from filters for getAll operations
          if (metadata.operation === 'getAll' && args.filters?.dueDateFrom && args.filters?.dueDateTo) {
            try {
              const fromDate = new Date(args.filters.dueDateFrom);
              const toDate = new Date(args.filters.dueDateTo);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const tomorrow = new Date(today);
              tomorrow.setDate(tomorrow.getDate() + 1);
              
              const fromDateOnly = new Date(fromDate);
              fromDateOnly.setHours(0, 0, 0, 0);
              const toDateOnly = new Date(toDate);
              toDateOnly.setHours(0, 0, 0, 0);
              
              // Check if it's today
              if (fromDateOnly.getTime() === today.getTime() && toDateOnly.getTime() === today.getTime()) {
                metadata.dateContext = 'today';
              }
              // Check if it's tomorrow
              else if (fromDateOnly.getTime() === tomorrow.getTime() && toDateOnly.getTime() === tomorrow.getTime()) {
                metadata.dateContext = 'tomorrow';
              }
              // Otherwise, format the date
              else if (fromDateOnly.getTime() === toDateOnly.getTime()) {
                // Single date query - format it
                const dateStr = fromDateOnly.toLocaleDateString('he-IL', { 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                });
                metadata.dateContext = dateStr;
              }
            } catch (dateError) {
              // Ignore date parsing errors
            }
          }
        } catch (parseError) {
          logger.warn('Failed to parse function arguments:', parseError);
        }
      }

      // Extract from result message to supplement context
      try {
        if (resultMessage?.content) {
          const resultContent = typeof resultMessage.content === 'string'
            ? JSON.parse(resultMessage.content)
            : resultMessage.content;

          // Check for recurrence in result
          if (resultContent.recurrence || resultContent.recurringEventId) {
            metadata.context.isRecurring = true;
          }

          // Check for reminder recurrence
          if (resultContent.reminder_recurrence || resultContent.reminderRecurrence) {
            metadata.context.isRecurring = true;
            const recurrence = resultContent.reminder_recurrence || resultContent.reminderRecurrence;
            if (recurrence?.type === 'nudge' || (typeof recurrence === 'object' && recurrence.type === 'nudge')) {
              metadata.context.isNudge = true;
            }
          }

          // Check for due date and determine if today/tomorrow
          const dueDate = resultContent.due_date || resultContent.dueDate;
          const dueDateFormatted = resultContent.due_date_formatted || resultContent.dueDate_formatted;
          if (dueDate) {
            metadata.context.hasDueDate = true;
          }

          // Check start date for calendar events
          const startDate = resultContent.start || resultContent.startTime;
          const startFormatted = resultContent.start_formatted || resultContent.startTime_formatted;
          if (startDate || startFormatted) {
            const dateToCheck = startFormatted || dueDateFormatted;
            if (dateToCheck) {
              if (dateToCheck.includes('היום') || dateToCheck.includes('today')) {
                metadata.context.isToday = true;
              } else if (dateToCheck.includes('מחר') || dateToCheck.includes('tomorrow') || dateToCheck.includes('יום')) {
                metadata.context.isTomorrowOrLater = true;
              }
            } else if (dueDate || startDate) {
              // Parse ISO date to check if tomorrow or later
              const dateStr = startDate || dueDate;
              const parsed = this.parseISOToLocalTime(dateStr);
              if (parsed) {
                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const taskDate = new Date(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate());
                
                if (taskDate.getTime() === today.getTime()) {
                  metadata.context.isToday = true;
                } else if (taskDate.getTime() >= tomorrow.getTime()) {
                  metadata.context.isTomorrowOrLater = true;
                }
              }
            }
          } else if (dueDateFormatted) {
            if (dueDateFormatted.includes('היום') || dueDateFormatted.includes('today')) {
              metadata.context.isToday = true;
            } else {
              metadata.context.isTomorrowOrLater = true;
            }
          }
        }
      } catch (resultParseError) {
        logger.warn('Failed to parse result message for context:', resultParseError);
      }

      return metadata;
    } catch (error) {
      logger.warn('Failed to extract response context, using defaults:', error);
      // Return minimal metadata as fallback
      return {
        agent: 'unknown',
        functionName: 'unknown',
        operation: 'unknown',
        entityType: 'unknown',
        context: {
          isRecurring: false,
          isNudge: false,
          hasDueDate: false,
          isMultiple: false,
          isCalendarEvent: false,
          isReminder: false,
          isToday: false,
          isTomorrowOrLater: false,
          isListing: false
        }
      };
    }
  }

  /**
   * Pre-process the result message to format dates before sending to LLM
   * Also injects context metadata to help LLM understand the operation
   * Categorizes tasks for getAll operations (overdue/upcoming/unplanned)
   */
  private preprocessResultMessage(resultMessage: any, metadata?: any): any {
    if (!resultMessage || !resultMessage.content) return resultMessage;
    
    try {
      // Parse the JSON content
      const content = JSON.parse(resultMessage.content);
      
      // Format dates in the content
      const formattedContent = this.formatDatesInObject(content);

      // If this is a recurring calendar event, add helper fields for the formatter
      if (formattedContent && formattedContent.recurrence) {
        formattedContent.is_recurring = true;
        formattedContent.calendar_overview_link = 'https://calendar.google.com/calendar/u/0/r';

        // Provide a readable recurrence text if possible
        if (Array.isArray(formattedContent.recurrence)) {
          formattedContent.recurrence_text = formattedContent.recurrence.join(', ');
        } else if (typeof formattedContent.recurrence === 'string') {
          formattedContent.recurrence_text = formattedContent.recurrence;
        }
      }

      // Categorize tasks for getAll operations
      if (metadata?.operation === 'getAll' && formattedContent?.data?.tasks && Array.isArray(formattedContent.data.tasks)) {
        const now = new Date();
        const categorized = {
          overdue: [] as any[],
          upcoming: [] as any[],
          recurring: [] as any[],
          unplanned: [] as any[]
        };

        // Use date context from metadata (extracted in extractResponseContext)
        const dateContext = metadata?.dateContext || null;

        formattedContent.data.tasks.forEach((task: any) => {
          // Skip completed tasks
          if (task.completed) return;

          // Check if task has reminder_recurrence (recurring reminder)
          // reminder_recurrence might be a JSON string or an object
          let reminderRecurrence = task.reminder_recurrence;
          if (typeof reminderRecurrence === 'string') {
            try {
              reminderRecurrence = JSON.parse(reminderRecurrence);
            } catch (e) {
              // If parsing fails, treat as no recurrence
              reminderRecurrence = null;
            }
          }
          const hasRecurrence = reminderRecurrence !== null && reminderRecurrence !== undefined;
          
          if (hasRecurrence) {
            // Recurring reminder - separate category
            categorized.recurring.push(task);
          } else if (!task.due_date) {
            // Unplanned task (no due date, no recurrence)
            categorized.unplanned.push(task);
          } else {
            // Parse due date
            const dueDate = new Date(task.due_date);
            if (isNaN(dueDate.getTime())) {
              // Invalid date, treat as unplanned
              categorized.unplanned.push(task);
            } else if (dueDate < now) {
              // Overdue task
              categorized.overdue.push(task);
            } else {
              // Upcoming task
              categorized.upcoming.push(task);
            }
          }
        });

        // Check if all categories are empty
        const isEmpty = categorized.overdue.length === 0 && 
                        categorized.upcoming.length === 0 && 
                        categorized.recurring.length === 0 && 
                        categorized.unplanned.length === 0;

        // Add categorized data to formatted content
        formattedContent.data._categorized = categorized;
        formattedContent.data._currentTime = now.toISOString();
        formattedContent.data._isEmpty = isEmpty;
        formattedContent.data._dateContext = dateContext;
      } else if (metadata?.operation === 'getAll' && formattedContent?.data?.tasks && Array.isArray(formattedContent.data.tasks)) {
        // Handle simple list (no categorization) - check if empty
        const isEmpty = formattedContent.data.tasks.length === 0 || 
                        formattedContent.data.tasks.every((task: any) => task.completed);
        formattedContent.data._isEmpty = isEmpty;
        formattedContent.data._dateContext = metadata?.dateContext || null;
      }

      // Inject metadata as _metadata field for LLM to use
      if (metadata) {
        formattedContent._metadata = metadata;
      }
      
      // Return a copy with formatted content
      return {
        ...resultMessage,
        content: JSON.stringify(formattedContent)
      };
    } catch (error) {
      // If parsing fails, return original (fallback)
      logger.warn('Failed to preprocess result message for date formatting:', error);
      return resultMessage;
    }
  }

  /**
   * Format function execution result into a user-friendly message
   * Passes ResponseFormatterPrompt system prompt, userMessage, assistantMessage (with tool_calls), and resultMessage to cheap LLM
   * The resultMessage contains the function execution result as a JSON string
   * Dates are pre-formatted to human-readable strings before sending to the LLM
   */
  async formatResponse(
    systemPrompt: string, // Kept for backward compatibility but not used - using ResponseFormatterPrompt instead
    userMessage: string,
    assistantMessage: any,
    resultMessage: any,
    requestId?: string
  ): Promise<string> {
    try {
      logger.debug('🎨 Using ResponseFormatter (cheap model) for final message generation');

      // Extract context metadata from assistant message and result message
      const metadata = this.extractResponseContext(assistantMessage, resultMessage);
      logger.debug('📋 Extracted response context metadata:', metadata);

      // Pre-process the result message to format ISO dates into human-readable strings
      // This prevents the LLM from misinterpreting timezone offsets
      // Also injects metadata for LLM context awareness
      const processedResultMessage = this.preprocessResultMessage(resultMessage, metadata);

      // Use ResponseFormatterPrompt which contains all the exact formatting instructions
      // This is separate from the agent's system prompt which focuses on function calling logic
      // CRITICAL: Do NOT pass functions/tools - formatter should only generate text, not function calls
      const formatterSystemPrompt = ResponseFormatterPrompt.getSystemPrompt();
      
      const completion = await this.openaiService.createCompletion({
        messages: [
          { role: 'system', content: formatterSystemPrompt }, // Use ResponseFormatterPrompt for formatting instructions
          { role: 'user', content: userMessage },
          assistantMessage, // Must include this - tool result requires preceding assistant message with tool_calls
          processedResultMessage // Contains JSON string with pre-formatted dates (e.g., "due_date_formatted": "היום ב־18:00")
        ],
        model: this.formatterModel,
        maxTokens: 500
        // Do NOT pass functions/tools - this ensures model only generates text, not function calls
      }, requestId);

      const message = completion.choices[0]?.message;
      const rawResponse = message?.content;
      
      logger.debug('📝 Formatter response', {
        hasMessage: !!message,
        hasContent: !!rawResponse,
        hasToolCalls: !!(message?.tool_calls && message.tool_calls.length > 0),
        hasFunctionCall: !!message?.function_call,
        contentLength: rawResponse?.length || 0,
        contentPreview: rawResponse?.substring(0, 200) || 'null/empty',
        fullMessage: JSON.stringify(message).substring(0, 500)
      });

      // Check if model generated tool_calls or function_call instead of content
      if (message?.tool_calls && message.tool_calls.length > 0) {
        logger.error('❌ Formatter generated tool_calls instead of content - model tried to call functions');
        logger.debug('Tool calls:', JSON.stringify(message.tool_calls).substring(0, 500));
        // This shouldn't happen with tool_choice: 'none', but if it does, we need to handle it
      }
      
      if (message?.function_call) {
        logger.error('❌ Formatter generated function_call instead of content - model tried to call functions');
        logger.debug('Function call:', JSON.stringify(message.function_call).substring(0, 500));
      }

      if (!rawResponse || rawResponse.trim().length === 0) {
        logger.warn('⚠️  Formatter returned empty response, attempting fallback');
        // Fallback: try to extract a meaningful message from the original result
        return this.extractFallbackMessage(resultMessage) || 'Operation completed.';
      }

      return rawResponse;
    } catch (error) {
      logger.error('Error formatting response, using fallback:', error);
      // Fallback: extract meaningful message from original result
      return this.extractFallbackMessage(resultMessage) || 'Sorry, I encountered an error processing your request.';
    }
  }

  /**
   * Extract a fallback message from the result message if formatting fails
   * This provides a graceful degradation when the LLM formatter fails
   */
  private extractFallbackMessage(resultMessage: any): string | null {
    try {
      if (!resultMessage?.content) return null;

      const content = typeof resultMessage.content === 'string'
        ? JSON.parse(resultMessage.content)
        : resultMessage.content;

      // Try to extract success message or meaningful content
      if (content.message) {
        return content.message;
      }

      // For calendar events, try to format a basic message
      if (content.summary && (content.start || content.start_formatted)) {
        const summary = content.summary;
        const time = content.start_formatted || content.start;
        return `✅ האירוע "${summary}" נוסף ליומן${time ? ` ב-${time}` : ''}`;
      }

      // For tasks/reminders, try to format basic message
      if (content.text || (Array.isArray(content.tasks) && content.tasks.length > 0)) {
        const taskText = content.text || content.tasks[0]?.text || '';
        const dueDate = content.due_date_formatted || content.due_date || content.dueDate;
        if (taskText) {
          return `✅ יצרתי תזכורת: ${taskText}${dueDate ? ` (${dueDate})` : ''}`;
        }
      }

      // Generic success message
      if (content.success !== false) {
        return 'Operation completed successfully.';
      }

      return null;
    } catch (error) {
      logger.warn('Failed to extract fallback message:', error);
      return null;
    }
  }
}
