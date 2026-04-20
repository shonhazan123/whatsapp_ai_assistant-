/**
 * traceHelpers - Pure functions for pipeline trace construction.
 *
 * No DB, no state mutation. Optional debug logging for trace diagnostics.
 * Used by traceLlmReasoningLog and PipelineTraceService.
 */

import { calculateCost } from '../../config/llm-config.js';
import type { LLMStep } from '../../graph/state/MemoState.js';
import type { MemoState } from '../../graph/state/MemoState.js';
import {
	CONVERSATION_RAW_MESSAGE_CAP,
	estimateRecentMessagesTokens,
} from '../memory/ConversationContextStore.js';
import type { LatestAction } from '../../types/index.js';
import { isGuestAuth } from '../../utils/guestUser.js';
import { logger } from '../../utils/logger.js';
import type { LLMUsage } from '../llm/LLMService.js';

// ============================================================================
// TOKEN USAGE EXTRACTION
// ============================================================================

export interface TokenUsage {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Extract token counts from an OpenAI usage object, splitting cached vs non-cached input.
 * Falls back to zero for any missing fields.
 */
export function extractTokenUsage(usage?: LLMUsage): TokenUsage {
  if (!usage) {
    return { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  // Prefer details (OpenAI chat); fall back to alternate shapes if present
  const cachedTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cached_tokens ??
    usage.prompt_tokens_cached ??
    0;

  return {
    cachedInputTokens: cachedTokens,
    inputTokens: promptTokens - cachedTokens,
    outputTokens: completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

// ============================================================================
// LLM STEP BUILDER
// ============================================================================

/**
 * Build a single LLMStep from raw call data.
 * Stores the full input messages and full output for debugging visibility.
 */
export function buildLLMStep(
  node: string,
  model: string,
  tokens: TokenUsage,
  latencyMs: number,
  inputMessages: Array<{ role: string; content: string }>,
  responseContent: string | null,
): LLMStep {
  const cost = calculateCost(
    model,
    tokens.inputTokens + tokens.cachedInputTokens,
    tokens.outputTokens,
    tokens.cachedInputTokens,
  );

  const persistedInput = inputMessages.filter(
    msg => String(msg.role).toLowerCase() !== 'system',
  );
  logger.debug('[traceHelpers] buildLLMStep persisted input messages', {
    node,
    before: inputMessages.length,
    after: persistedInput.length,
  });

  return {
    node,
    model,
    cachedInputTokens: tokens.cachedInputTokens,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
    latencyMs,
    cost,
    input: persistedInput,
    output: responseContent ?? '',
  };
}

// ============================================================================
// AGGREGATE COMPUTATION
// ============================================================================

export interface TraceAggregates {
  totalLlmCalls: number;
  totalCachedInputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  totalDurationMs: number;
}

/**
 * Compute aggregate totals from a list of LLMSteps.
 */
/** True for real LLM calls; false when `countInAggregates` is explicitly set to false (synthetic trace rows). */
export function isLlmStepCountedInAggregates(step: LLMStep): boolean {
  return step.countInAggregates !== false;
}

export function computeAggregates(steps: LLMStep[]): TraceAggregates {
  return steps.filter(isLlmStepCountedInAggregates).reduce<TraceAggregates>(
    (agg, step) => ({
      totalLlmCalls: agg.totalLlmCalls + 1,
      totalCachedInputTokens: agg.totalCachedInputTokens + step.cachedInputTokens,
      totalInputTokens: agg.totalInputTokens + step.inputTokens,
      totalOutputTokens: agg.totalOutputTokens + step.outputTokens,
      totalTokens: agg.totalTokens + step.totalTokens,
      totalCost: agg.totalCost + step.cost,
      totalDurationMs: agg.totalDurationMs + step.latencyMs,
    }),
    {
      totalLlmCalls: 0,
      totalCachedInputTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      totalDurationMs: 0,
    },
  );
}

// ============================================================================
// SYNTHETIC TRACE ROWS
// ============================================================================

/** Pre-planner full snapshot is attached to `reply_context` so the debug UI shows one clean context window there. */
export const CONTEXT_WINDOW_TRACE_NODE = 'reply_context';
export const CONTEXT_WINDOW_TRACE_MODEL = 'debug';

const SECTION_PREVIEW_MAX = 2000;
const MESSAGE_PREFIX_MAX = 500;
const LATEST_ACTIONS_PREVIEW_MAX = 5;

function truncateText(text: string, max: number): string {
	if (!text) return '';
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

const SYNTHETIC_TRACE_OUTPUT =
	'(synthetic trace payload in input[0].content — not an LLM call; excluded from aggregates)';

function formatRecentMessagesSection(state: MemoState): string {
	const recent = state.recentMessages ?? [];
	if (recent.length === 0) return 'None';

	return recent
		.slice(-CONVERSATION_RAW_MESSAGE_CAP)
		.map((message, index) => {
			const body = truncateText(message.content ?? '', MESSAGE_PREFIX_MAX);
			const extras = [
				message.whatsappMessageId ? `whatsappMessageId=${message.whatsappMessageId}` : '',
				message.replyToMessageId ? `replyToMessageId=${message.replyToMessageId}` : '',
			].filter(Boolean).join(', ');
			return `${index + 1}. [${message.role}]${extras ? ` (${extras})` : ''}\n${body}`;
		})
		.join('\n\n');
}

function formatLatestActionsSection(actions: LatestAction[]): string {
	if (!actions || actions.length === 0) return 'None';

	return actions
		.slice(0, LATEST_ACTIONS_PREVIEW_MAX)
		.map((action, index) => {
			const lines = [
				`${index + 1}. capability=${action.capability} | action=${action.action}`,
				`summary: ${truncateText(action.summary ?? '', 300)}`,
			];
			if (action.when) lines.push(`when: ${action.when}`);
			lines.push(`createdAt: ${action.createdAt}`);
			return lines.join('\n');
		})
		.join('\n\n');
}

function buildContextWindowInput(state: MemoState): string {
	const summary = state.conversationContext?.summary ?? state.longTermSummary ?? '';
	const recent = state.recentMessages ?? [];
	const estimatedTailTokens = estimateRecentMessagesTokens(
		recent.slice(-CONVERSATION_RAW_MESSAGE_CAP),
	);

	const sections = [
		'## Context Window',
		`guest=${isGuestAuth(state.authContext)}`,
		`traceId=${state.traceId || ''}`,
		`threadId=${state.threadId || ''}`,
		'',
		'## Last User Message',
		state.input.message || '(empty)',
	];

	if (state.input.enhancedMessage) {
		sections.push('', '## Enhanced User Message', truncateText(state.input.enhancedMessage, SECTION_PREVIEW_MAX));
	}

	sections.push(
		'',
		'## Conversation Summary',
		summary ? truncateText(summary, SECTION_PREVIEW_MAX) : 'None',
		'',
		'## Recent Messages Meta',
		`count=${recent.length}`,
		`estimatedTailTokens=${estimatedTailTokens}`,
		'',
		'## Recent Messages Array',
		formatRecentMessagesSection(state),
		'',
		'## Last Executions',
		formatLatestActionsSection(state.latestActions ?? []),
	);

	return sections.join('\n');
}

/** Single synthetic trace row: one clean, human-readable context window under `reply_context`. */
export function buildContextWindowSnapshotStep(state: MemoState): LLMStep {
	return {
		node: CONTEXT_WINDOW_TRACE_NODE,
		model: CONTEXT_WINDOW_TRACE_MODEL,
		cachedInputTokens: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		latencyMs: 0,
		cost: 0,
		input: [{ role: 'user', content: buildContextWindowInput(state) }],
		output: SYNTHETIC_TRACE_OUTPUT,
		countInAggregates: false,
	};
}

// ============================================================================
// TRACE ROW BUILDER (ready for DB INSERT)
// ============================================================================

export interface PipelineTraceRow {
  trace_id: string;
  thread_id: string;
  user_phone: string;
  user_message: string;
  trigger_type: string;
  llm_steps: string;
  node_executions: string;
  total_llm_calls: number;
  total_cached_input_tokens: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost: number;
  total_duration_ms: number;
  final_response: string | null;
  completed: boolean;
  interrupted: boolean;
  error: string | null;
}

/**
 * Build a complete DB row from MemoState, ready for INSERT.
 * All per-call detail lives inside llm_steps -- no pre-named pipeline columns.
 */
export function buildTraceRow(state: MemoState): PipelineTraceRow {
  const aggregates = computeAggregates(state.llmSteps);

  return {
    trace_id: state.traceId,
    thread_id: state.threadId,
    user_phone: state.input.userPhone || state.user.phone,
    user_message: state.input.message,
    trigger_type: state.input.triggerType || 'user',
    llm_steps: JSON.stringify(state.llmSteps),
    node_executions: JSON.stringify(state.metadata.nodeExecutions),
    total_llm_calls: aggregates.totalLlmCalls,
    total_cached_input_tokens: aggregates.totalCachedInputTokens,
    total_input_tokens: aggregates.totalInputTokens,
    total_output_tokens: aggregates.totalOutputTokens,
    total_tokens: aggregates.totalTokens,
    total_cost: aggregates.totalCost,
    total_duration_ms: aggregates.totalDurationMs,
    final_response: state.finalResponse || null,
    completed: !state.error && !state.pendingHITL,
    interrupted: !!state.pendingHITL,
    error: state.error || null,
  };
}
