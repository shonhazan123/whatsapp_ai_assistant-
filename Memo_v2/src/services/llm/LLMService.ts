/**
 * LLMService
 * 
 * Service for making LLM calls in Memo V2.
 * Uses V1's OpenAIService for actual API calls.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

let _OpenAIService: any;
let _logger: any;

/**
 * Get V1 OpenAIService instance
 */
function getOpenAIService(): any {
  if (!_OpenAIService) {
    try {
      // Get logger first from Memo_v2
      // Path: From Memo_v2/src/services/llm/ to Memo_v2/src/utils/logger
      if (!_logger) {
        const loggerModule = require('../../utils/logger');
        _logger = loggerModule.logger;
      }

      // Get OpenAIService
      // Path calculation: From Memo_v2/dist/services/llm/ to workspace root src/services/ai/OpenAIService
      const openAIModule = require('../../legacy/services/ai/OpenAIService');
      _OpenAIService = new openAIModule.OpenAIService(_logger);
    } catch (error) {
      console.error('[LLMService] Failed to load OpenAIService:', error);
      console.error('[LLMService] Error details:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && 'stack' in error) {
        console.error('[LLMService] Stack:', error.stack);
      }
      return null;
    }
  }
  return _OpenAIService;
}

export interface LLMRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Note: responseFormat is not used - we rely on function calling or prompt-based JSON
  functions?: any[];
  functionCall?: 'auto' | 'none' | { name: string };
  tools?: any[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Some API responses expose cache hits here instead of details */
  cached_tokens?: number;
  prompt_tokens_cached?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_creation_tokens?: number;
  };
}

export interface LLMResponse {
  content: string | null;
  functionCall?: {
    name: string;
    arguments: string;
  };
  toolCalls?: Array<{
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: LLMUsage;
}

/**
 * Call LLM with messages
 */
export async function callLLM(
  request: LLMRequest,
  requestId?: string
): Promise<LLMResponse> {
  const openaiService = getOpenAIService();

  if (!openaiService) {
    throw new Error('OpenAIService not available');
  }

  try {
    // Convert to V1 format
    // V1's OpenAIService handles tools/functions conversion automatically
    const v1Request: any = {
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    };

    // Add functions or tools (V1 will convert based on model)
    if (request.tools) {
      v1Request.tools = request.tools;
    } else if (request.functions) {
      v1Request.functions = request.functions;
    }

    // Add function call or tool choice
    if (request.toolChoice) {
      v1Request.tool_choice = request.toolChoice;
    } else if (request.functionCall) {
      v1Request.functionCall = request.functionCall;
    }

    const response = await openaiService.createCompletion(v1Request, requestId);

    // Extract content or function call
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error('No message in LLM response');
    }

    const message = choice.message;
    const usage: LLMUsage | undefined = (response as any).usage;
    if (usage && process.env.DEBUG_LLM_USAGE === 'true') {
      console.log('[LLMService] Raw usage:', JSON.stringify(usage));
    }

    // Handle function calls (old format)
    if (message.function_call) {
      return {
        content: null,
        functionCall: {
          name: message.function_call.name,
          arguments: message.function_call.arguments,
        },
        usage,
      };
    }

    // Handle tool calls (new format)
    if (message.tool_calls && message.tool_calls.length > 0) {
      return {
        content: message.content || null,
        toolCalls: message.tool_calls.map((tc: any) => ({
          id: tc.id,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        usage,
      };
    }

    // Regular text response
    return {
      content: message.content || null,
      usage,
    };
  } catch (error: any) {
    console.error('[LLMService] Error calling LLM:', error);
    throw error;
  }
}

/**
 * Try to repair JSON with common LLM issues (e.g. unescaped " inside string values like Hebrew י"ב).
 * Escapes a double-quote that sits between two word characters (letters/digits, including Hebrew).
 */
function repairJsonStringQuotes(jsonStr: string): string {
  // Match " that is between two word-like chars (letter, digit, underscore, Hebrew block) — not key/value boundaries
  return jsonStr.replace(
    /([\p{L}\p{N}\s_])"([\p{L}\p{N}_])/gu,
    '$1\\"$2'
  );
}

/**
 * LLMs sometimes emit JavaScript in JSON values, e.g. "reminderMinutesBefore": 24 * 60.
 * Replace `:<ws><int><ws>*<ws><int>` with the computed product.
 */
function repairJsonMultiplicationLiterals(jsonStr: string): string {
  return jsonStr.replace(/:\s*(\d+)\s*\*\s*(\d+)/g, (_m, a, b) => {
    const product = Number(a) * Number(b);
    return `: ${String(product)}`;
  });
}

/**
 * Try to fix malformed JSON by extracting JSON from text and repairing common issues.
 * Based on V1's OpenAIFunctionHelper.tryFixJson.
 * Repairs unescaped double-quotes inside string values (e.g. Hebrew gershayim י"ב).
 */
function tryFixJson(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    try {
      return JSON.parse(repairJsonMultiplicationLiterals(trimmed));
    } catch {
      // continue with extraction / quote repair
    }
    // Attempt to extract JSON from text
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let extracted = jsonMatch[0];
      try {
        return JSON.parse(extracted);
      } catch (parseError) {
        // Try repairing unescaped quotes inside string values (e.g. Hebrew י"ב)
        try {
          extracted = repairJsonStringQuotes(extracted);
          extracted = repairJsonMultiplicationLiterals(extracted);
          return JSON.parse(extracted);
        } catch (repairError) {
          try {
            extracted = repairJsonMultiplicationLiterals(jsonMatch[0]);
            extracted = repairJsonStringQuotes(extracted);
            return JSON.parse(extracted);
          } catch {
            console.error('[LLMService] Failed to parse extracted JSON:', parseError);
            throw new Error('Could not extract valid JSON from response');
          }
        }
      }
    }
    throw error;
  }
}

/**
 * Call LLM and parse JSON response
 * 
 * For JSON responses, we don't use response_format (not supported by all models).
 * Instead, we:
 * 1. Ask the model to return JSON in the prompt (already in system/user messages)
 * 2. Parse the response, with fallback JSON extraction if needed
 */
export async function callLLMJSON<T>(
  request: LLMRequest,
  requestId?: string
): Promise<T> {
  const response = await callLLM(request, requestId);

  if (!response.content) {
    throw new Error('No content in LLM JSON response');
  }

  try {
    // Try direct JSON parse first
    return JSON.parse(response.content) as T;
  } catch (error) {
    // Fallback: try to extract JSON from text (handles cases where model adds extra text)
    console.warn('[LLMService] Direct JSON parse failed, attempting extraction');
    try {
      return tryFixJson(response.content) as T;
    } catch (extractError) {
      console.error('[LLMService] Failed to parse JSON response:', response.content);
      throw new Error(`Invalid JSON response from LLM: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
    }
  }
}

export interface LLMJSONResult<T> {
  parsed: T;
  usage?: LLMUsage;
}

/**
 * Call LLM, parse JSON, and return both parsed result and raw usage data.
 * Used by traceLlmReasoningLog to capture token metrics.
 */
export async function callLLMJSONWithUsage<T>(
  request: LLMRequest,
  requestId?: string
): Promise<LLMJSONResult<T>> {
  const response = await callLLM(request, requestId);

  if (!response.content) {
    throw new Error('No content in LLM JSON response');
  }

  let parsed: T;
  try {
    parsed = JSON.parse(response.content) as T;
  } catch {
    console.warn('[LLMService] Direct JSON parse failed, attempting extraction');
    try {
      parsed = tryFixJson(response.content) as T;
    } catch (extractError) {
      console.error('[LLMService] Failed to parse JSON response:', response.content);
      throw new Error(`Invalid JSON response from LLM: ${extractError instanceof Error ? extractError.message : String(extractError)}`);
    }
  }

  return { parsed, usage: response.usage };
}

