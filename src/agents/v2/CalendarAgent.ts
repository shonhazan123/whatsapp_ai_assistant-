import { BaseAgent } from '../../core/base/BaseAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { CalendarService } from '../../services/calendar/CalendarService';
import { logger } from '../../utils/logger';
import { CalendarFunction } from '../functions/CalendarFunctions';

export class CalendarAgent extends BaseAgent {
  private calendarService: CalendarService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger,
    calendarId?: string
  ) {
    super(openaiService, functionHandler, logger);

    // Initialize services
    this.calendarService = new CalendarService(logger, calendarId);

    // Register functions
    this.registerFunctions();
  }

  async processRequest(message: string, userPhone: string): Promise<string> {
    try {
      this.logger.info('📅 Calendar Agent activated');
      this.logger.info(`📝 Processing calendar request: "${message}"`);
      
      return await this.executeWithAI(
        message,
        userPhone,
        this.getSystemPrompt(),
        this.getFunctions()
      );
    } catch (error) {
      this.logger.error('Calendar agent error:', error);
      return 'Sorry, I encountered an error with your calendar request.';
    }
  }

  getSystemPrompt(): string {
    return `# Role  
You are a calendar agent. Your tasks include creating, retrieving, and deleting events in the user's calendar.  

# Available Functions

1. **calendarOperations** - Handle all calendar operations
   - Create single or multiple events
   - Get events within date range
   - Update existing events
   - Delete events
   - Get specific event by ID

Current date/time: ${new Date().toISOString()}
User timezone: Asia/Jerusalem (UTC+3)

# CRITICAL LANGUAGE RULES:
- ALWAYS respond in the same language as the user's message
- If user writes in Hebrew, respond in Hebrew
- If user writes in English, respond in English
- For queries like "מה יש לי השבוע" or "אילו אירועים יש לי", use getEvents operation

IMPORTANT: If user requests multiple events, use createMultiple operation with ALL events in the array.
Example: "Schedule surfing at 7am and meeting at 8:30pm" → createMultiple with 2 events

Always respond in the same language as the user.`;
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    const calendarFunction = new CalendarFunction(this.calendarService, this.logger);
    this.functionHandler.registerFunction(calendarFunction);
  }
}
