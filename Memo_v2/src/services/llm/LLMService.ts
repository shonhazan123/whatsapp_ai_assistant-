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
      const openAIModule = require('../../../../src/services/ai/OpenAIService');
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

    // Handle function calls (old format)
    if (message.function_call) {
      return {
        content: null,
        functionCall: {
          name: message.function_call.name,
          arguments: message.function_call.arguments,
        },
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
      };
    }

    // Regular text response
    return {
      content: message.content || null,
    };
  } catch (error: any) {
    console.error('[LLMService] Error calling LLM:', error);
    throw error;
  }
}

/**
 * Try to fix malformed JSON by extracting JSON from text
 * Based on V1's OpenAIFunctionHelper.tryFixJson
 */
function tryFixJson(raw: string): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Attempt to extract JSON from text
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (parseError) {
        console.error('[LLMService] Failed to parse extracted JSON:', parseError);
        throw new Error('Could not extract valid JSON from response');
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

