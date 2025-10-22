import { FunctionDefinition, IResponse } from '../types/AgentTypes';

export { IResponse } from '../types/AgentTypes';

export interface IAgent {
  processRequest(message: string, userPhone: string): Promise<string>;
  getSystemPrompt(): string;
  getFunctions(): FunctionDefinition[];
}

export interface IFunctionHandler {
  executeFunction(functionName: string, args: any, userId: string): Promise<IResponse>;
  registerFunction(functionDef: IFunction): void;
  getRegisteredFunctions(): FunctionDefinition[];
}

export interface IFunction {
  name: string;
  description: string;
  parameters: any;
  execute(args: any, userId: string): Promise<IResponse>;
}
export enum AgentName {
  DATABASE = 'database',
  CALENDAR = 'calendar',
  GMAIL = 'gmail',
  MAIN = 'main',
  MULTI_TASK = 'multi-task'
}