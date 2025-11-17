import { OpenAIService } from '../../services/ai/OpenAIService';
import { RequestContext } from '../context/RequestContext';
import { IFunctionHandler } from '../interfaces/IAgent';
import { FunctionDefinition, IAgent } from '../types/AgentTypes';

export abstract class BaseAgent implements IAgent {
  protected functions: Map<string, any> = new Map();

  constructor(
    protected openaiService: OpenAIService,
    protected functionHandler: IFunctionHandler,
    protected logger: any = logger
  ) {}

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
      });

      const responseMessage = completion.choices[0]?.message;

      if (responseMessage?.function_call) {
        const functionCall = responseMessage.function_call;
        const args = JSON.parse(functionCall.arguments);

        this.logger.info(`🔧 Executing function: ${functionCall.name}`);
        
        const result = await this.functionHandler.executeFunction(
          functionCall.name,
          args,
          await this.getUserId(userPhone)
        );

        // Get final response with function result
        const finalCompletion = await this.openaiService.createCompletion({
          messages: [
            { role: 'system', content: systemPrompt },
            ...context,
            { role: 'user', content: message },
            { 
              role: 'assistant' as const, 
              content: responseMessage.content || '',
              ...responseMessage
            },
            {
              role: 'function',
              name: functionCall.name,
              content: JSON.stringify(result)
            }
          ]
        });

        return finalCompletion.choices[0]?.message?.content || 'Operation completed.';
      }

      return responseMessage?.content || 'Unable to process request.';
    } catch (error) {
      this.logger.error('Error in executeWithAI:', error);
      return 'Sorry, I encountered an error processing your request.';
    }
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
