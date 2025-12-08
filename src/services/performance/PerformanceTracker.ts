/**
 * Performance Tracker Service
 * Tracks token usage, execution times, and performance metrics
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { PerformanceRequestContext } from './RequestContext';
import { CallLogEntry, FunctionLogEntry, PerformanceContext, RequestSummary } from './types';

export class PerformanceTracker {
  private static instance: PerformanceTracker;
  private requestContext: PerformanceRequestContext;
  private logsDir: string;
  private requestSummaries: Map<string, RequestSummary> = new Map();
  // In-memory storage for all calls and functions (for database upload)
  private requestCalls: Map<string, CallLogEntry[]> = new Map();
  private requestFunctions: Map<string, FunctionLogEntry[]> = new Map();

  private constructor() {
    this.requestContext = PerformanceRequestContext.getInstance();
    this.logsDir = path.join(process.cwd(), 'logs', 'performance');
    this.ensureLogsDirectory();
  }

  static getInstance(): PerformanceTracker {
    if (!PerformanceTracker.instance) {
      PerformanceTracker.instance = new PerformanceTracker();
    }
    return PerformanceTracker.instance;
  }

  /**
   * Ensure logs directory exists
   */
  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /**
   * Get log file path for today
   */
  private getLogFilePath(type: 'calls' | 'functions' | 'requests'): string {
    const today = new Date().toISOString().split('T')[0];
    return path.join(this.logsDir, `${type}-${today}.json`);
  }

  /**
   * Append entry to JSON log file
   */
  private async appendToLogFile(filePath: string, entry: any): Promise<void> {
    try {
      let entries: any[] = [];
      
      // Read existing entries if file exists
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.trim()) {
          entries = JSON.parse(content);
        }
      }
      
      // Add new entry
      entries.push(entry);
      
      // Write back to file
      fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Error writing to performance log file:', error);
      // Don't throw - logging failures shouldn't break the app
    }
  }

  /**
   * Start tracking a new request
   */
  startRequest(userPhone: string): string {
    return this.requestContext.startRequest(userPhone);
  }

  /**
   * Log an AI call (completion, embedding, vision, transcription)
   */
  async logAICall(
    requestId: string,
    options: {
      callType: 'completion' | 'embedding' | 'vision' | 'transcription';
      model: string | null;
      requestTokens: number;
      responseTokens: number;
      totalTokens: number;
      startTime: number;
      endTime: number;
      messages?: Array<{ role: string; content: string }>;
      responseContent?: string;
      functionCall?: { name: string; arguments: any };
      success: boolean;
      error: string | null;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    const context = this.requestContext.getContext(requestId);
    if (!context) {
      logger.warn(`No context found for requestId: ${requestId}`);
      return;
    }

    const callSequence = this.requestContext.incrementCallSequence(requestId);
    
    // Truncate messages if too long
    const truncatedMessages = options.messages?.map(msg => ({
      role: msg.role,
      content: msg.content && msg.content.length > 1000 ? msg.content.substring(0, 1000) + '...' : (msg.content || '')
    }));

    const truncatedResponse = options.responseContent 
      ? (options.responseContent.length > 1000 ? options.responseContent.substring(0, 1000) + '...' : options.responseContent)
      : undefined;

    const entry: CallLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      sessionId: context.sessionId,
      agent: context.currentAgent,
      functionName: context.currentFunction,
      callType: options.callType,
      callSequence,
      model: options.model,
      requestTokens: options.requestTokens,
      responseTokens: options.responseTokens,
      totalTokens: options.totalTokens,
      startTime: new Date(options.startTime).toISOString(),
      endTime: new Date(options.endTime).toISOString(),
      durationMs: options.endTime - options.startTime,
      messages: truncatedMessages,
      responseContent: truncatedResponse,
      functionCall: options.functionCall,
      success: options.success,
      error: options.error,
      userPhone: context.userPhone,
      metadata: {
        method: options.callType,
        hasFunctionCall: !!options.functionCall,
        ...options.metadata,
      },
    };

    await this.appendToLogFile(this.getLogFilePath('calls'), entry);
    
    // Store in memory for database upload
    if (!this.requestCalls.has(requestId)) {
      this.requestCalls.set(requestId, []);
    }
    this.requestCalls.get(requestId)!.push(entry);
    
    // Update request summary
    this.updateRequestSummary(requestId, entry);
  }

  /**
   * Log agent execution
   */
  async logAgentExecution(
    requestId: string,
    agentName: string,
    startTime: number,
    endTime: number,
    success: boolean,
    error: string | null
  ): Promise<void> {
    const context = this.requestContext.getContext(requestId);
    if (!context) {
      return;
    }

    this.requestContext.setCurrentAgent(requestId, agentName);
    const callSequence = this.requestContext.incrementCallSequence(requestId);

    const entry: CallLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      sessionId: context.sessionId,
      agent: agentName,
      functionName: null,
      callType: 'agent',
      callSequence,
      model: null,
      requestTokens: 0,
      responseTokens: 0,
      totalTokens: 0,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      success,
      error,
      userPhone: context.userPhone,
      metadata: {
        method: 'agentExecution',
      },
    };

    await this.appendToLogFile(this.getLogFilePath('calls'), entry);
    
    // Store in memory for database upload
    if (!this.requestCalls.has(requestId)) {
      this.requestCalls.set(requestId, []);
    }
    this.requestCalls.get(requestId)!.push(entry);
  }

  /**
   * Log function execution
   * Now includes all fields to match unified schema
   */
  async logFunctionExecution(
    requestId: string,
    functionName: string,
    operation: string | undefined,
    startTime: number,
    endTime: number,
    success: boolean,
    error: string | null,
    args?: any,
    result?: any,
    parentAICall?: {
      model?: string | null;
      requestTokens?: number;
      responseTokens?: number;
      totalTokens?: number;
    }
  ): Promise<void> {
    const context = this.requestContext.getContext(requestId);
    if (!context) {
      return;
    }

    this.requestContext.setCurrentFunction(requestId, functionName);
    const callSequence = this.requestContext.incrementCallSequence(requestId);

    // Truncate args and result
    const truncatedArgs = args ? JSON.stringify(args).length > 500 
      ? JSON.stringify(args).substring(0, 500) + '...' 
      : args 
      : undefined;
    
    const truncatedResult = result ? JSON.stringify(result).length > 500
      ? JSON.stringify(result).substring(0, 500) + '...'
      : result
      : undefined;

    // Get agent name - ensure it's not null
    const agentName = context.currentAgent || 'unknown';

    const entry: FunctionLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId,
      sessionId: context.sessionId, // Added
      callType: 'function',
      callSequence, // Added
      agent: agentName,
      functionName,
      operation,
      model: parentAICall?.model || null, // Inherited from parent AI call
      requestTokens: parentAICall?.requestTokens || 0, // Inherited from parent AI call
      responseTokens: parentAICall?.responseTokens || 0, // Inherited from parent AI call
      totalTokens: parentAICall?.totalTokens || 0, // Inherited from parent AI call
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      durationMs: endTime - startTime,
      success,
      error,
      userPhone: context.userPhone, // Added
      arguments: truncatedArgs,
      result: truncatedResult,
      metadata: {
        method: 'functionExecution',
      },
    };

    await this.appendToLogFile(this.getLogFilePath('functions'), entry);
    
    // Store in memory for database upload
    if (!this.requestFunctions.has(requestId)) {
      this.requestFunctions.set(requestId, []);
    }
    this.requestFunctions.get(requestId)!.push(entry);
    
    // Clear function context after logging
    this.requestContext.setCurrentFunction(requestId, null);
  }

  /**
   * Update request summary with call data
   */
  private updateRequestSummary(requestId: string, entry: CallLogEntry): void {
    let summary = this.requestSummaries.get(requestId);
    const context = this.requestContext.getContext(requestId);
    
    if (!summary && context) {
      summary = {
        requestId,
        sessionId: context.sessionId,
        userPhone: context.userPhone,
        startTime: new Date(context.startTime).toISOString(),
        endTime: '',
        totalDurationMs: 0,
        totalTokens: 0,
        requestTokens: 0,
        responseTokens: 0,
        totalAICalls: 0,
        totalFunctionCalls: 0,
        agentsUsed: [],
        functionsUsed: [],
        success: true,
        error: null,
      };
      this.requestSummaries.set(requestId, summary);
    }

    if (summary) {
      if (entry.callType === 'completion' || entry.callType === 'embedding' || entry.callType === 'vision' || entry.callType === 'transcription') {
        summary.totalAICalls++;
        summary.totalTokens += entry.totalTokens;
        summary.requestTokens += entry.requestTokens;
        summary.responseTokens += entry.responseTokens;
      }

      if (entry.agent && !summary.agentsUsed.includes(entry.agent)) {
        summary.agentsUsed.push(entry.agent);
      }

      if (entry.functionName && !summary.functionsUsed.includes(entry.functionName)) {
        summary.functionsUsed.push(entry.functionName);
      }

      if (!entry.success) {
        summary.success = false;
        summary.error = entry.error || 'Unknown error';
      }
    }
  }

  /**
   * End request and log summary
   */
  async endRequest(requestId: string): Promise<void> {
    const context = this.requestContext.getContext(requestId);
    if (!context) {
      return;
    }

    const summary = this.requestSummaries.get(requestId);
    if (summary) {
      summary.endTime = new Date().toISOString();
      summary.totalDurationMs = Date.now() - context.startTime;
      
      await this.appendToLogFile(this.getLogFilePath('requests'), summary);
      
      // Print console summary
      this.printRequestSummary(summary);
      
      this.requestSummaries.delete(requestId);
    }

    this.requestContext.endRequest(requestId);
  }

  /**
   * Print request summary to console
   */
  private printRequestSummary(summary: RequestSummary): void {
    const durationSeconds = (summary.totalDurationMs / 1000).toFixed(2);
    
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('💰 Request Performance Summary:');
    logger.info(`   📊 Total Tokens: ${summary.totalTokens.toLocaleString()} (Request: ${summary.requestTokens.toLocaleString()}, Response: ${summary.responseTokens.toLocaleString()})`);
    logger.info(`   ⏱️  Total Duration: ${durationSeconds}s`);
    logger.info(`   🤖 Agents: ${summary.agentsUsed.length > 0 ? summary.agentsUsed.join(', ') : 'none'}`);
    logger.info(`   🔧 Functions: ${summary.functionsUsed.length > 0 ? summary.functionsUsed.join(', ') : 'none'}`);
    logger.info(`   📞 AI Calls: ${summary.totalAICalls}`);
    logger.info(`   ✅ Status: ${summary.success ? 'Success' : 'Failed'}`);
    if (summary.error) {
      logger.info(`   ❌ Error: ${summary.error}`);
    }
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Get current request context (for external access)
   */
  getCurrentContext(requestId: string): PerformanceContext | null {
    return this.requestContext.getContext(requestId);
  }

  /**
   * Get last AI call info for a request (for function tracking)
   */
  getLastAICall(requestId: string): {
    model: string | null;
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
  } | undefined {
    return this.requestContext.getLastAICall(requestId);
  }

  /**
   * Get all calls for a request (for database upload)
   */
  getRequestCalls(requestId: string): CallLogEntry[] {
    return this.requestCalls.get(requestId) || [];
  }

  /**
   * Get all functions for a request (for database upload)
   */
  getRequestFunctions(requestId: string): FunctionLogEntry[] {
    return this.requestFunctions.get(requestId) || [];
  }

  /**
   * Clear in-memory data for a request (after upload)
   */
  clearRequestData(requestId: string): void {
    this.requestCalls.delete(requestId);
    this.requestFunctions.delete(requestId);
  }
}

