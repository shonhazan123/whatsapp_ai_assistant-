import { IFunctionHandler, IFunction, IResponse } from '../interfaces/IAgent';
import { FunctionDefinition } from '../types/AgentTypes';
import { logger } from '../../utils/logger';

export class FunctionHandler implements IFunctionHandler {
  private functions: Map<string, IFunction> = new Map();

  constructor(private logger: any = logger) {}

  async executeFunction(functionName: string, args: any, userId: string): Promise<IResponse> {
    try {
      const functionDef = this.functions.get(functionName);
      
      if (!functionDef) {
        this.logger.error(`Function not found: ${functionName}`);
        return {
          success: false,
          error: `Function ${functionName} not found`
        };
      }

      this.logger.info(`🔧 Executing function: ${functionName} for user: ${userId}`);
      
      const result = await functionDef.execute(args, userId);
      
      this.logger.info(`✅ Function ${functionName} executed successfully`);
      
      return result;
    } catch (error) {
      this.logger.error(`❌ Error executing function ${functionName}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  registerFunction(functionDef: IFunction): void {
    this.functions.set(functionDef.name, functionDef);
    this.logger.info(`📝 Registered function: ${functionDef.name}`);
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
