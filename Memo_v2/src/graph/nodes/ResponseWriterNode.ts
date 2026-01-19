/**
 * ResponseWriterNode
 * 
 * Generates the final user-facing message from formatted data.
 * 
 * According to BLUEPRINT.md section 10.2:
 * - For general responses (capability = 'general'): Use data.response directly (already LLM-generated)
 * - For function call results: Use LLM with ResponseFormatterPrompt
 * - Templates only for simple fallback cases
 * - For failed operations: Use LLM to generate contextual error explanations
 * 
 * Responsibilities:
 * - Use LLM with ResponseFormatterPrompt for function call results
 * - Pass through general responses (already LLM-generated)
 * - Ensure Memo speaks (not the capabilities)
 * - Handle Hebrew/English language differences
 * - Generate contextual error explanations for failed operations
 */

import { getNodeModel } from '../../config/llm-config.js';
import { callLLM } from '../../services/llm/LLMService.js';
import type { FailedOperationContext } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// Import V1 ResponseFormatterPrompt
let ResponseFormatterPrompt: any;
try {
  // Path: From Memo_v2/dist/graph/nodes/ to workspace root src/config/response-formatter-prompt
  // Up 4 levels: nodes/ -> graph/ -> dist/ -> Memo_v2/ -> workspace root
  const promptModule = require('../../../../src/config/response-formatter-prompt');
  ResponseFormatterPrompt = promptModule.ResponseFormatterPrompt;
} catch (error) {
  console.error('[ResponseWriterNode] Failed to load ResponseFormatterPrompt:', error);
}

// ============================================================================
// ERROR EXPLANATION PROMPT
// ============================================================================

const ERROR_EXPLAINER_SYSTEM_PROMPT = `You explain operation failures to users in simple, friendly language.

You will receive information about a failed operation:
- capability: What system was used (calendar, database, gmail, etc.)
- operation: What was attempted (delete, update, find, create, etc.)
- searchedFor: What was being looked for (if applicable)
- userRequest: What the user originally asked
- errorMessage: The technical error

Your task:
1. Generate a SHORT, friendly explanation in the user's language (Hebrew or English based on userRequest)
2. Explain what you tried to do and what went wrong
3. Do NOT suggest alternatives or ask follow-up questions
4. Just explain what happened in 1-2 sentences

Examples:
- User asked to delete "buy groceries" but task not found:
  HE: "ניסיתי למחוק את המשימה 'לקנות מצרכים' אבל לא מצאתי משימה כזו."
  EN: "I tried to delete 'buy groceries' but couldn't find that task."

- User asked to update meeting but event not found:
  HE: "חיפשתי אירוע בשם 'פגישה' כדי לעדכן אותו, אבל לא מצאתי התאמה."
  EN: "I looked for an event called 'meeting' to update it, but didn't find a match."

- General operation failure:
  HE: "ניסיתי לבצע את הבקשה אבל משהו לא הצליח."
  EN: "I tried to complete your request but something didn't work out."

Output ONLY the explanation message in the appropriate language, nothing else.`;

// ============================================================================
// RESPONSE WRITER NODE
// ============================================================================

export class ResponseWriterNode extends CodeNode {
  readonly name = 'response_writer';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    // If finalResponse is already set (e.g., from CapabilityCheckNode), use it directly
    if (state.finalResponse) {
      console.log('[ResponseWriter] finalResponse already set, using it directly');
      return {
        finalResponse: state.finalResponse,
      };
    }

    const formattedResponse = state.formattedResponse;
    const language = state.user.language === 'he' ? 'he' : 'en';
    const requestId = (state.input as any).requestId;

    // Handle errors - but try to generate contextual explanation if possible
    if (state.error && !formattedResponse?.failedOperations?.length) {
      console.log('[ResponseWriter] Writing error response (no context available)');
      const errorMessage = language === 'he'
        ? '❌ משהו השתבש. נסה שוב בבקשה.'
        : '❌ Something went wrong. Please try again.';
      return {
        finalResponse: errorMessage,
      };
    }

    // Handle missing formatted response
    if (!formattedResponse) {
      console.log('[ResponseWriter] No formatted response, using fallback');
      const fallbackMessage = language === 'he'
        ? 'לא הבנתי. אפשר לנסח אחרת?'
        : "I didn't understand. Could you rephrase?";
      return {
        finalResponse: fallbackMessage,
      };
    }

    console.log(`[ResponseWriter] Generating response for ${formattedResponse.agent}:${formattedResponse.operation}`);

    // Check for failed operations that need contextual explanation
    const hasFailures = formattedResponse.failedOperations && formattedResponse.failedOperations.length > 0;
    const hasSuccesses = formattedResponse.formattedData &&
      (Array.isArray(formattedResponse.formattedData) ? formattedResponse.formattedData.length > 0 : true);

    // Handle complete failure (only failures, no successes)
    if (hasFailures && !hasSuccesses) {
      console.log(`[ResponseWriter] All operations failed (${formattedResponse.failedOperations!.length} failures), generating contextual explanation`);
      const errorExplanation = await this.generateErrorExplanation(formattedResponse.failedOperations!, language, requestId);
      return {
        finalResponse: errorExplanation,
      };
    }

    // Handle partial failure (some success + some failure)
    if (hasFailures && hasSuccesses) {
      console.log(`[ResponseWriter] Partial failure detected, generating combined response`);

      // First generate success response
      const successResponse = await this.generateSuccessResponse(formattedResponse, language, requestId);

      // Then generate failure explanation
      const failureExplanation = await this.generateErrorExplanation(formattedResponse.failedOperations!, language, requestId);

      // Combine them
      const separator = language === 'he' ? '\n\nלצערי, ' : '\n\nHowever, ';
      return {
        finalResponse: successResponse + separator + failureExplanation.toLowerCase(),
      };
    }

    // For general responses (capability = 'general'), use data.response directly
    // GeneralResolver already generated the LLM response and put it in data.response
    if (formattedResponse.agent === 'general') {
      console.log('[ResponseWriter] Using general response directly (already LLM-generated)');
      const generalData = Array.isArray(formattedResponse.formattedData)
        ? formattedResponse.formattedData[0]
        : formattedResponse.formattedData;

      const response = generalData?.response || generalData?.text || generalData?.message;

      if (response) {
        return {
          finalResponse: response,
        };
      }

      // Fallback if response not found
      console.warn('[ResponseWriter] General response data missing response field');
      const fallbackMessage = language === 'he'
        ? 'לא הבנתי. אפשר לנסח אחרת?'
        : "I didn't understand. Could you rephrase?";
      return {
        finalResponse: fallbackMessage,
      };
    }

    // For function call results (calendar, database, gmail, second-brain), use LLM with ResponseFormatterPrompt
    const successResponse = await this.generateSuccessResponse(formattedResponse, language, requestId);
    return {
      finalResponse: successResponse,
    };
  }

  /**
   * Generate contextual error explanation using LLM
   */
  private async generateErrorExplanation(
    failedOperations: FailedOperationContext[],
    language: 'he' | 'en',
    requestId?: string
  ): Promise<string> {
    try {
      const modelConfig = getNodeModel('errorExplainer');

      // Build context for the LLM
      const failureDetails = failedOperations.map(op => ({
        capability: op.capability,
        operation: op.operation,
        searchedFor: op.searchedFor || 'N/A',
        userRequest: op.userRequest,
        errorMessage: op.errorMessage,
      }));

      const userMessage = `Failed operations to explain (respond in ${language === 'he' ? 'Hebrew' : 'English'}):

${JSON.stringify(failureDetails, null, 2)}`;

      console.log('[ResponseWriter] Calling LLM for error explanation');

      const response = await callLLM(
        {
          messages: [
            { role: 'system', content: ERROR_EXPLAINER_SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
          model: modelConfig.model,
          temperature: 0.5,  // Lower temperature for consistent explanations
          maxTokens: 200,    // Short responses only
        },
        requestId
      );

      if (response.content) {
        return response.content;
      }

      throw new Error('No content in error explanation response');
    } catch (error: any) {
      console.error('[ResponseWriter] Error explanation LLM call failed:', error);
      // Fallback to generic but slightly more informative message
      const firstFailure = failedOperations[0];
      if (language === 'he') {
        if (firstFailure.searchedFor) {
          return `לא הצלחתי לבצע את הפעולה עבור "${firstFailure.searchedFor}".`;
        }
        return 'לא הצלחתי לבצע את הבקשה.';
      } else {
        if (firstFailure.searchedFor) {
          return `I couldn't complete the operation for "${firstFailure.searchedFor}".`;
        }
        return "I couldn't complete the request.";
      }
    }
  }

  /**
   * Generate success response using ResponseFormatterPrompt
   */
  private async generateSuccessResponse(
    formattedResponse: any,
    language: 'he' | 'en',
    requestId?: string
  ): Promise<string> {
    console.log('[ResponseWriter] Using LLM with ResponseFormatterPrompt for function call results');

    try {
      // Get model config for response writer
      const modelConfig = getNodeModel('responseWriter');

      // Build the prompt data for ResponseFormatterPrompt
      // The prompt expects JSON with _metadata field
      const promptData = {
        _metadata: {
          agent: formattedResponse.agent,
          entityType: formattedResponse.entityType,
          operation: formattedResponse.operation,
          context: formattedResponse.context,
        },
        ...formattedResponse.formattedData,
      };

      // Get system prompt from ResponseFormatterPrompt
      if (!ResponseFormatterPrompt) {
        throw new Error('ResponseFormatterPrompt not available');
      }

      const systemPrompt = ResponseFormatterPrompt.getSystemPrompt();

      // Build user message with formatted data
      const userMessage = JSON.stringify(promptData, null, 2);

      // Call LLM
      const response = await callLLM(
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          model: modelConfig.model,
          temperature: modelConfig.temperature || 0.7,
          maxTokens: modelConfig.maxTokens || 2000,
        },
        requestId
      );

      if (!response.content) {
        throw new Error('No content in LLM response');
      }

      return response.content;
    } catch (error: any) {
      console.error('[ResponseWriter] LLM call failed:', error);
      // Fallback to error message
      const errorMessage = language === 'he'
        ? '❌ משהו השתבש. נסה שוב בבקשה.'
        : '❌ Something went wrong. Please try again.';
      return errorMessage;
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createResponseWriterNode() {
  const node = new ResponseWriterNode();
  return node.asNodeFunction();
}
