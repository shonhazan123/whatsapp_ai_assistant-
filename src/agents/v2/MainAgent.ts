import { BaseAgent } from '../../core/base/BaseAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { logger } from '../../utils/logger';
import { ConversationMessage } from '../../types';
import { getConversationHistory, saveMessage, estimateTokens } from '../../services/memory';

// Token limits for different models
const MAX_CONTEXT_TOKENS = 8000;
const SYSTEM_PROMPT_TOKENS = 500;

export class MainAgent extends BaseAgent {
  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance: any = logger
  ) {
    super(openaiService, functionHandler, logger);
  }

  async processRequest(message: string, userPhone: string): Promise<string> {
    try {
      // Step 1: Get conversation history with fallback
      let history = await getConversationHistory(userPhone).catch((err) => {
        this.logger.warn('Database unavailable, continuing without conversation history:', err.message);
        return [];
      });
      
      // Step 2: Token management - ensure we don't exceed limits
      let historyTokens = estimateTokens(history);
      const messageTokens = estimateTokens([{ role: 'user', content: message }]);
      const availableTokens = MAX_CONTEXT_TOKENS - SYSTEM_PROMPT_TOKENS - messageTokens;

      // If history is too long, trim it (keep most recent messages)
      while (historyTokens > availableTokens && history.length > 0) {
        history.shift(); // Remove oldest message
        historyTokens = estimateTokens(history);
      }

      this.logger.info(`Context: ${history.length} messages, ~${historyTokens + messageTokens} tokens`);
      
      // Step 3: Save user message (async, non-blocking)
      saveMessage(userPhone, 'user', message).catch(err => 
        this.logger.warn('Could not save user message:', err.message)
      );

      // Step 4: Determine intent and route to appropriate agent
      const intent = await this.openaiService.detectIntent(message);
      this.logger.info(`Detected intent: ${intent}`);
      
      let response: string;

      // Route to specialized agents or general conversation
      if (intent === 'calendar') {
        response = await this.routeToCalendarAgent(message, userPhone);
      } else if (intent === 'gmail') {
        response = await this.routeToGmailAgent(message, userPhone);
      } else if (intent === 'database') {
        response = await this.routeToDatabaseAgent(message, userPhone);
      } else {
        // General conversation with full context
        response = await this.getGeneralResponse(history, message);
      }

      // Step 5: Save assistant response (async, non-blocking)
      saveMessage(userPhone, 'assistant', response).catch(err =>
        this.logger.warn('Could not save assistant response:', err.message)
      );

      return response;
    } catch (error) {
      this.logger.error('Error processing message:', error);
      return 'Sorry, I encountered an error processing your request. Please try again.';
    }
  }

  getSystemPrompt(): string {
    return `Role

You are AI Assistant, a personal scheduling agent. You turn free-form user requests into precise task actions and synchronize them with Google Calendar tool named as Calendar_Agent and use all the Email queries with the Gmail_agent.

Core Objectives

- Understand user intent from plain text or voice-to-text.
- Break requests into one or more actionable tasks with sensible times.
- Write updates to Google Calendar (create/update/complete).
- Add reminders only if explicitly requested.
- If time/date is vague (e.g., "tomorrow morning"), infer sensible defaults.
- ALWAYS respond in the same language as the user's message.
- ALWAYS use conversation context to understand references like "the list" or "that task".

Current Date and Time: ${new Date().toISOString()}

CRITICAL LANGUAGE RULE: Mirror the user's language in ALL responses. If user writes in Hebrew, respond in Hebrew. If user writes in English, respond in English.

CRITICAL CONTEXT RULE: When user refers to "the list", "that task", "it", or similar context-dependent phrases, you MUST:
1. Check the conversation history for recent mentions
2. Use the same IDs/items from the previous conversation
3. Never ask for clarification if the context is clear from history

CRITICAL TASK CREATION RULE:
- When user asks to add multiple tasks, you MUST parse ALL tasks from the message
- If no date/time is specified, set dueDate to TODAY
- If user specifies a date/time, use that exact date/time
- Always use createMultiple operation for multiple tasks
- Default time is 10:00 AM if only date is specified

Timezone & Language

Assume user timezone: Asia/Jerusalem (UTC+03:00) unless an explicit timezone is provided.
Detect the user's language from the latest message. Use that language for ALL responses.

Natural-Language Time Defaults (if user does not specify exact time)

- Morning → 09:00–12:00 (default start: 09:00)
- Afternoon → 13:00–17:00 (default start: 14:00)
- Evening → 18:00–21:00 (default start: 19:00)
- Tonight → 20:00–23:00 (default start: 20:00)
- This weekend → Saturday 10:00
- If only a date is given (no time) → default start 10:00
- Duration default: 30 minutes unless clearly implied otherwise

Tools:

Gmail_Agent: Use for all Email requests, get email send email etc.
Calendar_Agent: Use for all calendar requests. Make sure the user asked for calendar calls before using this tool.
Database_Agent: Use for all task, contact, list, and data management requests. This includes retrieving existing data like "אילו רשימות יש לי".

In your response use a nice hard working assistant tone.`;
  }

  getFunctions(): FunctionDefinition[] {
    return [];
  }

  private async routeToCalendarAgent(message: string, userPhone: string): Promise<string> {
    // This would be implemented with dependency injection in a real application
    // For now, we'll return a placeholder
    return `Calendar functionality will be handled by the Calendar Agent for: "${message}"`;
  }

  private async routeToGmailAgent(message: string, userPhone: string): Promise<string> {
    // This would be implemented with dependency injection in a real application
    // For now, we'll return a placeholder
    return `Email functionality will be handled by the Gmail Agent for: "${message}"`;
  }

  private async routeToDatabaseAgent(message: string, userPhone: string): Promise<string> {
    // This would be implemented with dependency injection in a real application
    // For now, we'll return a placeholder
    return `Database functionality will be handled by the Database Agent for: "${message}"`;
  }

  private async getGeneralResponse(history: ConversationMessage[], message: string): Promise<string> {
    const messages: ConversationMessage[] = [
      {
        role: 'system',
        content: this.getSystemPrompt()
      },
      ...history,
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
