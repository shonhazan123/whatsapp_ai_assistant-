/**
 * TokenService - Global token counting service backed by gpt-tokenizer.
 *
 * Single source of truth for BPE token counting across the codebase.
 * Replaces all DIY `content.length / N` approximations.
 */

import { encode, isWithinTokenLimit } from 'gpt-tokenizer';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class TokenService {
  private static instance: TokenService;

  private constructor() {}

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService();
    }
    return TokenService.instance;
  }

  /**
   * Count BPE tokens in a plain text string.
   */
  countTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    return encode(text).length;
  }

  /**
   * Check whether text fits within a token budget.
   * Returns the actual token count if within limit, or `false` if exceeded.
   */
  isWithinLimit(text: string, limit: number): number | false {
    if (!text || text.length === 0) return 0;
    return isWithinTokenLimit(text, limit);
  }

  /**
   * Sum token counts across an array of chat messages.
   * Counts content tokens only (no chat-framing overhead).
   * For rough context-window budgeting this is sufficient.
   */
  countChatTokens(messages: ChatMessage[]): number {
    let total = 0;
    for (const msg of messages) {
      if (msg.content) {
        total += encode(msg.content).length;
      }
    }
    return total;
  }
}

export function getTokenService(): TokenService {
  return TokenService.getInstance();
}
