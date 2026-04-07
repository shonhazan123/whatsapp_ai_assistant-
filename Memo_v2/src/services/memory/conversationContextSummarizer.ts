/**
 * LLM rolling summarization for ConversationContextStore (runs synchronously at end of graph).
 *
 * TODO — Redis persistence: If multiple workers exist, run summarization only under a per-user lock
 * (Redis Redlock or SETNX) or enqueue a single-consumer job so two summaries never race on the same key.
 */

import { getNodeModel } from '../../config/llm-config.js';
import { traceLlmReasoningLog } from '../trace/traceLlmReasoningLog.js';
import type { LLMStep } from '../../graph/state/MemoState.js';
import type { ConversationMessage } from '../../types/index.js';

const SYSTEM_PROMPT = `You are summarizing a conversation between a user and Donna (a WhatsApp personal assistant).
The user communicates in Hebrew or English.

Your summary must:
- Describe what was discussed and what actions were taken, in chronological order.
- Explicitly state the MOST RECENT action taken in enough detail that future references like "it", "that", "זה", "אותו" can be resolved correctly.
- Note any unresolved requests or pending items.
- Be concise — aim for 100-150 words maximum.
- Use the same language as the user (match the bulk of the messages being summarized).

The last action taken should always be the final sentence, formatted as:
"הפעולה האחרונה: [description]" or "Last action: [description]"`;

function formatMessagesForPrompt(messages: ConversationMessage[]): string {
  return messages
    .map((m) => `[${m.role}] (${m.timestamp}): ${m.content}`)
    .join('\n');
}

export async function summarizeRollingConversation(params: {
  priorSummary?: string;
  messagesToFold: ConversationMessage[];
  requestId?: string;
}): Promise<{ text: string; llmStep: LLMStep | null }> {
  const { priorSummary, messagesToFold, requestId } = params;
  if (messagesToFold.length === 0) {
    return { text: priorSummary?.trim() || '', llmStep: null };
  }

  const priorBlock =
    priorSummary && priorSummary.trim()
      ? `## Previous summary (merge and update; do not drop important facts)\n${priorSummary.trim()}\n\n`
      : '';

  const userContent = `${priorBlock}## Conversation to summarize (chronological)\n${formatMessagesForPrompt(messagesToFold)}\n\nProduce the new rolling summary only, as plain text.`;

  const modelConfig = getNodeModel('conversationSummarizer');

  const { response, llmStep } = await traceLlmReasoningLog(
    'conversation_summarizer',
    {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      model: modelConfig.model,
      temperature: 0.3,
      maxTokens: 800,
    },
    requestId,
  );

  const text = (response.content || '').trim();
  if (!text) {
    throw new Error('conversation summarizer returned empty content');
  }
  return { text, llmStep };
}
