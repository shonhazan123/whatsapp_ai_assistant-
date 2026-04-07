/**
 * traceHelpers - Pure functions for pipeline trace construction.
 *
 * No I/O, no DB, no state mutation.
 * Used by traceLlmReasoningLog and PipelineTraceService.
 */

import { calculateCost } from '../../config/llm-config.js';
import type { LLMStep } from '../../graph/state/MemoState.js';
import type { LLMUsage } from '../llm/LLMService.js';
import type { MemoState } from '../../graph/state/MemoState.js';

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
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;

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

  return {
    node,
    model,
    cachedInputTokens: tokens.cachedInputTokens,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
    latencyMs,
    cost,
    input: inputMessages,
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
export function computeAggregates(steps: LLMStep[]): TraceAggregates {
  return steps.reduce<TraceAggregates>(
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
