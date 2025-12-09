import { logger } from '../../utils/logger';
import { OpenAIService } from '../ai/OpenAIService';

/**
 * ResponseFormatter - Simple service to format function results into user-friendly messages
 * Uses gpt-5-mini to keep costs low while maintaining quality
 * Follows the same logic as the old second LLM call, just with a cheaper model
 * Uses the agent's system prompt (which has all formatting instructions) + enhanced formatter prompt
 */
export class ResponseFormatter {
  private openaiService: OpenAIService;
  private formatterModel: string = 'gpt-4o-mini'; // Use gpt-4o-mini (verified model name)

  constructor(openaiService: OpenAIService) {
    this.openaiService = openaiService;
  }

  /**
   * Format function execution result into a user-friendly message
   * Passes systemPrompt, userMessage, assistantMessage (with tool_calls), and resultMessage to cheap LLM
   * Same logic as before - need assistantMessage because tool result must follow assistant message with tool_calls
   * The systemPrompt already contains all the agent's formatting instructions
   * We enhance it with the formatter prompt to ensure exact format matching
   */
  async formatResponse(
    systemPrompt: string,
    userMessage: string,
    assistantMessage: any,
    resultMessage: any,
    requestId?: string
  ): Promise<string> {
    try {
      logger.debug('🎨 Using ResponseFormatter (cheap model) for final message generation');

      // Use the agent's system prompt (has all formatting instructions) - this is what the old code used
      // The agent's system prompt already contains all the response formatting rules
      // CRITICAL: Do NOT pass functions/tools - formatter should only generate text, not function calls
      // The systemPrompt may have function definitions embedded, but we don't pass functions parameter
      // so the model can't actually call functions - it will just generate text based on the prompt
      const completion = await this.openaiService.createCompletion({
        messages: [
          { role: 'system', content: systemPrompt }, // Agent's system prompt has all formatting instructions
          { role: 'user', content: userMessage },
          assistantMessage, // Must include this - tool result requires preceding assistant message with tool_calls
          resultMessage
        ],
        model: this.formatterModel,
        maxTokens: 500
        // Do NOT pass functions/tools - this ensures model only generates text, not function calls
        // Same as old code - no functions parameter means no function calling capability
      }, requestId);

      const message = completion.choices[0]?.message;
      const rawResponse = message?.content;
      
      logger.debug('📝 Formatter response', {
        hasMessage: !!message,
        hasContent: !!rawResponse,
        hasToolCalls: !!(message?.tool_calls && message.tool_calls.length > 0),
        hasFunctionCall: !!message?.function_call,
        contentLength: rawResponse?.length || 0,
        contentPreview: rawResponse?.substring(0, 200) || 'null/empty',
        fullMessage: JSON.stringify(message).substring(0, 500)
      });

      // Check if model generated tool_calls or function_call instead of content
      if (message?.tool_calls && message.tool_calls.length > 0) {
        logger.error('❌ Formatter generated tool_calls instead of content - model tried to call functions');
        logger.debug('Tool calls:', JSON.stringify(message.tool_calls).substring(0, 500));
        // This shouldn't happen with tool_choice: 'none', but if it does, we need to handle it
      }
      
      if (message?.function_call) {
        logger.error('❌ Formatter generated function_call instead of content - model tried to call functions');
        logger.debug('Function call:', JSON.stringify(message.function_call).substring(0, 500));
      }

      if (!rawResponse || rawResponse.trim().length === 0) {
        logger.warn('⚠️  Formatter returned empty response');
        return 'Operation completed.';
      }

      return rawResponse;
    } catch (error) {
      logger.error('Error formatting response:', error);
      return 'Sorry, I encountered an error processing your request.';
    }
  }
}
