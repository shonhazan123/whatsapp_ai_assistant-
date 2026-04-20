/**
 * PipelineTraceService - Thin DB layer for pipeline trace persistence.
 *
 * flush(state) → INSERT into pipeline_traces (graph runs).
 * flushMinimal(...) → same table for standalone LLM steps (e.g. image-only path).
 */

import { query } from '../../legacy/config/database.js';
import type { LLMStep } from '../../graph/state/MemoState.js';
import type { MemoState } from '../../graph/state/MemoState.js';
import { buildTraceRow, computeAggregates, type PipelineTraceRow } from './traceHelpers.js';

const INSERT_PIPELINE_TRACE_SQL = `INSERT INTO pipeline_traces (
        trace_id, thread_id, user_phone, user_message, trigger_type,
        llm_steps, node_executions,
        total_llm_calls, total_cached_input_tokens, total_input_tokens,
        total_output_tokens, total_tokens, total_cost, total_duration_ms,
        final_response, completed, interrupted, error
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18
      )
      ON CONFLICT (trace_id) DO UPDATE SET
        llm_steps        = EXCLUDED.llm_steps,
        node_executions  = EXCLUDED.node_executions,
        total_llm_calls           = EXCLUDED.total_llm_calls,
        total_cached_input_tokens = EXCLUDED.total_cached_input_tokens,
        total_input_tokens        = EXCLUDED.total_input_tokens,
        total_output_tokens       = EXCLUDED.total_output_tokens,
        total_tokens              = EXCLUDED.total_tokens,
        total_cost                = EXCLUDED.total_cost,
        total_duration_ms         = EXCLUDED.total_duration_ms,
        final_response   = EXCLUDED.final_response,
        completed        = EXCLUDED.completed,
        interrupted      = EXCLUDED.interrupted,
        error            = EXCLUDED.error`;

function rowToParams(row: PipelineTraceRow): unknown[] {
  return [
    row.trace_id,
    row.thread_id,
    row.user_phone,
    row.user_message,
    row.trigger_type,
    row.llm_steps,
    row.node_executions,
    row.total_llm_calls,
    row.total_cached_input_tokens,
    row.total_input_tokens,
    row.total_output_tokens,
    row.total_tokens,
    row.total_cost,
    row.total_duration_ms,
    row.final_response,
    row.completed,
    row.interrupted,
    row.error,
  ];
}

export interface MinimalPipelineTraceInput {
  traceId: string;
  threadId: string;
  userPhone: string;
  userMessage: string;
  triggerType: string;
  llmSteps: LLMStep[];
  finalResponse: string | null;
  completed?: boolean;
  interrupted?: boolean;
  error?: string | null;
}

export class PipelineTraceService {
  /**
   * Persist the full pipeline trace from final graph state.
   * Designed to be called fire-and-forget (non-blocking).
   */
  static async flush(state: MemoState): Promise<void> {
    if (!state.traceId) {
      console.warn('[PipelineTrace] No traceId — skipping flush');
      return;
    }

    const row = buildTraceRow(state);
    await query(INSERT_PIPELINE_TRACE_SQL, rowToParams(row));
  }

  /**
   * Persist a minimal trace row (e.g. image analysis without a graph run).
   */
  static async flushMinimal(input: MinimalPipelineTraceInput): Promise<void> {
    const aggregates = computeAggregates(input.llmSteps);
    const row: PipelineTraceRow = {
      trace_id: input.traceId,
      thread_id: input.threadId,
      user_phone: input.userPhone,
      user_message: input.userMessage,
      trigger_type: input.triggerType,
      llm_steps: JSON.stringify(input.llmSteps),
      node_executions: JSON.stringify([]),
      total_llm_calls: aggregates.totalLlmCalls,
      total_cached_input_tokens: aggregates.totalCachedInputTokens,
      total_input_tokens: aggregates.totalInputTokens,
      total_output_tokens: aggregates.totalOutputTokens,
      total_tokens: aggregates.totalTokens,
      total_cost: aggregates.totalCost,
      total_duration_ms: aggregates.totalDurationMs,
      final_response: input.finalResponse,
      completed: input.completed ?? true,
      interrupted: input.interrupted ?? false,
      error: input.error ?? null,
    };
    await query(INSERT_PIPELINE_TRACE_SQL, rowToParams(row));
  }
}
