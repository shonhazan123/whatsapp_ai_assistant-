import { OpenAIService } from '../../services/ai/OpenAIService';
import { PerformanceTracker } from '../../services/performance/PerformanceTracker';
import { setAgentNameForTracking } from '../../services/performance/performanceUtils';
import { ResponseFormatter } from '../../services/response/ResponseFormatter';
import { RequestContext } from '../context/RequestContext';
import { IFunctionHandler } from '../interfaces/IAgent';
import { FunctionDefinition, IAgent } from '../types/AgentTypes';

export abstract class BaseAgent implements IAgent {
  protected functions: Map<string, any> = new Map();
  protected performanceTracker: PerformanceTracker;
  protected responseFormatter: ResponseFormatter;

  constructor(
    protected openaiService: OpenAIService,
    protected functionHandler: IFunctionHandler,
    protected logger: any = logger
  ) {
    this.performanceTracker = PerformanceTracker.getInstance();
    // Initialize ResponseFormatter for Phase 2 (cheap model for final messages)
    this.responseFormatter = new ResponseFormatter(openaiService);
  }

  abstract processRequest(
    message: string, 
    userPhone: string,
    optionsOrContext?: {
      whatsappMessageId?: string;
      replyToMessageId?: string;
    } | any[]
  ): Promise<string>;
  abstract getSystemPrompt(): string;
  abstract getFunctions(): FunctionDefinition[];

  protected async executeWithAI( message: string, userPhone: string, systemPrompt: string, functions: FunctionDefinition[], context: any[] = [] ): Promise<string> {
    const agentStartTime = Date.now();
    const agentName = this.getAgentName();
    const requestId = agentName ? setAgentNameForTracking(agentName) : undefined;
    let error: Error | null = null;

    try {
      const messages = [
        // Use the original static system prompt so it can be fully cached
        // Functions are still passed via the separate `functions` parameter for tool calling
        { role: 'system' as const, content: systemPrompt },
        ...context,
        { role: 'user' as const, content: message }
      ];

      // Still pass functions parameter (API needs it for function calling)
      // But cache will use the message prefix (which now includes functions)
      const completion = await this.openaiService.createCompletion({
        messages,
        functions, // API still needs this for function calling
        functionCall: 'auto'
      }, requestId);

      const responseMessage = completion.choices[0]?.message;

      // Handle both legacy function_call and new tool_calls format
      const functionCall = responseMessage?.function_call;
      const toolCalls = responseMessage?.tool_calls;
      
      // Determine which format is being used
      const isToolCallFormat = toolCalls && toolCalls.length > 0;
      const isFunctionCallFormat = functionCall && !isToolCallFormat;

      if (isFunctionCallFormat || isToolCallFormat) {
        // Extract function call information
        let functionName: string;
        let functionArgs: any;
        let toolCallId: string | undefined;

        if (isToolCallFormat) {
          // New tool_calls format
          const toolCall = toolCalls[0];
          toolCallId = toolCall.id;
          functionName = toolCall.function.name;
          functionArgs = JSON.parse(toolCall.function.arguments);
        } else if (functionCall) {
          // Legacy function_call format
          functionName = functionCall.name;
          functionArgs = JSON.parse(functionCall.arguments);
        } else {
          // Should not happen, but TypeScript needs this
          throw new Error('Neither function_call nor tool_calls found in response');
        }

        this.logger.info(`🔧 Executing function: ${functionName}`);
        this.logger.debug(`   Function arguments: ${JSON.stringify(functionArgs, null, 2)}`);
        if (toolCallId) {
          this.logger.debug(`   Tool call ID: ${toolCallId}`);
        }
        
        const userId = await this.getUserId(userPhone);
        this.logger.debug(`   User identifier: ${userId}`);
        
        const result = await this.functionHandler.executeFunction(
          functionName,
          functionArgs,
          userId
        );
        
        this.logger.debug(`   Function result: ${JSON.stringify({
          success: result.success,
          error: result.error,
          dataKeys: result.data ? Object.keys(result.data) : [],
          message: result.message
        }, null, 2)}`);

        // Build the assistant message with the function/tool call
        const assistantMessage: any = {
          role: 'assistant' as const,
          content: responseMessage.content || null,
        };

        // Add the appropriate call format to the assistant message
        if (isToolCallFormat) {
          assistantMessage.tool_calls = toolCalls;
        } else {
          assistantMessage.function_call = functionCall;
        }

        // Build the function/tool result message
        const resultMessage: any = {
          content: JSON.stringify(result)
        };

        if (isToolCallFormat) {
          // New tool format: use role 'tool' with tool_call_id
          resultMessage.role = 'tool';
          resultMessage.tool_call_id = toolCallId;
        } else {
          // Legacy function format: use role 'function' with name
          resultMessage.role = 'function';
          resultMessage.name = functionName;
        }

        // Phase 2: Use ResponseFormatter (cheap model) instead of second expensive LLM call
        // Same logic as before - pass ORIGINAL systemPrompt (without function definitions), user message, assistantMessage, and resultMessage
        // The old code used the original systemPrompt, not the enhanced one with function definitions
        // NO context messages to save tokens, but we need assistantMessage for tool_calls format
        const formattedResponse = await this.responseFormatter.formatResponse(
          systemPrompt, // Use original systemPrompt, NOT enhancedSystemPrompt (no function definitions)
          message,
          assistantMessage,
          resultMessage,
          requestId
        );

        return this.filterAgentResponse(formattedResponse);
      }

      const agentEndTime = Date.now();
      
      // Track agent execution success
      if (requestId && agentName) {
        await this.performanceTracker.logAgentExecution(
          requestId,
          agentName,
          agentStartTime,
          agentEndTime,
          true,
          null
        );
      }

      const rawResponse = responseMessage?.content || 'Unable to process request.';
      return this.filterAgentResponse(rawResponse);
    } catch (err) {
      error = err instanceof Error ? err : new Error('Unknown error');
      const agentEndTime = Date.now();
      
      // Track agent execution failure
      if (requestId && agentName) {
        await this.performanceTracker.logAgentExecution(
          requestId,
          agentName,
          agentStartTime,
          agentEndTime,
          false,
          error.message
        );
      }

      this.logger.error('Error in executeWithAI:', error);
      return 'Sorry, I encountered an error processing your request.';
    }
  }

  /**
   * Filter agent response to remove JSON, error messages, and internal instructions
   * that should not be shown to the user
   */
  private filterAgentResponse(response: string): string {
    if (!response || typeof response !== 'string') {
      return 'Operation completed.';
    }

    // Check if response contains JSON that looks like function call instructions
    // This happens when the AI outputs JSON instead of calling functions
    const jsonPattern = /\{[\s]*"operation"[\s]*:/;
    if (jsonPattern.test(response)) {
      this.logger.warn('Agent response contains JSON function call - filtering out');
      // Try to extract meaningful text before/after JSON
      const beforeJson = response.substring(0, response.indexOf('{')).trim();
      const afterJson = response.substring(response.lastIndexOf('}') + 1).trim();
      const meaningfulText = [beforeJson, afterJson].filter(t => t.length > 0).join(' ').trim();
      
      if (meaningfulText.length > 10) {
        return meaningfulText;
      }
      // If no meaningful text, return a generic message
      return 'I processed your request. The operation has been completed.';
    }

    // Check if response contains error messages that should be handled internally
    const errorIndicators = [
      'error:',
      'failed:',
      'exception:',
      'ERROR:',
      'FAILED:',
      'שגיאה:',
      'נכשל:'
    ];
    
    const hasErrorIndicator = errorIndicators.some(indicator => 
      response.toLowerCase().includes(indicator.toLowerCase())
    );

    if (hasErrorIndicator && response.length < 200) {
      // Short error messages should be converted to user-friendly messages
      this.logger.warn('Agent response contains error indicator - converting to user-friendly message');
      return 'I encountered an issue processing your request. Please try again or rephrase your request.';
    }

    // Remove any JSON-like structures that might have leaked through
    // But keep the response if it's mostly natural language
    const jsonLikeMatch = response.match(/\{[^{}]*"operation"[^{}]*\}/);
    if (jsonLikeMatch && response.length < 300) {
      // If response is mostly JSON, filter it
      const jsonLength = jsonLikeMatch[0].length;
      if (jsonLength > response.length * 0.5) {
        this.logger.warn('Agent response is mostly JSON - filtering out');
        return 'I processed your request. The operation has been completed.';
      }
    }

    return response;
  }

  /**
   * Get agent name for tracking
   * Override in subclasses if needed
   */
  protected getAgentName(): string | null {
    // Try to extract from class name
    const className = this.constructor.name;
    if (className.includes('DatabaseAgent')) return 'database';
    if (className.includes('CalendarAgent')) return 'calendar';
    if (className.includes('GmailAgent')) return 'gmail';
    if (className.includes('SecondBrainAgent')) return 'second-brain';
    if (className.includes('MainAgent')) return 'main';
    return null;
  }

  protected async getUserId(userPhone: string): Promise<string> {
    const requestContext = RequestContext.get();
    if (requestContext) {
      return requestContext.whatsappNumber;
    }
    return userPhone;
  }

  protected registerFunction(functionName: string, handler: any): void {
    this.functions.set(functionName, handler);
  }
}
