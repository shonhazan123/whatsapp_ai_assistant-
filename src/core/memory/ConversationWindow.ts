import { logger } from '../../utils/logger';

/**
 * ConversationMessage interface for storing message data
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  whatsappMessageId?: string; // Store WhatsApp message ID for reply context
  replyToMessageId?: string; // If this message is a reply, store the message ID it's replying to
  estimatedTokens?: number; // Cached token count for performance
  metadata?: {
    // metadata for disambiguation context or recent tasks
    disambiguationContext?: {
      candidates: Array<{ id: string; displayText: string; [key: string]: any }>; // candidates are the entities that match the user's query
      entityType: string; // entity type is the type of the entity that the user is querying
      expiresAt: number;
    };
    recentTasks?: {
      tasks: RecentTaskSnapshot[];
      updatedAt: number;
    };
    imageContext?: {
      imageId: string; // WhatsApp media ID
      analysisResult: any; // ImageAnalysisResult - using any to avoid circular dependency
      imageType: 'structured' | 'random';
      extractedAt: number; // Timestamp
    };
    reminderContext?: {
      taskTexts: string[]; // Task texts from the reminder message
      taskIds: string[]; // Task IDs from the reminder message
      reminderType: 'one-time' | 'recurring' | 'nudge'; // Type of reminder
      sentAt: string; // ISO timestamp when reminder was sent
    };
  };
}

export interface RecentTaskSnapshot {
  id?: string | null;
  text: string;
  dueDate?: string | null;
  reminder?: string | null;
  reminderRecurrence?: any;
  createdAt?: string | number | null;
}

/**
 * ConversationWindow - ChatGPT-style local conversation memory
 * 
 * Features:
 * - In-memory storage only (no database)
 * - Maximum configurable total messages (user + assistant) per conversation
 * - Maximum configurable total tokens for all context messages
 * - Maintains conversation pairs together (user message + its response)
 * - Smart removal prioritizes pairs and importance
 * - Supports WhatsApp reply context detection
 * - Singleton pattern for global access
 * - Token counting with caching for performance
 * - All limits are configurable via public constants
 */
export class ConversationWindow {
  private static instance: ConversationWindow;
  
  // In-memory storage: userPhone -> array of messages
  private memory = new Map<string, ConversationMessage[]>();
  private recentTaskContext = new Map<string, RecentTaskSnapshot[]>();
  
  // ============================================================================
  // CONFIGURABLE CONSTANTS - Adjust these to tune context management
  // ============================================================================
  
  /** Maximum total messages (user + assistant combined). System messages excluded from count but included in token calculation. */
  public readonly MAX_TOTAL_MESSAGES = 10;
  
  /** Maximum total tokens for all context messages combined */
  public readonly MAX_TOTAL_TOKENS = 500;
  
  /** Maximum recent tasks to store per user */
  public readonly MAX_RECENT_TASKS = 4;
  
  /** Maximum system messages to keep in context (to prevent system message bloat) */
  public readonly MAX_SYSTEM_MESSAGES = 3;
  
  /** Characters per token estimation (lower = more conservative, higher = less conservative) */
  public readonly CHARS_PER_TOKEN = 3.5;
  
  /** Conversation cleanup age in milliseconds (default: 12 hours) */
  public readonly CONVERSATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
  
  /** Disambiguation context expiry time in milliseconds (default: 5 minutes) */
  public readonly DISAMBIGUATION_EXPIRY_MS = 5 * 60 * 1000;
  
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
   * Estimate token count for a message content
   * Uses approximation: ~3.5 characters per token (accounts for Hebrew/English mix)
   */
  private estimateTokens(content: string): number {
    if (!content || content.length === 0) return 0;
    return Math.ceil(content.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Get total token count for all messages (excluding system messages from count but including in tokens)
   */
  private getTotalTokens(messages: ConversationMessage[]): number {
    return messages.reduce((total, msg) => {
      if (msg.estimatedTokens !== undefined) {
        return total + msg.estimatedTokens;
      }
      // Calculate if not cached
      const tokens = this.estimateTokens(msg.content);
      msg.estimatedTokens = tokens;
      return total + tokens;
    }, 0);
  }

  /**
   * Count user + assistant messages (system messages excluded from count)
   */
  private countContextMessages(messages: ConversationMessage[]): number {
    return messages.filter(m => m.role === 'user' || m.role === 'assistant').length;
  }

  /**
   * Calculate message importance score (0-100, higher = more important)
   */
  private calculateMessageImportance(message: ConversationMessage, index: number, totalMessages: number): number {
    let importance = 50; // Base importance
    
    // Recent messages are more important
    const recencyScore = ((totalMessages - index) / totalMessages) * 30;
    importance += recencyScore;
    
    // User and assistant messages are more important than system
    if (message.role === 'user' || message.role === 'assistant') {
      importance += 20;
    }
    
    // Messages with important metadata are more important
    if (message.metadata?.disambiguationContext) {
      importance += 10;
    } else if (message.metadata?.recentTasks) {
      importance += 5;
    }
    
    return Math.min(100, Math.max(0, importance));
  }

  /**
   * Remove oldest messages until under token limit
   * Prioritizes removing complete pairs, then by importance
   */
  private removeOldestUntilUnderLimit(messages: ConversationMessage[], maxTokens: number): void {
    let totalTokens = this.getTotalTokens(messages);
    
    // If already under limit, nothing to do
    if (totalTokens <= maxTokens) {
      return;
    }
    
    // Calculate importance for all messages
    const messagesWithImportance = messages.map((msg, idx) => ({
      message: msg,
      index: idx,
      importance: this.calculateMessageImportance(msg, idx, messages.length)
    }));
    
    // Sort by importance (lowest first = remove first)
    messagesWithImportance.sort((a, b) => a.importance - b.importance);
    
    // Remove messages until under limit
    const indicesToRemove = new Set<number>();
    let remainingTokens = totalTokens;
    
    for (const { message, index } of messagesWithImportance) {
      if (remainingTokens <= maxTokens) {
        break;
      }
      
      const messageTokens = message.estimatedTokens || this.estimateTokens(message.content);
      remainingTokens -= messageTokens;
      indicesToRemove.add(index);
    }
    
    // Remove in reverse order to maintain indices
    const sortedIndices = Array.from(indicesToRemove).sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      messages.splice(idx, 1);
    }
    
    if (indicesToRemove.size > 0) {
      logger.debug(`Removed ${indicesToRemove.size} messages to stay under ${maxTokens} token limit`);
    }
  }

  /**
   * Remove oldest user or assistant message (not system)
   * Handles cases where agent sends messages without user messages (e.g., morning digests, reminders)
   * Returns true if a message was removed, false otherwise
   */
  private removeOldestContextMessage(messages: ConversationMessage[]): boolean {
    // Find the oldest user or assistant message (not system)
    const oldestIndex = messages.findIndex(m => m.role === 'user' || m.role === 'assistant');
    
    if (oldestIndex === -1) {
      // No user or assistant messages to remove
      return false;
    }
    
    // Remove the oldest context message
    const removedRole = messages[oldestIndex].role;
    messages.splice(oldestIndex, 1);
    logger.debug(`Removed oldest ${removedRole} message`);
    
    return true;
  }

  /**
   * Remove excess system messages (keep only most recent ones)
   */
  private removeExcessSystemMessages(messages: ConversationMessage[]): void {
    const systemMessages = messages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => msg.role === 'system');
    
    if (systemMessages.length <= this.MAX_SYSTEM_MESSAGES) {
      return;
    }
    
    // Remove oldest system messages
    const toRemove = systemMessages.length - this.MAX_SYSTEM_MESSAGES;
    const sortedByIndex = systemMessages.sort((a, b) => a.idx - b.idx);
    
    // Remove in reverse order
    for (let i = toRemove - 1; i >= 0; i--) {
      messages.splice(sortedByIndex[i].idx, 1);
    }
    
    logger.debug(`Removed ${toRemove} excess system messages`);
  }
  
  /**
   * Add a message to the conversation window
   * Enforces both message count limit (MAX_TOTAL_MESSAGES) and token limit (MAX_TOTAL_TOKENS)
   * @param userPhone - User's phone number
   * @param role - Message role (user, assistant, system)
   * @param content - Message content
   * @param metadata - Optional metadata (disambiguation, tasks, etc.)
   * @param whatsappMessageId - Optional WhatsApp message ID for reply context
   * @param replyToMessageId - Optional ID of the message this is replying to
   */
  public addMessage(
    userPhone: string, 
    role: 'user' | 'assistant' | 'system', 
    content: string, 
    metadata?: ConversationMessage['metadata'],
    whatsappMessageId?: string,
    replyToMessageId?: string
  ): void {
    try {
      // Get or create conversation for user
      if (!this.memory.has(userPhone)) {
        this.memory.set(userPhone, []);
      }
      
      const messages = this.memory.get(userPhone)!;
      
      // Calculate tokens for new message
      const newMessageTokens = this.estimateTokens(content);
      
      // Enforce message count limit (user + assistant only, system excluded from count)
      if (role === 'user' || role === 'assistant') {
        let loopCount = 0;
        let previousCount = this.countContextMessages(messages);
        
        while (this.countContextMessages(messages) >= this.MAX_TOTAL_MESSAGES) {
          loopCount++;
          
          // Safety check to prevent infinite loops
          if (loopCount > 100) {
            logger.error(`Infinite loop detected in message count limit enforcement! Count: ${previousCount}, Limit: ${this.MAX_TOTAL_MESSAGES}`);
            throw new Error('Infinite loop in message count limit enforcement');
          }
          
          // Try to remove oldest context message
          const removed = this.removeOldestContextMessage(messages);
          const newCount = this.countContextMessages(messages);
          
          // Safety check: if removal didn't reduce count, force break to prevent infinite loop
          if (!removed || newCount >= previousCount) {
            logger.error(`Removal failed or count didn't decrease! removed=${removed}, previous=${previousCount}, new=${newCount}`);
            // Force remove the oldest message regardless (fallback)
            const fallbackIndex = messages.findIndex(m => m.role === 'user' || m.role === 'assistant');
            if (fallbackIndex !== -1) {
              messages.splice(fallbackIndex, 1);
              logger.warn(`Force removed message at index ${fallbackIndex} to break potential infinite loop`);
            } else {
              // No context messages left, break the loop
              logger.error(`No context messages to remove, breaking loop to prevent infinite loop`);
              break;
            }
          }
          
          previousCount = this.countContextMessages(messages);
        }
      }
      
      // Enforce token limit (includes all messages: user, assistant, and system)
      // Recalculate tokens after message count limit enforcement
      const updatedTotalTokens = this.getTotalTokens(messages);
      const projectedTotalTokens = updatedTotalTokens + newMessageTokens;
      
      if (projectedTotalTokens > this.MAX_TOTAL_TOKENS) {
        // Remove messages until we have room for the new one
        const targetTokens = this.MAX_TOTAL_TOKENS - newMessageTokens;
        this.removeOldestUntilUnderLimit(messages, targetTokens);
      }
      
      // Remove excess system messages (keep only most recent ones)
      if (role === 'system') {
        this.removeExcessSystemMessages(messages);
      }
      
      // For assistant messages: if there's no preceding user message, log a warning
      // (This shouldn't happen in normal flow, but helps with debugging)
      if (role === 'assistant' && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== 'user' && lastMessage.role !== 'system') {
          logger.warn(`Assistant message added without preceding user message for ${userPhone}`);
        }
      }
      
      // Add new message with cached token count
      const message: ConversationMessage = {
        role,
        content,
        timestamp: Date.now(),
        whatsappMessageId,
        replyToMessageId,
        metadata,
        estimatedTokens: newMessageTokens
      };
      
      messages.push(message);
      
      // Log current state for debugging
      const finalCount = this.countContextMessages(messages);
      const finalTokens = this.getTotalTokens(messages);
      logger.debug(`Added ${role} message for ${userPhone}. Context: ${finalCount}/${this.MAX_TOTAL_MESSAGES} messages, ${finalTokens}/${this.MAX_TOTAL_TOKENS} tokens`);
      
    } catch (error) {
      logger.error('Error adding message to conversation window:', error);
      throw error;
    }
  }
  
  /**
   * Get the message that a user is replying to (if any)
   * @param userPhone - User's phone number
   * @param replyToMessageId - WhatsApp message ID being replied to
   * @returns The message being replied to, or null if not found
   */
  public getRepliedToMessage(userPhone: string, replyToMessageId: string): ConversationMessage | null {
    const messages = this.memory.get(userPhone);
    if (!messages) return null;
    
    // Find message by WhatsApp message ID
    const repliedTo = messages.find(m => m.whatsappMessageId === replyToMessageId);
    return repliedTo || null;
  }

  /**
   * Store disambiguation context for future reference
   */
  public storeDisambiguationContext(
    userPhone: string,
    candidates: Array<{ id: string; displayText: string; [key: string]: any }>,
    entityType: string
  ): void {
    const expiresAt = Date.now() + this.DISAMBIGUATION_EXPIRY_MS;
    
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
   * Get the last message with image context (if any)
   * Searches backwards through messages to find the most recent one with imageContext
   */
  public getLastMessageWithImageContext(userPhone: string): ConversationMessage | null {
    const messages = this.memory.get(userPhone);
    if (!messages) return null;
    
    // Search backwards through messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.metadata?.imageContext) {
        return msg;
      }
    }
    
    return null;
  }

  /**
   * Store or refresh recent task context for a user
   */
  public pushRecentTasks(userPhone: string, tasks: RecentTaskSnapshot[], options: { replace?: boolean } = {}): void {
    if (!tasks || tasks.length === 0) {
      return;
    }

    const normalized: RecentTaskSnapshot[] = tasks
      .filter(task => !!task && typeof task.text === 'string' && task.text.trim().length > 0)
      .map(task => ({
        id: task.id ?? (task as any).taskId ?? null,
        text: task.text.trim(),
        dueDate: (task as any).dueDate ?? (task as any).due_date ?? null,
        reminder: (task as any).reminder ?? null,
        reminderRecurrence: (task as any).reminderRecurrence ?? (task as any).reminder_recurrence ?? null,
        createdAt: task.createdAt ?? (task as any).created_at ?? null
      }));

    if (normalized.length === 0) {
      return;
    }

    const existing = options.replace ? [] : (this.recentTaskContext.get(userPhone) || []);

    // Merge and deduplicate by id when available, otherwise by text
    const merged = [...existing, ...normalized];
    const dedupMap = new Map<string, RecentTaskSnapshot>();

    for (const task of merged) {
      const key = task.id && typeof task.id === 'string' && task.id.length > 0
        ? `id:${task.id}`
        : `text:${task.text.toLowerCase()}`;
      dedupMap.set(key, task);
    }

    const deduped = Array.from(dedupMap.values());
    const trimmed = deduped.slice(-this.MAX_RECENT_TASKS);

    this.recentTaskContext.set(userPhone, trimmed);

    const summaryLines = trimmed.map((task, idx) => `${idx + 1}. ${task.text}`);
    this.addMessage(
      userPhone,
      'system',
      `RECENT_TASKS_CONTEXT\n${summaryLines.join('\n')}`,
      {
        recentTasks: {
          tasks: trimmed,
          updatedAt: Date.now()
        }
      }
    );
  }

  /**
   * Retrieve recent task context for a user
   */
  public getRecentTasks(userPhone: string): RecentTaskSnapshot[] {
    const tasks = this.recentTaskContext.get(userPhone) || [];
    return [...tasks];
  }

  /**
   * Remove stored recent tasks for a user
   */
  public clearRecentTasks(userPhone: string): void {
    this.recentTaskContext.delete(userPhone);
  }
  
  
  /**
   * Clear conversation for a user
   */
  public clear(userPhone: string): void {
    this.memory.delete(userPhone);
    this.recentTaskContext.delete(userPhone);
    logger.info(`Cleared conversation for ${userPhone}`);
  }
  
  /**
   * Get conversation statistics
   */
  public getStats(userPhone: string): { 
    messageCount: number; 
    userMessageCount: number; 
    assistantMessageCount: number; 
    systemMessageCount: number;
    contextMessageCount: number;
    totalTokens: number;
    tokenLimit: number;
    messageLimit: number;
  } {
    const messages = this.memory.get(userPhone) || [];
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;
    const systemMessageCount = messages.filter(m => m.role === 'system').length;
    const contextMessageCount = this.countContextMessages(messages);
    const totalTokens = this.getTotalTokens(messages);
    
    return {
      messageCount: messages.length,
      userMessageCount,
      assistantMessageCount,
      systemMessageCount,
      contextMessageCount,
      totalTokens,
      tokenLimit: this.MAX_TOTAL_TOKENS,
      messageLimit: this.MAX_TOTAL_MESSAGES
    };
  }
  
  /**
   * Get all users with active conversations
   */
  public getActiveUsers(): string[] {
    return Array.from(this.memory.keys());
  }
  
  /**
   * Clean up old conversations (older than CONVERSATION_MAX_AGE_MS)
   */
  public cleanup(): void {
    const now = Date.now();
    
    for (const [userPhone, messages] of this.memory.entries()) {
      if (messages.length === 0) {
        this.memory.delete(userPhone);
        this.recentTaskContext.delete(userPhone);
        continue;
      }
      
      // Check if last message is old
      const lastMessage = messages[messages.length - 1];
      if (now - lastMessage.timestamp > this.CONVERSATION_MAX_AGE_MS) {
        this.memory.delete(userPhone);
        this.recentTaskContext.delete(userPhone);
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
