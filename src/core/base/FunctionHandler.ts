import { PerformanceTracker } from '../../services/performance/PerformanceTracker';
import { RequestContext } from '../context/RequestContext';
import { IFunction, IFunctionHandler, IResponse } from '../interfaces/IAgent';
import { FunctionDefinition } from '../types/AgentTypes';

export class FunctionHandler implements IFunctionHandler {
  private functions: Map<string, IFunction> = new Map();
  private performanceTracker: PerformanceTracker;

  constructor(private logger: any = logger) {
    this.performanceTracker = PerformanceTracker.getInstance();
  }

  async executeFunction(functionName: string, args: any, userId: string): Promise<IResponse> {
    const startTime = Date.now();
    const requestContext = RequestContext.get();
    const requestId = requestContext?.performanceRequestId;
    let operation: string | undefined;

    // Try to extract operation from args
    if (args && typeof args === 'object' && 'operation' in args) {
      operation = args.operation;
    }

    try {
      const functionDef = this.functions.get(functionName);
      
      if (!functionDef) {
        this.logger.error(`Function not found: ${functionName}`);
        const error = `Function ${functionName} not found`;
        
        // Track function failure
        if (requestId) {
          await this.performanceTracker.logFunctionExecution(
            requestId,
            functionName,
            operation,
            startTime,
            Date.now(),
            false,
            error,
            args
          );
        }
        
        return {
          success: false,
          error
        };
      }

      this.logger.info(`🔧 Executing function: ${functionName} for user: ${userId}`);
      
      const result = await functionDef.execute(args, userId);
      const endTime = Date.now();
      
      this.logger.info(`✅ Function ${functionName} executed successfully`);
      
      // Track function execution
      if (requestId) {
        await this.performanceTracker.logFunctionExecution(
          requestId,
          functionName,
          operation,
          startTime,
          endTime,
          result.success,
          result.error || null,
          args,
          result
        );
      }
      
      return result;
    } catch (error) {
      const endTime = Date.now();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error(`❌ Error executing function ${functionName}:`, error);
      
      // Track function failure
      if (requestId) {
        await this.performanceTracker.logFunctionExecution(
          requestId,
          functionName,
          operation,
          startTime,
          endTime,
          false,
          errorMessage,
          args
        );
      }
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  registerFunction(functionDef: IFunction): void {
    this.functions.set(functionDef.name, functionDef);
  }

  getRegisteredFunctions(): FunctionDefinition[] {
    return Array.from(this.functions.values()).map(func => ({
      name: func.name,
      description: func.description,
      parameters: func.parameters
    }));
  }

  getFunction(functionName: string): IFunction | undefined {
    return this.functions.get(functionName);
  }

  unregisterFunction(functionName: string): boolean {
    return this.functions.delete(functionName);
  }

  getAllFunctions(): IFunction[] {
    return Array.from(this.functions.values());
  }
}
