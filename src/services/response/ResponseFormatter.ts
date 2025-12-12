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
   * Pre-process the result message to format dates before sending to LLM
   */
  private preprocessResultMessage(resultMessage: any): any {
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
      
      // Return a copy with formatted content
      return {
        ...resultMessage,
        content: JSON.stringify(formattedContent)
      };
    } catch (error) {
      // If parsing fails, return original
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

      // Pre-process the result message to format ISO dates into human-readable strings
      // This prevents the LLM from misinterpreting timezone offsets
      const processedResultMessage = this.preprocessResultMessage(resultMessage);

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
        logger.warn('⚠️  Formatter returned empty response');
        return 'Operation completed.';
      }

      return rawResponse;
    } catch (error) {
      logger.error('Error formatting response:', error);
      return 'Sorry, I encountered an error processing your request.';
    }
  }
}
