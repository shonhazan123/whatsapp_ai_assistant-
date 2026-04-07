/**
 * PipelineTraceService - Thin DB layer for pipeline trace persistence.
 *
 * Single method: flush(state) → INSERT into pipeline_traces.
 * Called fire-and-forget after graph completion in invokeMemoGraph.
 */

import { query } from '../../legacy/config/database.js';
import type { MemoState } from '../../graph/state/MemoState.js';
import { buildTraceRow } from './traceHelpers.js';

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

    await query(
      `INSERT INTO pipeline_traces (
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
        error            = EXCLUDED.error`,
      [
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
      ],
    );
  }
}
