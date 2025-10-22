/**
 * Legacy type exports for backward compatibility with existing services
 * This file provides the types that services expect from the old AgentTypes
 */

// Response interface
export interface IResponse {
  success: boolean;
  data?: any;
  message?: string;
  error?: string;
}

// Request interfaces
export interface CreateRequest {
  userPhone: string;
  data: any;
}

export interface UpdateRequest {
  userPhone: string;
  id: string;
  data: any;
}

export interface DeleteRequest {
  userPhone: string;
  id: string;
}

export interface GetRequest {
  userPhone: string;
  id?: string;
  filters?: any;
  limit?: number;
  offset?: number;
}

export interface BulkRequest {
  userPhone: string;
  items: any[];
}

// Function definition for OpenAI
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// User data request (for UserDataService)
export interface UserDataRequest {
  userPhone: string;
}

