import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { GmailService } from '../../services/email/GmailService';
import { logger } from '../../utils/logger';
import { GmailFunction } from '../functions/GmailFunctions';
import { SystemPrompts } from '../../config/system-prompts';

export class GmailAgent extends BaseAgent {
  private gmailService: GmailService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, logger);

    // Initialize services
    this.gmailService = new GmailService(logger);

    // Register functions
    this.registerFunctions();
  }

  async processRequest(message: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      this.logger.info('📧 Gmail Agent activated');
      this.logger.info(`📝 Processing email request: "${message}"`);
      this.logger.info(`📚 Context: ${context.length} messages`);
      
      return await this.executeWithAI(
        message,
        userPhone,
        this.getSystemPrompt(),
        this.getFunctions(),
        context
      );
    } catch (error) {
      this.logger.error('Gmail agent error:', error);
      return 'Sorry, I encountered an error with your email request.';
    }
  }

  getSystemPrompt(): string {
    return SystemPrompts.getGmailAgentPrompt();
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    const gmailFunction = new GmailFunction(this.gmailService, this.logger);
    this.functionHandler.registerFunction(gmailFunction);
  }
}
