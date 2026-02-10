export interface IAgent {
  processRequest(
    message: string, 
    userPhone: string,
    optionsOrContext?: {
      whatsappMessageId?: string;
      replyToMessageId?: string;
    } | any[]
  ): Promise<string>;
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

// Phase 2: Shared types for QueryResolver
export type EntityDomain = 'task' | 'event' | 'list' | 'email';

export interface EntityReference {
  id?: string; // when available
  domain: EntityDomain;
  canonical: string; // normalized label/summary/name
  metadata?: Record<string, any>; // extra attributes (time, listName, attendees)
}

export interface ResolutionCandidate<T = any> {
  entity: T;
  reference: EntityReference;
  score: number; // 0..1 confidence
  reason?: string;
}

export interface ResolutionResult<T = any> {
  intent?: string;
  candidates: ResolutionCandidate<T>[];
  disambiguationRequired: boolean;
}

export interface BaseRequest {
  userPhone: string;
  userId?: string;
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


export interface QueryRequest extends BaseRequest {
  query: string;
  filters?: Record<string, any>;
}

export interface CreateMultipleRequest extends BaseRequest {
  items: any[];
}
