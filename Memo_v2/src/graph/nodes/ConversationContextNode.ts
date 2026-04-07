/**
 * Loads rolling conversation summary + last completed messages for the planner and reply context.
 *
 * TODO — Redis persistence: Replace ConversationContextStore backing with Redis; this node stays a
 * thin read-through (GET per request) with the same state shape.
 */

import { getConversationContextStore } from '../../services/memory/ConversationContextStore.js';
import { isGuestAuth } from '../../utils/guestUser.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

export class ConversationContextNode extends CodeNode {
  readonly name = 'conversation_context';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const auth = state.authContext;
    if (isGuestAuth(auth)) {
      return {
        conversationContext: { recentMessages: [] },
        recentMessages: [],
        longTermSummary: undefined,
      };
    }

    const userId = auth!.userRecord.id;
    const store = getConversationContextStore();
    const ctx = store.getForPlanner(userId);

    return {
      conversationContext: ctx,
      recentMessages: ctx.recentMessages,
      longTermSummary: ctx.summary,
    };
  }
}

export function createConversationContextNode() {
  const node = new ConversationContextNode();
  return node.asNodeFunction();
}
