import { logger } from '../../utils/logger';

/**
 * ConversationMessage interface for storing message data
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    disambiguationContext?: {
      candidates: Array<{ id: string; displayText: string; [key: string]: any }>;
      entityType: string;
      expiresAt: number;
    };
  };
}

/**
 * ConversationWindow - ChatGPT-style local conversation memory
 * 
 * Features:
 * - In-memory storage only (no database)
 * - Token-based trimming to stay under limits
 * - Singleton pattern for global access
 * - Simple API for adding/getting messages
 */
export class ConversationWindow {
  private static instance: ConversationWindow;
  
  // In-memory storage: userPhone -> array of messages
  private memory = new Map<string, ConversationMessage[]>();
  
  // Configuration
  private readonly MAX_TOKENS = 8000;
  private readonly SYSTEM_TOKENS = 500;
  private readonly MAX_MESSAGES = 50; // Fallback limit
  
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
      
      // Add new message
      const message: ConversationMessage = {
        role,
        content,
        timestamp: Date.now(),
        metadata
      };
      
      messages.push(message);
      
      // Trim to token limit
      this.trimToTokenLimit(userPhone);
      
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
   * Trim conversation to stay under token limit
   */
  public trimToTokenLimit(userPhone: string): void {
    const messages = this.memory.get(userPhone);
    if (!messages || messages.length === 0) return;
    
    let totalTokens = this.estimateTokens(messages);
    const maxAllowedTokens = this.MAX_TOKENS - this.SYSTEM_TOKENS;
    
    // Remove oldest messages until under limit
    while (totalTokens > maxAllowedTokens && messages.length > 1) {
      const removed = messages.shift();
      if (removed) {
        totalTokens = this.estimateTokens(messages);
        logger.debug(`Trimmed message: "${removed.content.substring(0, 50)}..." (${totalTokens} tokens remaining)`);
      }
    }
    
    // Fallback: if still too many messages, keep only recent ones
    if (messages.length > this.MAX_MESSAGES) {
      const keepCount = Math.floor(this.MAX_MESSAGES * 0.8); // Keep 80% of max
      const removed = messages.splice(0, messages.length - keepCount);
      logger.warn(`Fallback trim: removed ${removed.length} messages, kept ${messages.length}`);
    }
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
  public getStats(userPhone: string): { messageCount: number; tokenCount: number } {
    const messages = this.memory.get(userPhone) || [];
    return {
      messageCount: messages.length,
      tokenCount: this.estimateTokens(messages)
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
   * Estimate token count for messages (simple approximation)
   * This is a basic estimation - in production, you might want to use a more accurate tokenizer
   */
  private estimateTokens(messages: ConversationMessage[]): number {
    let totalTokens = 0;
    
    for (const message of messages) {
      // Rough estimation: 1 token ≈ 4 characters for English, 2 characters for Hebrew
      const content = message.content;
      const isHebrew = /[\u0590-\u05FF]/.test(content);
      const multiplier = isHebrew ? 0.5 : 0.25; // Hebrew is more token-dense
      
      totalTokens += Math.ceil(content.length * multiplier);
      
      // Add overhead for role and structure
      totalTokens += 10; // Role + JSON structure overhead
    }
    
    return totalTokens;
  }
  
  /**
   * Format conversation for display (useful for debugging)
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
