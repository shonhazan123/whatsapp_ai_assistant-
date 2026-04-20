/**
 * In-process rolling conversation buffer + summary per registered user (key = users.id).
 *
 * TODO — Redis persistence: Replace this Map with Redis (e.g. JSON per key `conversation_context:{userId}`,
 * or HASH fields summary + recent_messages), add TTL/eviction, and hydrate on cold start. Invalidate on
 * account deletion. Ensure single-writer semantics per user if multiple app instances run summarization.
 */

import type { ConversationContext, ConversationMessage } from '../../types/index.js';

/** Max completed messages (user + assistant lines) in the rolling buffer before summarization runs. */
export const CONVERSATION_RAW_MESSAGE_CAP = 10;

/** Max estimated tokens over raw recent messages (summary not counted). */
export const CONVERSATION_RAW_TOKEN_CAP = 500;

/**
 * After summarization only: keep this many most-recent completed messages.
 * Between summarizations the buffer may grow from 3 up to CONVERSATION_RAW_MESSAGE_CAP (until caps trigger).
 */
export const CONVERSATION_KEEP_RAW_MESSAGES = 3;

const CHARS_PER_TOKEN = 4;

export function estimateRecentMessagesTokens(messages: ConversationMessage[]): number {
  return messages.reduce((t, m) => t + Math.ceil((m.content || '').length / CHARS_PER_TOKEN), 0);
}

interface InternalEntry {
  summary?: string;
  recentMessages: ConversationMessage[];
}

export class ConversationContextStore {
  private static instance: ConversationContextStore;
  private readonly byUserId = new Map<string, InternalEntry>();

  private constructor() {}

  static getInstance(): ConversationContextStore {
    if (!ConversationContextStore.instance) {
      ConversationContextStore.instance = new ConversationContextStore();
    }
    return ConversationContextStore.instance;
  }

  /**
   * TODO — Redis persistence: GET conversation_context:{userId} and deserialize.
   */
  getInternal(userId: string): InternalEntry {
    const existing = this.byUserId.get(userId);
    if (existing) {
      return {
        summary: existing.summary,
        recentMessages: [...existing.recentMessages],
      };
    }
    return { recentMessages: [] };
  }

  /**
   * TODO — Redis persistence: SET with same shape (or merge fields).
   */
  setInternal(userId: string, entry: InternalEntry): void {
    this.byUserId.set(userId, {
      summary: entry.summary,
      recentMessages: [...entry.recentMessages],
    });
  }

  /**
   * Full rolling buffer for this turn: optional summary + all stored completed messages (up to cap before summarize).
   * Trimming to CONVERSATION_KEEP_RAW_MESSAGES happens only in MemoryUpdateNode after summarization LLM runs.
   *
   * TODO — Redis persistence: read-through cache after Redis GET.
   */
  getForPlanner(userId: string): ConversationContext {
    const { summary, recentMessages } = this.getInternal(userId);
    return {
      ...(summary !== undefined && summary !== '' ? { summary } : {}),
      recentMessages: [...recentMessages],
    };
  }

  /**
   * Append a completed user + assistant pair after a turn.
   *
   * TODO — Redis persistence: APPEND or read-modify-write JSON array under lock.
   */
  appendCompletedTurn(
    userId: string,
    userMsg: ConversationMessage,
    assistantMsg: ConversationMessage
  ): void {
    const cur = this.getInternal(userId);
    cur.recentMessages.push(userMsg, assistantMsg);
    this.setInternal(userId, cur);
  }

  /**
   * Replace buffer after summarization (typically last 3 + new summary).
   *
   * TODO — Redis persistence: atomic SET.
   */
  applySummarizationResult(userId: string, summary: string, keptMessages: ConversationMessage[]): void {
    this.setInternal(userId, { summary, recentMessages: [...keptMessages] });
  }

  /** Test / admin: clear one user. TODO — Redis: DEL key. */
  clearUser(userId: string): void {
    this.byUserId.delete(userId);
  }
}

export function getConversationContextStore(): ConversationContextStore {
  return ConversationContextStore.getInstance();
}
