import { logger } from '../../utils/logger';
import { TextUtils } from '../../utils/text';
import { ConversationWindow } from '../memory/ConversationWindow';

interface GraphState {
  userPhone: string;
  candidates?: any[];
  messageText: string;
  response?: string;
  awaitingUserInput?: boolean;
}

interface HITLRequest {
  type: 'disambiguation' | 'confirmation' | 'list_not_found';
  candidates: any[];
  timestamp: number;
  originalMessage: string;
}

/**
 * HITLNode - Human-in-the-Loop for clarifications and confirmations
 */
export class HITLNode {
  private pendingRequests: Map<string, HITLRequest> = new Map();
  private conversationWindow: ConversationWindow;

  constructor() {
    this.conversationWindow = ConversationWindow.getInstance();
  }

  async execute(state: GraphState): Promise<Partial<GraphState>> {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🤝 HITLNode executing');
    logger.info(`👤 User: ${state.userPhone}`);
    logger.info(`📊 Candidates: ${state.candidates?.length || 0}`);

    const { userPhone, candidates, messageText } = state;
    const language = TextUtils.detectLanguage(messageText);

    // Handle list-not-found scenario
    if (candidates && candidates.length === 1 && candidates[0].type === 'list_not_found') {
      logger.info('📋 List not found scenario - asking user for clarification');
      
      this.pendingRequests.set(userPhone, {
        type: 'list_not_found',
        candidates,
        timestamp: Date.now(),
        originalMessage: messageText
      });

      logger.info('✅ HITL request stored, awaiting user response');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        awaitingUserInput: true,
        response: state.response // Use the response from DatabaseAgent
      };
    }

    // Check if we have multiple candidates that need clarification
    if (candidates && candidates.length > 1) {
      logger.info(`📌 Multiple candidates found (${candidates.length}), requesting clarification`);
      
      const clarificationMessage = this.formatClarificationMessage(candidates, language);
      
      // Store pending request
      this.pendingRequests.set(userPhone, {
        type: 'disambiguation',
        candidates,
        timestamp: Date.now(),
        originalMessage: messageText
      });

      logger.info('✅ HITL disambiguation request stored');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return {
        awaitingUserInput: true,
        response: clarificationMessage
      };
    }

    logger.info('✅ No HITL needed, continuing');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      awaitingUserInput: false
    };
  }

  hasPendingRequest(userPhone: string): boolean {
    const request = this.pendingRequests.get(userPhone);
    if (!request) {
      logger.debug(`📋 No pending HITL request for ${userPhone}`);
      return false;
    }

    // Check if request is expired (5 minutes)
    const isExpired = Date.now() - request.timestamp > 5 * 60 * 1000;
    if (isExpired) {
      logger.warn(`⏰ HITL request expired for ${userPhone}`);
      this.pendingRequests.delete(userPhone);
      return false;
    }

    logger.info(`✅ Found pending HITL request for ${userPhone}: ${request.type}`);
    return true;
  }

  /**
   * Process HITL response from user
   */
  async processResponse(userPhone: string, response: string): Promise<any> {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🔄 Processing HITL response');
    logger.info(`👤 User: ${userPhone}`);
    logger.info(`💬 Response: "${response}"`);

    const request = this.pendingRequests.get(userPhone);
    if (!request) {
      logger.warn('⚠️  No pending request found');
      return null;
    }

    logger.info(`📋 Request type: ${request.type}`);

    // Handle list-not-found response
    if (request.type === 'list_not_found') {
      logger.info('🔍 Processing list-not-found response');
      
      // Check if user wants to create new list (response = "1" or "כן" or "yes")
      const createNewList = response.trim() === '1' || 
                           response.toLowerCase().includes('כן') ||
                           response.toLowerCase().includes('yes') ||
                           response.toLowerCase().includes('create');

      if (createNewList) {
        logger.info('✅ User confirmed: create new list');
        this.pendingRequests.delete(userPhone);
        
        return {
          action: 'create_new_list',
          data: request.candidates[0].data,
          originalMessage: request.originalMessage // Pass original message for context
        };
      } else {
        logger.info('❌ User declined or provided alternative');
        this.pendingRequests.delete(userPhone);
        
        return {
          action: 'use_different_list',
          listName: response.trim(),
          originalMessage: request.originalMessage // Pass original message for context
        };
      }
    }

    // Handle disambiguation response
    if (request.type === 'disambiguation') {
      const selection = parseInt(response.trim());
      
      if (!isNaN(selection) && selection >= 1 && selection <= request.candidates.length) {
        const selected = request.candidates[selection - 1];
        logger.info(`✅ User selected option ${selection}: ${selected.label}`);
        this.pendingRequests.delete(userPhone);
        
        return {
          action: 'selected',
          candidate: selected,
          originalMessage: request.originalMessage // Pass original message for context
        };
      }
      
      logger.warn(`⚠️  Invalid selection: ${response}`);
    }

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    return null;
  }

  private formatClarificationMessage(candidates: any[], language: 'he' | 'en'): string {
    if (language === 'he') {
      let message = `מצאתי ${candidates.length} פריטים תואמים:\n\n`;
      candidates.forEach((candidate, index) => {
        const emoji = this.getNumberEmoji(index + 1);
        message += `${emoji} ${candidate.label}\n`;
      });
      message += `\nאיזה מהם תרצה?`;
      return message;
    } else {
      let message = `I found ${candidates.length} matching items:\n\n`;
      candidates.forEach((candidate, index) => {
        const emoji = this.getNumberEmoji(index + 1);
        message += `${emoji} ${candidate.label}\n`;
      });
      message += `\nWhich one would you like?`;
      return message;
    }
  }

  private getNumberEmoji(num: number): string {
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    return emojis[num - 1] || `${num}.`;
  }
}
