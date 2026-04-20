/**
 * traceLlmReasoningLog - THE single entry point nodes call for traced LLM requests.
 *
 * Wraps callLLM / callLLMJSON, measures latency, extracts token usage,
 * and returns both the original response and a ready-to-accumulate LLMStep.
 *
 * The caller provides a dynamic `nodeName` (e.g. "planner", "resolver:calendar",
 * "hitl:clarify") -- no pre-configured names in the DB or here.
 *
 * Usage in a node:
 *   const { response, llmStep } = await traceLlmReasoningLog('planner', request);
 *   return { ..., llmSteps: [llmStep] };
 */

import type { LLMStep } from '../../graph/state/MemoState.js';
import {
  callLLM,
  callLLMJSONWithUsage,
  type LLMRequest,
  type LLMResponse,
} from '../llm/LLMService.js';
import { buildLLMStep, extractTokenUsage } from './traceHelpers.js';

// ============================================================================
// RETURN TYPES
// ============================================================================

export interface TraceResult<T = LLMResponse> {
  response: T;
  llmStep: LLMStep;
}

// ============================================================================
// TEXT RESPONSE (callLLM wrapper)
// ============================================================================

/**
 * Traced LLM call returning the raw LLMResponse + an LLMStep for accumulation.
 * @param nodeName - caller-chosen label for this call (stored as-is in the trace)
 */
export async function traceLlmReasoningLog(
  nodeName: string,
  request: LLMRequest,
  requestId?: string,
): Promise<TraceResult<LLMResponse>> {
  const startTime = Date.now();

  const response = await callLLM(request, requestId);

  const latencyMs = Date.now() - startTime;
  const tokens = extractTokenUsage(response.usage);
  const model = request.model || 'gpt-4o-mini';

  const llmStep = buildLLMStep(
    nodeName,
    model,
    tokens,
    latencyMs,
    request.messages,
    response.content,
  );

  return { response, llmStep };
}

// ============================================================================
// JSON RESPONSE (callLLMJSON wrapper)
// ============================================================================

/**
 * Traced LLM call that parses the response as JSON and returns parsed + LLMStep.
 * @param nodeName - caller-chosen label for this call (stored as-is in the trace)
 */
export async function traceLlmReasoningLogJSON<T>(
  nodeName: string,
  request: LLMRequest,
  requestId?: string,
): Promise<TraceResult<T>> {
  const startTime = Date.now();

  const { parsed, usage } = await callLLMJSONWithUsage<T>(request, requestId);

  const latencyMs = Date.now() - startTime;
  const tokens = extractTokenUsage(usage);
  const model = request.model || 'gpt-4o-mini';

  const llmStep = buildLLMStep(
    nodeName,
    model,
    tokens,
    latencyMs,
    request.messages,
    typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
  );

  return { response: parsed, llmStep };
}
