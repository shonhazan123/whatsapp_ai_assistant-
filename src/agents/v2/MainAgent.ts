import { BaseAgent } from '../../core/base/BaseAgent';
import { AgentName, IFunctionHandler } from '../../core/interfaces/IAgent';
import { ConversationWindow } from '../../core/memory/ConversationWindow';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { logger } from '../../utils/logger';
import { SystemPrompts } from '../../config/system-prompts';

// Token limits for different models
const MAX_CONTEXT_TOKENS = 8000;
const SYSTEM_PROMPT_TOKENS = 500;

export class MainAgent extends BaseAgent {
  private agentManager: any | null = null;
  private conversationWindow: ConversationWindow;
  
  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, logger);
    this.conversationWindow = ConversationWindow.getInstance();
  }

  async processRequest(message: string, userPhone: string): Promise<string> {
    try {
      // Initialize and cache AgentManager once
      if (!this.agentManager) {
        const module = await import('../../core/manager/AgentManager');
        this.agentManager = module.AgentManager.getInstance();
      }

      // Step 1: Add user message to conversation window
      this.conversationWindow.addMessage(userPhone, 'user', message);
      
      // Step 2: Get conversation context
      const context = this.conversationWindow.getContext(userPhone);
      
      // Step 3: Determine intent with context
      const intent = await this.openaiService.detectIntent(message, context);
      this.logger.info(`Detected intent: ${intent}`);
      this.logger.info(`Context: ${context.length} messages`);
      
      let response: string;

      // Route to specialized agents or general conversation
      if (intent === AgentName.CALENDAR) {
        response = await this.routeToCalendarAgent(message, userPhone, context);
      } else if (intent === AgentName.GMAIL) {
        response = await this.routeToGmailAgent(message, userPhone, context);
      } else if (intent === AgentName.DATABASE) {
        response = await this.routeToDatabaseAgent(message, userPhone, context);
      } else if (intent === AgentName.MULTI_TASK) {
        response = await this.routeToMultiAgentCoordinator(message, userPhone);
      } else {
        // General conversation with full context
        response = await this.getGeneralResponse(context, message);
      }

      // Step 4: Add assistant response to conversation window

      return response;
    } catch (error) {
      this.logger.error('Error processing message:', error);
      return 'Sorry, I encountered an error processing your request. Please try again.';
    }
  }

  getSystemPrompt(): string {
    return SystemPrompts.getMainAgentPrompt();
  }

  getFunctions(): FunctionDefinition[] {
    return [];
  }

  private async routeToCalendarAgent(message: string, userPhone: string, context: any[]): Promise<string> {
    return this.agentManager.getCalendarAgent().processRequest(message, userPhone, context);
  }

  private async routeToGmailAgent(message: string, userPhone: string, context: any[]): Promise<string> {
    return this.agentManager.getGmailAgent().processRequest(message, userPhone, context);
  }

  private async routeToDatabaseAgent(message: string, userPhone: string, context: any[]): Promise<string> {
    return this.agentManager.getDatabaseAgent().processRequest(message, userPhone, context);
  }

  private async routeToMultiAgentCoordinator(message: string, userPhone: string, context: any[] = []): Promise<string> {
    return this.agentManager.getMultiAgentCoordinator().executeActions(message, userPhone, context);
  }

  private async getGeneralResponse(context: any[], message: string): Promise<string> {
    const messages: any[] = [
      {
        role: 'system',
        content: this.getSystemPrompt()
      },
      ...context,
      {
        role: 'user',
        content: message
      }
    ];

    const completion = await this.openaiService.createCompletion({
      messages: messages as any,
      temperature: 0.7,
      maxTokens: 500
    });

    return completion.choices[0]?.message?.content || 'I could not generate a response.';
  }

}
