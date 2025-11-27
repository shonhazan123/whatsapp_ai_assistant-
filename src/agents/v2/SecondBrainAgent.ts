import { SystemPrompts } from '../../config/system-prompts';
import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { SecondBrainService } from '../../services/memory/SecondBrainService';
import { logger } from '../../utils/logger';
import { SecondBrainFunction } from '../functions/SecondBrainFunction';

export class SecondBrainAgent extends BaseAgent {
  private secondBrainService: SecondBrainService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, loggerInstance);

    // Initialize service
    this.secondBrainService = new SecondBrainService(loggerInstance);

    // Register functions
    this.registerFunctions();
  }

  async processRequest(
    message: string, 
    userPhone: string,
    optionsOrContext?: {
      whatsappMessageId?: string;
      replyToMessageId?: string;
    } | any[]
  ): Promise<string> {
    // Handle both new options format and legacy context array format
    const context: any[] = Array.isArray(optionsOrContext) ? optionsOrContext : [];
    try {
      this.logger.info('🧠 Second Brain Agent activated');
      this.logger.info(`📝 Processing memory request: "${message}"`);
      this.logger.info(`📚 Context: ${context.length} messages`);
      
      // Log recent context for debugging
      if (context.length > 0) {
        const recentContext = context.slice(-3).map((msg: any) => ({
          role: msg?.role,
          content: msg?.content?.substring(0, 100) + (msg?.content?.length > 100 ? '...' : '')
        }));
        this.logger.debug('🔍 Recent context:', JSON.stringify(recentContext, null, 2));
      }
      
      return await this.executeWithAI(
        message,
        userPhone,
        this.getSystemPrompt(),
        this.getFunctions(),
        context
      );
    } catch (error) {
      this.logger.error('Second Brain agent error:', error);
      return 'Sorry, I encountered an error with your memory request.';
    }
  }

  getSystemPrompt(): string {
    return SystemPrompts.getSecondBrainAgentPrompt();
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    const secondBrainFunction = new SecondBrainFunction(
      this.secondBrainService,
      this.logger
    );
    this.functionHandler.registerFunction(secondBrainFunction);
  }
}

