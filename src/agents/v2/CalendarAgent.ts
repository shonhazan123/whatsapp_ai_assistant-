import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { CalendarService } from '../../services/calendar/CalendarService';
import { logger } from '../../utils/logger';
import { CalendarFunction } from '../functions/CalendarFunctions';
import { SystemPrompts } from '../../config/system-prompts';

export class CalendarAgent extends BaseAgent {
  private calendarService: CalendarService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, logger);

    // Initialize services
    this.calendarService = new CalendarService(logger);

    // Register functions
    this.registerFunctions();
  }

  async processRequest(message: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      this.logger.info('📅 Calendar Agent activated');
      this.logger.info(`📝 Processing calendar request: "${message}"`);
      this.logger.info(`📚 Context: ${context.length} messages`);
      
      return await this.executeWithAI(
        message,
        userPhone,
        this.getSystemPrompt(),
        this.getFunctions(),
        context
      );
    } catch (error) {
      this.logger.error('Error in Calendar Agent:', error);
      return 'An error occurred while processing your calendar request.';
    }
  }

  getSystemPrompt(): string {
    return SystemPrompts.getCalendarAgentPrompt();
  }

  getFunctions(): any[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    this.functionHandler.registerFunction(
      new CalendarFunction(this.calendarService, logger)
    );
  }
}
