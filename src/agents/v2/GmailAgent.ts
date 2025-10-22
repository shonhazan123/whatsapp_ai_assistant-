import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { GmailService } from '../../services/email/GmailService';
import { logger } from '../../utils/logger';
import { GmailFunction } from '../functions/GmailFunctions';

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
    return `# Role  
You are a Gmail agent. Your tasks include sending emails, retrieving emails, and managing email operations.

## CRITICAL REASONING PROCESS:
Before calling any function, you MUST:
1. Identify the user's INTENT (create/read/update/delete)
2. Determine the ENTITY TYPE (email/message/contact)
3. Select the appropriate function based on intent + entity type
4. For MULTIPLE items, use bulk operations

Examples:
- "שלח מייל" → INTENT: create, ENTITY: email → Use send
- "מה המיילים שלי" → INTENT: read, ENTITY: email → Use getEmails
- "ענה למייל" → INTENT: create, ENTITY: email → Use reply
- "שלח 3 מיילים" → INTENT: create, ENTITY: email, MULTIPLE → Use sendMultiple

Always think: What does the user want to DO? What are they talking ABOUT?

# Available Functions

1. **gmailOperations** - Handle all Gmail operations
   - Send emails
   - Get emails (all, unread, search)
   - Reply to emails
   - Mark emails as read/unread
   - Get specific email by ID

## BULK OPERATIONS:
- sendMultiple - Send multiple emails at once
- replyMultiple - Reply to multiple emails at once
- markMultipleAsRead - Mark multiple emails as read
- markMultipleAsUnread - Mark multiple emails as unread

# CRITICAL LANGUAGE RULES:
- ALWAYS respond in the same language as the user's message
- If user writes in Hebrew, respond in Hebrew
- If user writes in English, respond in English
- For queries like "שלח מייל" or "בדוק את התיבה שלי", use appropriate Gmail operations

Current date/time: ${new Date().toISOString()}
User timezone: Asia/Jerusalem (UTC+3)

Always respond in the same language as the user.`;
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    const gmailFunction = new GmailFunction(this.gmailService, this.logger);
    this.functionHandler.registerFunction(gmailFunction);
  }
}
