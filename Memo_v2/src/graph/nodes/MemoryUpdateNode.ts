/**
 * MemoryUpdateNode
 * 
 * Updates conversation memory at the end of each interaction.
 * 
 * Based on V1: ConversationWindow (in-memory) + conversation_memory (Supabase)
 * 
 * Responsibilities:
 * - Add user message to recentMessages
 * - Add assistant response to recentMessages
 * - Enforce memory limits (max messages, max tokens)
 * - Optionally update long-term memory summary
 */

import type { ConversationMessage } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// MEMORY LIMITS
// ============================================================================

const MAX_RECENT_MESSAGES = 10;
const MAX_TOKENS_ESTIMATE = 500; // Rough estimate, not exact
const CHARS_PER_TOKEN = 4; // Rough approximation

// ============================================================================
// MEMORY UTILITIES
// ============================================================================

/**
 * Estimate token count from string length
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Calculate total tokens in messages
 */
function calculateTotalTokens(messages: ConversationMessage[]): number {
  return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
}

/**
 * Enforce memory limits on messages array
 */
function enforceMemoryLimits(
  messages: ConversationMessage[],
  maxMessages: number,
  maxTokens: number
): ConversationMessage[] {
  let result = [...messages];
  
  // Limit by message count first
  if (result.length > maxMessages) {
    result = result.slice(-maxMessages);
  }
  
  // Then limit by tokens
  while (calculateTotalTokens(result) > maxTokens && result.length > 1) {
    result = result.slice(1);
  }
  
  return result;
}

// ============================================================================
// MEMORY UPDATE NODE
// ============================================================================

export class MemoryUpdateNode extends CodeNode {
  readonly name = 'memory_update';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const userMessage = state.input.message;
    const enhancedMessage = state.input.enhancedMessage;
    const assistantResponse = state.finalResponse;
    const now = Date.now();
    
    console.log('[MemoryUpdate] Updating conversation memory');
    
    // Build new messages to add
    const newMessages: ConversationMessage[] = [];
    
    // Add user message
    if (userMessage) {
      newMessages.push({
        role: 'user',
        content: enhancedMessage || userMessage,
        timestamp: now - 1000, // Slightly before assistant response
        whatsappMessageId: state.input.whatsappMessageId,
        replyToMessageId: state.input.replyToMessageId,
        metadata: {
          disambiguationContext: state.disambiguation,
          imageContext: state.input.imageContext,
        },
      });
    }
    
    // Add assistant response
    if (assistantResponse) {
      newMessages.push({
        role: 'assistant',
        content: assistantResponse,
        timestamp: now,
      });
    }
    
    // Merge with existing messages
    const allMessages = [...state.recentMessages, ...newMessages];
    
    // Enforce limits
    const trimmedMessages = enforceMemoryLimits(
      allMessages,
      MAX_RECENT_MESSAGES,
      MAX_TOKENS_ESTIMATE
    );
    
    console.log(`[MemoryUpdate] ${allMessages.length} messages → ${trimmedMessages.length} after limits`);
    
    // Update long-term summary if needed
    // This would typically involve an LLM call to summarize older messages
    // For now, we just pass through the existing summary
    const shouldUpdateSummary = this.shouldUpdateLongTermSummary(state);
    let longTermSummary = state.longTermSummary;
    
    if (shouldUpdateSummary) {
      console.log('[MemoryUpdate] Long-term summary update triggered (not implemented)');
      // TODO: Implement summary update with LLM
      // longTermSummary = await this.generateSummary(trimmedMessages);
    }
    
    // Update execution metadata
    const metadata = {
      ...state.metadata,
      nodeExecutions: [
        ...state.metadata.nodeExecutions,
        {
          node: this.name,
          startTime: now,
          endTime: Date.now(),
          durationMs: Date.now() - now,
        },
      ],
    };
    
    return {
      recentMessages: trimmedMessages,
      longTermSummary,
      metadata,
    };
  }
  
  /**
   * Determine if long-term summary should be updated
   */
  private shouldUpdateLongTermSummary(state: MemoState): boolean {
    // Update summary periodically or when significant events occur
    
    // Check if we've had many messages since last summary
    const messageCount = state.recentMessages.length;
    if (messageCount >= MAX_RECENT_MESSAGES - 2) {
      return true;
    }
    
    // Check if significant operations occurred
    const significantOps = ['create', 'update', 'delete', 'complete'];
    const hasSignificantOp = state.plannerOutput?.plan.some(step =>
      significantOps.some(op => step.action.includes(op))
    );
    
    if (hasSignificantOp && messageCount > 5) {
      return true;
    }
    
    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createMemoryUpdateNode() {
  const node = new MemoryUpdateNode();
  return node.asNodeFunction();
}

// Export utilities for use in MemoState reducers
export { calculateTotalTokens, enforceMemoryLimits, estimateTokens };


