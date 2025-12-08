/**
 * TypeScript interfaces for Performance Tracking System
 */

export interface CallLogEntry {
  // Identification
  id: string;
  timestamp: string;
  requestId: string;
  sessionId: string;
  
  // Hierarchy Tracking
  agent: string | null;
  functionName: string | null;
  callType: 'completion' | 'embedding' | 'vision' | 'transcription' | 'function' | 'agent';
  callSequence: number;
  
  // AI Call Details
  model: string | null;
  requestTokens: number;
  responseTokens: number;
  totalTokens: number;
  
  // Timing
  startTime: string;
  endTime: string;
  durationMs: number;
  
  // Request/Response Data
  messages?: Array<{
    role: string;
    content: string;
  }>;
  responseContent?: string;
  functionCall?: {
    name: string;
    arguments: any;
  };
  
  // Status
  success: boolean;
  error: string | null;
  
  // Metadata
  userPhone: string;
  metadata: {
    method: string;
    hasFunctionCall?: boolean;
    retryAttempt?: number;
    [key: string]: any;
  };
}

export interface FunctionLogEntry {
  // Identification (matching CallLogEntry)
  id: string;
  timestamp: string;
  requestId: string;
  sessionId: string; // Added: Link to user session
  callType: 'function';
  callSequence: number; // Added: Order within request
  
  // Hierarchy Tracking
  agent: string;
  functionName: string;
  operation?: string;
  
  // AI Call Details (inherited from parent call)
  model: string | null; // Added: Model used in parent AI call
  requestTokens: number; // Added: Tokens from parent AI call
  responseTokens: number; // Added: Tokens from parent AI call
  totalTokens: number; // Added: Total tokens from parent AI call
  
  // Timing
  startTime: string;
  endTime: string;
  durationMs: number;
  
  // Status
  success: boolean;
  error: string | null;
  
  // Metadata
  userPhone: string; // Added: Required for user analytics
  arguments?: any;
  result?: any;
  metadata?: {
    [key: string]: any;
  };
}

export interface RequestSummary {
  requestId: string;
  sessionId: string;
  userPhone: string;
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  
  // Token Summary
  totalTokens: number;
  requestTokens: number;
  responseTokens: number;
  
  // Call Summary
  totalAICalls: number;
  totalFunctionCalls: number;
  agentsUsed: string[];
  functionsUsed: string[];
  
  // Status
  success: boolean;
  error: string | null;
  
  // Cost (if pricing available)
  estimatedCost?: number;
}

export interface PerformanceContext {
  requestId: string;
  sessionId: string;
  userPhone: string;
  startTime: number;
  callSequence: number;
  currentAgent: string | null;
  currentFunction: string | null;
  lastAICall?: {
    model: string | null;
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
  };
}

