/**
 * ResponseWriterNode
 * 
 * Generates the final user-facing message from formatted data.
 * 
 * According to BLUEPRINT.md section 10.2:
 * - For general responses (capability = 'general'): Use data.response directly (already LLM-generated)
 * - For function call results: Use LLM with ResponseFormatterPrompt
 * - Templates only for simple fallback cases
 * 
 * Responsibilities:
 * - Use LLM with ResponseFormatterPrompt for function call results
 * - Pass through general responses (already LLM-generated)
 * - Ensure Memo speaks (not the capabilities)
 * - Handle Hebrew/English language differences
 */

import { getNodeModel } from '../../config/llm-config.js';
import { callLLM } from '../../services/llm/LLMService.js';
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
// RESPONSE WRITER NODE
// ============================================================================

export class ResponseWriterNode extends CodeNode {
  readonly name = 'response_writer';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const formattedResponse = state.formattedResponse;
    const language = state.user.language === 'he' ? 'he' : 'en';
    
    // Handle errors
    if (state.error) {
      console.log('[ResponseWriter] Writing error response');
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
      
      // Get requestId from state input metadata if available
      const requestId = (state.input as any).requestId;
      
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
      
      return {
        finalResponse: response.content,
      };
    } catch (error: any) {
      console.error('[ResponseWriter] LLM call failed:', error);
      // Fallback to error message
      const errorMessage = language === 'he'
        ? '❌ משהו השתבש. נסה שוב בבקשה.'
        : '❌ Something went wrong. Please try again.';
      return {
        finalResponse: errorMessage,
      };
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
