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
  id: string;
  timestamp: string;
  requestId: string;
  callType: 'function';
  functionName: string;
  agent: string;
  operation?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  success: boolean;
  error: string | null;
  arguments?: any;
  result?: any;
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
}

