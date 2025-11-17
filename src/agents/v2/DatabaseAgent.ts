import { SystemPrompts } from '../../config/system-prompts';
import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { ContactService } from '../../services/database/ContactService';
import { ListService } from '../../services/database/ListService';
import { TaskService } from '../../services/database/TaskService';
import { UserDataService } from '../../services/database/UserDataService';
import { logger } from '../../utils/logger';
import { ContactFunction, ListFunction, TaskFunction, UserDataFunction } from '../functions/DatabaseFunctions';

export class DatabaseAgent extends BaseAgent {
  private taskService: TaskService;
  private contactService: ContactService;
  private listService: ListService;
  private userDataService: UserDataService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, logger);

    // Initialize services
    this.taskService = new TaskService(logger);
    this.contactService = new ContactService(logger);
    this.listService = new ListService(logger);
    this.userDataService = new UserDataService(
      this.taskService,
      this.contactService,
      this.listService,
      logger
    );

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
      this.logger.info('💾 Database Agent activated');
      this.logger.info(`📝 Processing database request: "${message}"`);
      this.logger.info(`📚 Context: ${context.length} messages`);
      
      return await this.executeWithAI(
        message,
        userPhone,
        this.getSystemPrompt(),
        this.getFunctions(),
        context
      );
    } catch (error) {
      this.logger.error('Database agent error:', error);
      return 'Sorry, I encountered an error with your database request.';
    }
  }

  getSystemPrompt(): string {
    return SystemPrompts.getDatabaseAgentPrompt();
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    // Task functions
    const taskFunction = new TaskFunction(this.taskService, this.logger);
    this.functionHandler.registerFunction(taskFunction);

    // Contact functions
    const contactFunction = new ContactFunction(this.contactService, this.logger);
    this.functionHandler.registerFunction(contactFunction);

    // List functions
    const listFunction = new ListFunction(this.listService, this.logger);
    this.functionHandler.registerFunction(listFunction);

    // User data functions
    const userDataFunction = new UserDataFunction(this.userDataService, this.logger);
    this.functionHandler.registerFunction(userDataFunction);
  }
}
