/**
 * Shared interfaces for agents and tools
 */

export interface IToolset {
  name: string;
  description: string;
  execute(operation: string, params: any): Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

export interface IAgent {
  name: string;
  description: string;
  execute(state: any): Promise<any>;
}

export interface AgentResponse {
  success: boolean;
  data?: any;
  error?: string;
  next?: string; // Next node to route to
  requiresHITL?: boolean;
  clarificationMessage?: string;
}

export interface ExecutionContext {
  userPhone: string;
  messageId: string;
  conversationHistory: any[];
  language: 'he' | 'en';
}

export interface Memory {
  shortTerm: Map<string, any>; // Per-session memory
  longTerm: any[]; // Conversation history from DB
}

export interface HITLRequest {
  type: 'confirmation' | 'clarification' | 'selection';
  message: string;
  options?: string[];
  timeout?: number;
}

export interface HITLResponse {
  approved: boolean;
  selectedOption?: string;
  userResponse: string;
}

