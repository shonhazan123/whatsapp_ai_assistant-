import { logger } from '../../utils/logger';

/**
 * ConversationMessage interface for storing message data
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: { // metadata for disambiguation context
    disambiguationContext?: {
      candidates: Array<{ id: string; displayText: string; [key: string]: any }>; // candidates are the entities that match the user's query
      entityType: string; // entity type is the type of the entity that the user is querying
      expiresAt: number;
    };
  };
}

/**
 * ConversationWindow - ChatGPT-style local conversation memory
 * 
 * Features:
 * - In-memory storage only (no database)
 * - Maximum 10 user messages per conversation (oldest removed when exceeded)
 * - Singleton pattern for global access
 * - Simple API for adding/getting messages
 */
export class ConversationWindow {
  private static instance: ConversationWindow;
  
  // In-memory storage: userPhone -> array of messages
  private memory = new Map<string, ConversationMessage[]>();
  
  // Configuration
  private readonly MAX_USER_MESSAGES = 10;
  
  private constructor() {
    logger.info('🧠 ConversationWindow singleton created');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): ConversationWindow {
    if (!ConversationWindow.instance) {
      ConversationWindow.instance = new ConversationWindow();
    }
    return ConversationWindow.instance;
  }
  
  /**
   * Add a message to the conversation window
   */
  public addMessage(userPhone: string, role: 'user' | 'assistant' | 'system', content: string, metadata?: ConversationMessage['metadata']): void {
    try {
      // Get or create conversation for user
      if (!this.memory.has(userPhone)) {
        this.memory.set(userPhone, []);
      }
      
      const messages = this.memory.get(userPhone)!;
      
      // If adding a user message, check if we need to remove oldest user message
      if (role === 'user') {
        const userMessageCount = messages.filter(m => m.role === 'user').length;
        if (userMessageCount >= this.MAX_USER_MESSAGES) {
          // Find and remove the oldest user message
          const oldestUserIndex = messages.findIndex(m => m.role === 'user');
          if (oldestUserIndex !== -1) {
            messages.splice(oldestUserIndex, 1);
            logger.debug(`Removed oldest user message for ${userPhone} (limit: ${this.MAX_USER_MESSAGES})`);
          }
        }
      }
      
      // Add new message
      const message: ConversationMessage = {
        role,
        content,
        timestamp: Date.now(),
        metadata
      };
      
      messages.push(message);
      
      logger.debug(`Added ${role} message for ${userPhone} (${messages.length} total messages)`);
    } catch (error) {
      logger.error('Error adding message to conversation window:', error);
    }
  }

  /**
   * Store disambiguation context for future reference
   */
  public storeDisambiguationContext(
    userPhone: string,
    candidates: Array<{ id: string; displayText: string; [key: string]: any }>,
    entityType: string
  ): void {
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes expiry
    
    this.addMessage(userPhone, 'system', 'DISAMBIGUATION_CONTEXT', {
      disambiguationContext: {
        candidates,
        entityType,
        expiresAt
      }
    });
    
    logger.debug(`Stored disambiguation context for ${userPhone} with ${candidates.length} candidates`);
  }

  /**
   * Get the most recent disambiguation context
   */
  public getLastDisambiguationContext(userPhone: string): ConversationMessage['metadata'] | null {
    const messages = this.memory.get(userPhone);
    if (!messages) return null;
    
    // Search backwards through messages in actual memory (not a copy)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.metadata?.disambiguationContext) {
        const context = msg.metadata.disambiguationContext;
        
        // Check if expired
        if (Date.now() > context.expiresAt) {
          logger.debug(`Disambiguation context expired for ${userPhone}`);
          return null;
        }
        
        return msg.metadata;
      }
    }
    
    return null;
  }

  /**
   * Clear disambiguation context for a user (after it's been used)
   */
  public clearDisambiguationContext(userPhone: string): void {
    const messages = this.memory.get(userPhone);
    if (!messages) return;
    
    // Find and remove disambiguation context from the most recent system message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.metadata?.disambiguationContext) {
        // Remove the metadata
        msg.metadata = undefined;
        logger.debug(`Cleared disambiguation context for ${userPhone}`);
        return;
      }
    }
    
    logger.debug(`No disambiguation context found to clear for ${userPhone}`);
  }
  
  /**
   * Get conversation context for a user
   */
  public getContext(userPhone: string): ConversationMessage[] {
    const messages = this.memory.get(userPhone) || [];
    logger.debug(`Retrieved ${messages.length} messages for ${userPhone}`);
    return [...messages]; // Return copy to prevent external modification
  }
  
  
  /**
   * Clear conversation for a user
   */
  public clear(userPhone: string): void {
    this.memory.delete(userPhone);
    logger.info(`Cleared conversation for ${userPhone}`);
  }
  
  /**
   * Get conversation statistics
   */
  public getStats(userPhone: string): { messageCount: number; userMessageCount: number } {
    const messages = this.memory.get(userPhone) || [];
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    return {
      messageCount: messages.length,
      userMessageCount
    };
  }
  
  /**
   * Get all users with active conversations
   */
  public getActiveUsers(): string[] {
    return Array.from(this.memory.keys());
  }
  
  /**
   * Clean up old conversations (older than 24 hours)
   */
  public cleanup(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [userPhone, messages] of this.memory.entries()) {
      if (messages.length === 0) {
        this.memory.delete(userPhone);
        continue;
      }
      
      // Check if last message is old
      const lastMessage = messages[messages.length - 1];
      if (now - lastMessage.timestamp > maxAge) {
        this.memory.delete(userPhone);
        logger.debug(`Cleaned up old conversation for ${userPhone}`);
      }
    }
  }
  
  
  /**
   * Format conversation for display - for debugging
   */
  public formatConversation(userPhone: string): string {
    const messages = this.memory.get(userPhone) || [];
    if (messages.length === 0) {
      return 'No conversation found';
    }
    
    return messages
      .map((msg, index) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        return `${index + 1}. [${time}] ${msg.role}: ${msg.content}`;
      })
      .join('\n');
  }
}
