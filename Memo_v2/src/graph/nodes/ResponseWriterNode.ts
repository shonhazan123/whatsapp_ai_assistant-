/**
 * ResponseWriterNode
 * 
 * Generates the final user-facing message from formatted data.
 * 
 * - For general responses (capability = 'general'): Use data.response directly (already LLM-generated)
 * - For function call results: Dispatch to per-capability ResponseWriter (separate LLM call per capability)
 * - For multi-capability: Dispatch to MultiCapabilityResponseWriter (full prompt)
 * - For failed operations: Use LLM to generate contextual error explanations
 */

import { getNodeModel } from '../../config/llm-config.js';
import { traceLlmReasoningLog } from '../../services/trace/traceLlmReasoningLog.js';
import { writeResponse } from '../../services/responseWriters/index.js';
import type { FailedOperationContext, FormattedResponse } from '../../types/index.js';
import type { LLMStep, MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// ERROR EXPLANATION PROMPT
// ============================================================================

const ERROR_EXPLAINER_SYSTEM_PROMPT = `You are Donna — a female personal assistant. Always speak as a woman (e.g. Hebrew: use feminine forms like "ניסיתי", "לא הצלחתי"; English: natural female voice). Never use masculine forms for yourself.

From the user's message or context, infer whether the user is male or female when possible and address them with the correct gender (e.g. in Hebrew: masculine "לך/עשית" for male, feminine "לך/עשית" for female where verb forms differ).

You explain operation failures to users in simple, friendly language.

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
  private _pendingLlmSteps: LLMStep[] = [];

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    this._pendingLlmSteps = [];

    if (state.finalResponse) {
      console.log('[ResponseWriter] finalResponse already set, using it directly');
      return { finalResponse: state.finalResponse };
    }

    const formattedResponse = state.formattedResponse;
    const language = state.user.language === 'he' ? 'he' : 'en';
    const requestId = (state.input as any).requestId;
    const userMessage = state.input?.message || state.input?.enhancedMessage || undefined;
    const primaryStep = state.plannerOutput?.plan?.[0];
    const plannerSummary = primaryStep
      ? `${primaryStep.capability}:${primaryStep.action}`
      : undefined;

    if (state.error && !formattedResponse?.failedOperations?.length) {
      console.log('[ResponseWriter] Writing error response (no context available)');
      return {
        finalResponse: language === 'he'
          ? '❌ משהו השתבש. נסה שוב בבקשה.'
          : '❌ Something went wrong. Please try again.',
      };
    }

    if (!formattedResponse) {
      console.log('[ResponseWriter] No formatted response, using fallback');
      return {
        finalResponse: language === 'he'
          ? 'לא הבנתי. אפשר לנסח אחרת?'
          : "I didn't understand. Could you rephrase?",
      };
    }

    console.log(`[ResponseWriter] Generating response for ${formattedResponse.agent}:${formattedResponse.operation}`);

    const hasFailures = formattedResponse.failedOperations && formattedResponse.failedOperations.length > 0;
    const hasSuccesses = formattedResponse.formattedData &&
      (Array.isArray(formattedResponse.formattedData) ? formattedResponse.formattedData.length > 0 : true);

    if (hasFailures && !hasSuccesses) {
      console.log(`[ResponseWriter] All operations failed (${formattedResponse.failedOperations!.length} failures)`);
      return {
        finalResponse: await this.generateErrorExplanation(formattedResponse.failedOperations!, language, requestId),
        ...this._stepsUpdate(),
      };
    }

    if (hasFailures && hasSuccesses) {
      console.log('[ResponseWriter] Partial failure detected, generating combined response');
      const successResponse = await this.callCapabilityWriter(formattedResponse, state.user.userName, requestId, userMessage, plannerSummary);
      const failureExplanation = await this.generateErrorExplanation(formattedResponse.failedOperations!, language, requestId);
      const separator = language === 'he' ? '\n\nלצערי, ' : '\n\nHowever, ';
      return {
        finalResponse: successResponse + separator + failureExplanation.toLowerCase(),
        ...this._stepsUpdate(),
      };
    }

    if (formattedResponse.agent === 'general') {
      console.log('[ResponseWriter] Using general response directly (already LLM-generated)');
      const generalData = Array.isArray(formattedResponse.formattedData)
        ? formattedResponse.formattedData[0]
        : formattedResponse.formattedData;

      const response = generalData?.response || generalData?.text || generalData?.message;
      if (response) {
        return { finalResponse: response };
      }

      console.warn('[ResponseWriter] General response data missing response field');
      return {
        finalResponse: language === 'he'
          ? 'לא הבנתי. אפשר לנסח אחרת?'
          : "I didn't understand. Could you rephrase?",
      };
    }

    const successResponse = await this.callCapabilityWriter(formattedResponse, state.user.userName, requestId, userMessage, plannerSummary);
    return { finalResponse: successResponse, ...this._stepsUpdate() };
  }

  private _stepsUpdate(): Partial<MemoState> {
    return this._pendingLlmSteps.length > 0 ? { llmSteps: this._pendingLlmSteps } : {};
  }

  private async callCapabilityWriter(
    formattedResponse: FormattedResponse,
    userName?: string,
    requestId?: string,
    userMessage?: string,
    plannerSummary?: string,
  ): Promise<string> {
    try {
      const result = await writeResponse({ formattedResponse, userName, requestId, userMessage, plannerSummary });
      this._pendingLlmSteps.push(...result.llmSteps);
      return result.text;
    } catch (error: any) {
      console.error('[ResponseWriter] Capability writer failed:', error);
      return '❌ משהו השתבש. נסה שוב בבקשה.';
    }
  }

  private async generateErrorExplanation(
    failedOperations: FailedOperationContext[],
    language: 'he' | 'en',
    requestId?: string
  ): Promise<string> {
    try {
      const modelConfig = getNodeModel('errorExplainer');
      const failureDetails = failedOperations.map(op => ({
        capability: op.capability,
        operation: op.operation,
        searchedFor: op.searchedFor || 'N/A',
        userRequest: op.userRequest,
        errorMessage: op.errorMessage,
      }));

      const userMsg = `Failed operations to explain (respond in ${language === 'he' ? 'Hebrew' : 'English'}):\n\n${JSON.stringify(failureDetails, null, 2)}`;

      console.log('[ResponseWriter] Calling LLM for error explanation');
      const { response, llmStep } = await traceLlmReasoningLog(
        'response_writer:error_explain',
        {
          messages: [
            { role: 'system', content: ERROR_EXPLAINER_SYSTEM_PROMPT },
            { role: 'user', content: userMsg },
          ],
          model: modelConfig.model,
          temperature: 0.5,
          maxTokens: 200,
        },
        requestId,
      );
      this._pendingLlmSteps.push(llmStep);

      if (response.content) return response.content;
      throw new Error('No content in error explanation response');
    } catch (error: any) {
      console.error('[ResponseWriter] Error explanation LLM call failed:', error);
      const firstFailure = failedOperations[0];
      if (language === 'he') {
        return firstFailure.searchedFor
          ? `לא הצלחתי לבצע את הפעולה עבור "${firstFailure.searchedFor}".`
          : 'לא הצלחתי לבצע את הבקשה.';
      }
      return firstFailure.searchedFor
        ? `I couldn't complete the operation for "${firstFailure.searchedFor}".`
        : "I couldn't complete the request.";
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
