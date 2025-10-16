export interface IAgent {
  processRequest(message: string, userPhone: string): Promise<string>;
  getSystemPrompt(): string;
  getFunctions(): FunctionDefinition[];
}

export interface IFunction {
  name: string;
  description: string;
  parameters: any;
  execute(args: any, userId: string): Promise<any>;
}

export interface IResponse {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

export interface AgentConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface BaseRequest {
  userPhone: string;
}

export interface CreateRequest extends BaseRequest {
  data: any;
}

export interface UpdateRequest extends BaseRequest {
  id: string;
  data: any;
}

export interface DeleteRequest extends BaseRequest {
  id: string;
}

export interface GetRequest extends BaseRequest {
  id?: string;
  filters?: Record<string, any>;
  limit?: number;
  offset?: number;
}

export interface BulkRequest extends BaseRequest {
  items: any[];
}

export interface QueryRequest extends BaseRequest {
  query: string;
  filters?: Record<string, any>;
}
