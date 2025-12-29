import { SystemPrompts } from '../../config/system-prompts';
import { BaseAgent } from '../../core/base/BaseAgent';
import { IFunctionHandler } from '../../core/interfaces/IAgent';
import { ConversationWindow } from '../../core/memory/ConversationWindow';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { logger } from '../../utils/logger';

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

  async processRequest(
    message: string, 
    userPhone: string,
    optionsOrContext?: {
      whatsappMessageId?: string;
      replyToMessageId?: string;
    } | any[]
  ): Promise<string> {
    // Extract options if it's an object (not an array)
    const options = !Array.isArray(optionsOrContext) ? optionsOrContext : undefined;
    try {
      // Initialize and cache AgentManager once
      if (!this.agentManager) {
        const module = await import('../../core/manager/AgentManager');
        this.agentManager = module.AgentManager.getInstance();
      }

      // Step 1: Handle reply context if this is a reply to a previous message
      let enhancedMessage = message;
      let imageContextToInclude: any = null;
      
      if (options?.replyToMessageId) {
        const repliedToMessage = this.conversationWindow.getRepliedToMessage(userPhone, options.replyToMessageId);
        if (repliedToMessage) {
          // Check if the replied-to message has reminder context
          if (repliedToMessage.metadata?.reminderContext) {
            const reminderCtx = repliedToMessage.metadata.reminderContext;
            const taskTexts = reminderCtx.taskTexts || [];
            if (taskTexts.length > 0) {
              enhancedMessage = `[Context: User is replying to a reminder message about: ${taskTexts.join(', ')}]\n\n${message}`;
              this.logger.debug(`User replied to reminder message with tasks: ${taskTexts.join(', ')}`);
            }
          }
          
          // Check if the replied-to message has image context
          if (repliedToMessage.metadata?.imageContext) {
            imageContextToInclude = repliedToMessage.metadata.imageContext;
            this.logger.debug(`User replied to a message with image context (${imageContextToInclude.imageType})`);
          }
          
          // Enhance the message with context about what it's replying to
          // Include more context for list messages to help identify items by number
          const repliedToContent = repliedToMessage.content;
          
          // Check if the replied-to message contains a numbered list (like "1. Event 1\n2. Event 2")
          // This helps the AI understand references like "ב1" (item #1) or "האירוע הראשון" (the first event)
          const hasNumberedList = /^\d+\.|^\s*\d+\./.test(repliedToContent) || /\n\d+\./.test(repliedToContent);
          
          // Only add list context if we haven't already added reminder context
          if (!repliedToMessage.metadata?.reminderContext) {
            if (hasNumberedList) {
              // Include full list context (up to 1000 chars) so AI can match numbered references
              const listContent = repliedToContent.substring(0, 1000);
              enhancedMessage = `[The user is replying to a message that listed items:\n"${listContent}"\n\nIMPORTANT: When the user refers to an item by number (like "ב1", "#1", "הראשון", "the first one"), they mean the corresponding numbered item from the list above. Extract the details (name, time, etc.) from that numbered item and use them as searchCriteria (OLD values) when updating.]\n\nUser's message: ${message}`;
              this.logger.debug(`User is replying to a numbered list message`);
            } else {
              // Regular reply context
              const shortContent = repliedToContent.substring(0, 500);
              enhancedMessage = `[Replying to: "${shortContent}"]\n\n${message}`;
              this.logger.debug(`User is replying to message: "${shortContent.substring(0, 100)}..."`);
            }
          }
        }
      }

      // Step 1.5: Check for image context if not already found from reply
      // Check if image context exists in the last 3 user messages
      if (!imageContextToInclude) {
        const messages = this.conversationWindow.getContext(userPhone);
        // Get last 3 user messages (excluding the current one we're about to add)
        const userMessages = messages.filter(m => m.role === 'user').slice(-3);
        
        // Search backwards through last 3 user messages for image context
        for (let i = userMessages.length - 1; i >= 0; i--) {
          const msg = userMessages[i];
          if (msg.metadata?.imageContext) {
            imageContextToInclude = msg.metadata.imageContext;
            this.logger.debug(`Found image context in last 3 user messages (${imageContextToInclude.imageType})`);
            break;
          }
        }
      }

      // Include image context if found
      if (imageContextToInclude) {
        const imageCtx = imageContextToInclude;
        this.logger.debug(`Including image context (${imageCtx.imageType})`);
        
        // Build context string with extracted data
        let imageContextStr = `[Context: The user previously sent an image (${imageCtx.imageType}). `;
        
        if (imageCtx.imageType === 'structured' && imageCtx.analysisResult.structuredData) {
          const data = imageCtx.analysisResult.structuredData.extractedData;
          imageContextStr += 'Extracted data from the image:\n';
          
          if (data.events && data.events.length > 0) {
            imageContextStr += `Events: ${JSON.stringify(data.events)}\n`;
          }
          if (data.tasks && data.tasks.length > 0) {
            imageContextStr += `Tasks: ${JSON.stringify(data.tasks)}\n`;
          }
          if (data.contacts && data.contacts.length > 0) {
            imageContextStr += `Contacts: ${JSON.stringify(data.contacts)}\n`;
          }
          
          imageContextStr += '\nWhen the user says "it", "this", "that", "yes", "add it", "תוסיף", "כן", etc., they are referring to the data extracted from the image above. Use the extracted data to fulfill their request.\n';
        } else {
          imageContextStr += `Image description: ${imageCtx.analysisResult.description || 'No description'}\n`;
        }
        
        imageContextStr += `]\n\n`;
        enhancedMessage = imageContextStr + enhancedMessage;
      }

      // Step 2: Add user message to conversation window with WhatsApp message ID and reply context
      this.conversationWindow.addMessage(
        userPhone, 
        'user', 
        message, // Store original message, not enhanced
        undefined,
        options?.whatsappMessageId,
        options?.replyToMessageId
      );
      
      // Step 3: Get conversation context
      const context = this.conversationWindow.getContext(userPhone);

      // Step 4: Delegate to multi-agent coordinator (use enhanced message for better context)
      const response = await this.agentManager
        .getMultiAgentCoordinator()
        .handleRequest(enhancedMessage, userPhone, context);

      // Step 5: Add assistant response to conversation window
      // Note: WhatsApp message ID will be added when the message is actually sent
      this.conversationWindow.addMessage(userPhone, 'assistant', response);

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
}
