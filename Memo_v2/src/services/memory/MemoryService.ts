/**
 * MemoryService - Centralized memory management for Memo V2
 * 
 * Encapsulates all memory operations in one place.
 * Provides a clean API for graph nodes to interact with conversation memory.
 * 
 * Responsibilities:
 * - Add user/assistant messages
 * - Get recent messages in MemoState format (ISO timestamps)
 * - Manage disambiguation context
 * - Validate message existence
 */

import type { ConversationMessage as MemoStateMessage, DisambiguationContext, ImageContext } from '../../types/index.js';
import { ConversationWindow, type ConversationMessage as CWMessage, type RecentTaskSnapshot } from './ConversationWindow.js';

// Re-export types for convenience
export type { RecentTaskSnapshot } from './ConversationWindow.js';

/**
 * MemoryService - Singleton service for conversation memory management
 */
export class MemoryService {
  private static instance: MemoryService;
  private conversationWindow: ConversationWindow;

  private constructor() {
    this.conversationWindow = ConversationWindow.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  // ============================================================================
  // MESSAGE OPERATIONS
  // ============================================================================

  /**
   * Add a user message to conversation memory
   * @param phone - User's phone number
   * @param message - Message content
   * @param options - Optional metadata and IDs
   */
  public addUserMessage(
    phone: string,
    message: string,
    options: {
      whatsappMessageId?: string;
      replyToMessageId?: string;
      disambiguationContext?: DisambiguationContext;
      imageContext?: ImageContext;
    } = {}
  ): void {
    const metadata: CWMessage['metadata'] = {};
    
    if (options.disambiguationContext) {
      // Convert MemoState DisambiguationContext to CW format
      metadata.disambiguationContext = {
        candidates: options.disambiguationContext.candidates || [],
        entityType: options.disambiguationContext.type,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      };
    }
    
    if (options.imageContext) {
      metadata.imageContext = {
        imageId: options.imageContext.imageId,
        analysisResult: options.imageContext.analysisResult,
        imageType: options.imageContext.imageType,
        extractedAt: options.imageContext.extractedAt,
      };
    }

    this.conversationWindow.addMessage(
      phone,
      'user',
      message,
      Object.keys(metadata).length > 0 ? metadata : undefined,
      options.whatsappMessageId,
      options.replyToMessageId
    );

    console.log(`[MemoryService] Added user message for ${phone}`);
  }

  /**
   * Add an assistant message to conversation memory
   * @param phone - User's phone number
   * @param message - Message content
   * @param whatsappMessageId - Optional WhatsApp message ID
   */
  public addAssistantMessage(
    phone: string,
    message: string,
    whatsappMessageId?: string
  ): void {
    this.conversationWindow.addMessage(
      phone,
      'assistant',
      message,
      undefined,
      whatsappMessageId
    );

    console.log(`[MemoryService] Added assistant message for ${phone}`);
  }

  /**
   * Get recent messages in MemoState format (ISO timestamps)
   * @param phone - User's phone number
   * @param limit - Maximum number of messages to return (default: 10)
   * @returns Array of messages in MemoState format
   */
  public getRecentMessages(phone: string, limit: number = 10): MemoStateMessage[] {
    const messages = this.conversationWindow.getContext(phone);
    
    // Convert CW format (timestamp as number) to MemoState format (ISO string)
    const converted = messages.slice(-limit).map((msg): MemoStateMessage => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      timestamp: new Date(msg.timestamp).toISOString(),
      whatsappMessageId: msg.whatsappMessageId,
      replyToMessageId: msg.replyToMessageId,
      metadata: msg.metadata ? this.convertMetadataToMemoState(msg.metadata) : undefined,
    }));

    const userCount = converted.filter(m => m.role === 'user').length;
    const assistantCount = converted.filter(m => m.role === 'assistant').length;
    console.log(`[MemoryService] Retrieved ${converted.length} messages (${userCount} user, ${assistantCount} assistant) for ${phone}`);

    return converted;
  }

  /**
   * Check if a specific user message exists in memory
   * @param phone - User's phone number
   * @param messageContent - Message content to check
   * @param whatsappMessageId - Optional WhatsApp message ID to match
   * @returns True if message exists
   */
  public hasUserMessage(
    phone: string,
    messageContent: string,
    whatsappMessageId?: string
  ): boolean {
    const messages = this.conversationWindow.getContext(phone);
    
    return messages.some(msg => {
      if (msg.role !== 'user') return false;
      if (msg.content !== messageContent) return false;
      if (whatsappMessageId && msg.whatsappMessageId !== whatsappMessageId) return false;
      return true;
    });
  }

  /**
   * Get the last user message in conversation
   * @param phone - User's phone number
   * @returns Last user message or null
   */
  public getLastUserMessage(phone: string): MemoStateMessage | null {
    const messages = this.conversationWindow.getContext(phone);
    
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const msg = messages[i];
        return {
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp).toISOString(),
          whatsappMessageId: msg.whatsappMessageId,
          replyToMessageId: msg.replyToMessageId,
          metadata: msg.metadata ? this.convertMetadataToMemoState(msg.metadata) : undefined,
        };
      }
    }
    
    return null;
  }

  /**
   * Get message that was replied to
   * @param phone - User's phone number
   * @param replyToMessageId - WhatsApp message ID being replied to
   * @returns The replied-to message or null
   */
  public getRepliedToMessage(phone: string, replyToMessageId: string): MemoStateMessage | null {
    const msg = this.conversationWindow.getRepliedToMessage(phone, replyToMessageId);
    if (!msg) return null;

    return {
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
      timestamp: new Date(msg.timestamp).toISOString(),
      whatsappMessageId: msg.whatsappMessageId,
      replyToMessageId: msg.replyToMessageId,
      metadata: msg.metadata ? this.convertMetadataToMemoState(msg.metadata) : undefined,
    };
  }

  // ============================================================================
  // DISAMBIGUATION OPERATIONS
  // ============================================================================

  /**
   * Get active disambiguation context
   * @param phone - User's phone number
   * @returns Disambiguation context or null if none/expired
   */
  public getDisambiguationContext(phone: string): DisambiguationContext | null {
    const metadata = this.conversationWindow.getLastDisambiguationContext(phone);
    if (!metadata?.disambiguationContext) return null;

    const ctx = metadata.disambiguationContext;
    return {
      type: ctx.entityType as DisambiguationContext['type'],
      candidates: ctx.candidates,
      resolverStepId: '', // Will be filled by EntityResolutionNode
      question: undefined,
      allowMultiple: false,
    };
  }

  /**
   * Store disambiguation context
   * @param phone - User's phone number
   * @param context - Disambiguation context to store
   */
  public setDisambiguationContext(
    phone: string,
    context: {
      candidates: Array<{ id: string; displayText: string; [key: string]: any }>;
      entityType: string;
    }
  ): void {
    this.conversationWindow.storeDisambiguationContext(
      phone,
      context.candidates,
      context.entityType
    );
  }

  /**
   * Clear disambiguation context
   * @param phone - User's phone number
   */
  public clearDisambiguationContext(phone: string): void {
    this.conversationWindow.clearDisambiguationContext(phone);
  }

  // ============================================================================
  // IMAGE CONTEXT OPERATIONS
  // ============================================================================

  /**
   * Get the last message with image context
   * @param phone - User's phone number
   * @returns Message with image context or null
   */
  public getLastImageContext(phone: string): ImageContext | null {
    const msg = this.conversationWindow.getLastMessageWithImageContext(phone);
    if (!msg?.metadata?.imageContext) return null;

    const ctx = msg.metadata.imageContext;
    return {
      imageId: ctx.imageId,
      analysisResult: ctx.analysisResult,
      imageType: ctx.imageType,
      extractedAt: ctx.extractedAt,
    };
  }

  // ============================================================================
  // RECENT TASKS OPERATIONS
  // ============================================================================

  /**
   * Push recent tasks to memory
   * @param phone - User's phone number
   * @param tasks - Tasks to store
   * @param options - Options (replace existing or merge)
   */
  public pushRecentTasks(
    phone: string,
    tasks: RecentTaskSnapshot[],
    options: { replace?: boolean } = {}
  ): void {
    this.conversationWindow.pushRecentTasks(phone, tasks, options);
  }

  /**
   * Get recent tasks from memory
   * @param phone - User's phone number
   * @returns Array of recent tasks
   */
  public getRecentTasks(phone: string): RecentTaskSnapshot[] {
    return this.conversationWindow.getRecentTasks(phone);
  }

  /**
   * Clear recent tasks
   * @param phone - User's phone number
   */
  public clearRecentTasks(phone: string): void {
    this.conversationWindow.clearRecentTasks(phone);
  }

  // ============================================================================
  // CONVERSATION MANAGEMENT
  // ============================================================================

  /**
   * Clear all conversation data for a user
   * @param phone - User's phone number
   */
  public clearConversation(phone: string): void {
    this.conversationWindow.clear(phone);
  }

  /**
   * Get conversation statistics
   * @param phone - User's phone number
   */
  public getStats(phone: string): {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    systemMessageCount: number;
    contextMessageCount: number;
    totalTokens: number;
    tokenLimit: number;
    messageLimit: number;
  } {
    return this.conversationWindow.getStats(phone);
  }

  /**
   * Clean up old conversations
   */
  public cleanup(): void {
    this.conversationWindow.cleanup();
  }

  // ============================================================================
  // INTERNAL HELPERS
  // ============================================================================

  /**
   * Convert CW metadata format to MemoState metadata format
   */
  private convertMetadataToMemoState(cwMetadata: CWMessage['metadata']): MemoStateMessage['metadata'] {
    if (!cwMetadata) return undefined;

    const result: MemoStateMessage['metadata'] = {};

    if (cwMetadata.disambiguationContext) {
      result.disambiguationContext = {
        type: cwMetadata.disambiguationContext.entityType as DisambiguationContext['type'],
        candidates: cwMetadata.disambiguationContext.candidates,
        resolverStepId: '',
      };
    }

    if (cwMetadata.imageContext) {
      result.imageContext = {
        imageId: cwMetadata.imageContext.imageId,
        analysisResult: cwMetadata.imageContext.analysisResult,
        imageType: cwMetadata.imageContext.imageType,
        extractedAt: cwMetadata.imageContext.extractedAt,
      };
    }

    if (cwMetadata.recentTasks) {
      result.recentTasks = cwMetadata.recentTasks.tasks.map(t => ({
        id: t.id || '',
        text: t.text,
        updatedAt: cwMetadata.recentTasks!.updatedAt,
      }));
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/**
 * Get the singleton MemoryService instance
 */
export function getMemoryService(): MemoryService {
  return MemoryService.getInstance();
}
