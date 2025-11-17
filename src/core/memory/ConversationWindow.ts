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
 * - Maximum 10 user-assistant pairs (20 messages total) per conversation
 * - Maintains conversation pairs together (user message + its response)
 * - Supports WhatsApp reply context detection
 * - Singleton pattern for global access
 * - Simple API for adding/getting messages
 */
export class ConversationWindow {
  private static instance: ConversationWindow;
  
  // In-memory storage: userPhone -> array of messages
  private memory = new Map<string, ConversationMessage[]>();
  private recentTaskContext = new Map<string, RecentTaskSnapshot[]>();
  
  // Configuration
  private readonly MAX_USER_MESSAGES = 10; // Maximum 10 user messages (each with its assistant response = 20 messages total)
  private readonly MAX_RECENT_TASKS = 6;
  
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
      
      // For user messages: enforce limit of MAX_USER_MESSAGES user messages
      // Each user message should have its corresponding assistant response
      // System messages are allowed but don't count toward the user message limit
      if (role === 'user') {
        const userMessageCount = messages.filter(m => m.role === 'user').length;
        
        // If we're at the limit, remove the oldest user message AND its assistant response (if exists)
        if (userMessageCount >= this.MAX_USER_MESSAGES) {
          // Find the oldest user message
          const oldestUserIndex = messages.findIndex(m => m.role === 'user');
          if (oldestUserIndex !== -1) {
            // Remove the user message
            messages.splice(oldestUserIndex, 1);
            
            // If there's an assistant message right after it, remove that too (maintain pairs)
            // Also check if there's a system message between them (shouldn't happen, but be safe)
            if (oldestUserIndex < messages.length && messages[oldestUserIndex].role === 'assistant') {
              messages.splice(oldestUserIndex, 1);
              logger.debug(`Removed oldest user-assistant pair for ${userPhone} (limit: ${this.MAX_USER_MESSAGES} user messages)`);
            } else {
              logger.debug(`Removed oldest user message for ${userPhone} (limit: ${this.MAX_USER_MESSAGES} user messages)`);
            }
          }
        }
      }
      
      // For assistant messages: if there's no preceding user message, log a warning
      // (This shouldn't happen in normal flow, but helps with debugging)
      if (role === 'assistant' && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.role !== 'user' && lastMessage.role !== 'system') {
          logger.warn(`Assistant message added without preceding user message for ${userPhone}`);
        }
      }
      
      // Add new message
      const message: ConversationMessage = {
        role,
        content,
        timestamp: Date.now(),
        whatsappMessageId,
        replyToMessageId,
        metadata
      };
      
      messages.push(message);
      
      const userMsgCount = messages.filter(m => m.role === 'user').length;
      logger.debug(`Added ${role} message for ${userPhone} (${messages.length} total messages, ${userMsgCount} user messages)`);
    } catch (error) {
      logger.error('Error adding message to conversation window:', error);
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
  public getStats(userPhone: string): { messageCount: number; userMessageCount: number; assistantMessageCount: number; systemMessageCount: number } {
    const messages = this.memory.get(userPhone) || [];
    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;
    const systemMessageCount = messages.filter(m => m.role === 'system').length;
    return {
      messageCount: messages.length,
      userMessageCount,
      assistantMessageCount,
      systemMessageCount
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
        this.recentTaskContext.delete(userPhone);
        continue;
      }
      
      // Check if last message is old
      const lastMessage = messages[messages.length - 1];
      if (now - lastMessage.timestamp > maxAge) {
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
