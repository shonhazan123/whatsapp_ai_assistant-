/**
 * Request Context Manager for Performance Tracking
 * Manages request IDs and session tracking
 */

import { randomUUID } from 'crypto';
import { PerformanceContext } from './types';

export class PerformanceRequestContext {
  private static instance: PerformanceRequestContext;
  private contexts: Map<string, PerformanceContext> = new Map();

  private constructor() {}

  static getInstance(): PerformanceRequestContext {
    if (!PerformanceRequestContext.instance) {
      PerformanceRequestContext.instance = new PerformanceRequestContext();
    }
    return PerformanceRequestContext.instance;
  }

  /**
   * Start a new request context
   * Each request gets its own session ID (1 request = 1 session)
   * A session represents: user sends message → agent processes → agent responds
   */
  startRequest(userPhone: string): string {
    const requestId = randomUUID();
    // Each request gets its own session ID (1 request = 1 session)
    const sessionId = requestId;
    
    const context: PerformanceContext = {
      requestId,
      sessionId,
      userPhone,
      startTime: Date.now(),
      callSequence: 0,
      currentAgent: null,
      currentFunction: null,
    };

    this.contexts.set(requestId, context);
    return requestId;
  }

  /**
   * Get current request context
   */
  getContext(requestId: string): PerformanceContext | null {
    return this.contexts.get(requestId) || null;
  }

  /**
   * Increment call sequence for a request
   */
  incrementCallSequence(requestId: string): number {
    const context = this.contexts.get(requestId);
    if (context) {
      context.callSequence++;
      return context.callSequence;
    }
    return 0;
  }

  /**
   * Set current agent for a request
   */
  setCurrentAgent(requestId: string, agent: string | null): void {
    const context = this.contexts.get(requestId);
    if (context) {
      context.currentAgent = agent;
    }
  }

  /**
   * Set current function for a request
   */
  setCurrentFunction(requestId: string, functionName: string | null): void {
    const context = this.contexts.get(requestId);
    if (context) {
      context.currentFunction = functionName;
    }
  }

  /**
   * Set last AI call info (for function tracking)
   */
  setLastAICall(requestId: string, aiCall: {
    model: string | null;
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    actualRequestTokens?: number;
    actualTotalTokens?: number;
  }): void {
    const context = this.contexts.get(requestId);
    if (context) {
      context.lastAICall = aiCall;
    }
  }

  /**
   * Get last AI call info
   */
  getLastAICall(requestId: string): {
    model: string | null;
    requestTokens: number;
    responseTokens: number;
    totalTokens: number;
    cachedTokens?: number;
    actualRequestTokens?: number;
    actualTotalTokens?: number;
  } | undefined {
    const context = this.contexts.get(requestId);
    return context?.lastAICall;
  }

  /**
   * End request and clean up context
   */
  endRequest(requestId: string): void {
    this.contexts.delete(requestId);
  }

  /**
   * Clear old contexts (cleanup)
   */
  clearOldContexts(maxAge: number = 3600000): void { // 1 hour default
    const now = Date.now();
    for (const [requestId, context] of this.contexts.entries()) {
      if (now - context.startTime > maxAge) {
        this.contexts.delete(requestId);
      }
    }
  }
}

 