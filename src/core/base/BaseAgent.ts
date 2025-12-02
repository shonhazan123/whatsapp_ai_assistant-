import { OpenAIService } from '../../services/ai/OpenAIService';
import { PerformanceTracker } from '../../services/performance/PerformanceTracker';
import { RequestContext } from '../context/RequestContext';
import { IFunctionHandler } from '../interfaces/IAgent';
import { FunctionDefinition, IAgent } from '../types/AgentTypes';

export abstract class BaseAgent implements IAgent {
  protected functions: Map<string, any> = new Map();
  protected performanceTracker: PerformanceTracker;

  constructor(
    protected openaiService: OpenAIService,
    protected functionHandler: IFunctionHandler,
    protected logger: any = logger
  ) {
    this.performanceTracker = PerformanceTracker.getInstance();
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
    const requestContext = RequestContext.get();
    const requestId = requestContext?.performanceRequestId;
    const agentName = this.getAgentName();
    let error: Error | null = null;

    // Track agent execution start
    if (requestId && agentName) {
      // Agent execution will be tracked at the processRequest level
    }

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...context,
        { role: 'user', content: message }
      ];

      const completion = await this.openaiService.createCompletion({
        messages,
        functions,
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

        // Get final response with function result
        const finalCompletion = await this.openaiService.createCompletion({
          messages: [
            { role: 'system', content: systemPrompt },
            ...context,
            { role: 'user', content: message },
            assistantMessage,
            resultMessage
          ]
        }, requestId);

        return finalCompletion.choices[0]?.message?.content || 'Operation completed.';
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

      return responseMessage?.content || 'Unable to process request.';
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
