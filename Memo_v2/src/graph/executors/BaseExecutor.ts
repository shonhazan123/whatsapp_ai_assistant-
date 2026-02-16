/**
 * BaseExecutor
 * 
 * Abstract base class for all executor nodes.
 * Executors take resolver outputs and call the appropriate service adapters.
 */

import type { AuthContext, ExecutionResult } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ExecutorContext {
  userPhone: string;
  timezone: string;
  language: 'he' | 'en' | 'other';
  /** Full hydrated auth context from MemoState (includes tokens, user record, capabilities) */
  authContext?: AuthContext;
}

// ============================================================================
// BASE EXECUTOR
// ============================================================================

export abstract class BaseExecutor {
  abstract readonly name: string;
  abstract readonly capability: string;
  
  /**
   * Execute a resolved step
   */
  abstract execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult>;
  
  /**
   * Wrap as a node function for LangGraph
   */
  asNodeFunction() {
    return async (state: MemoState): Promise<Partial<MemoState>> => {
      const startTime = Date.now();
      
      const context: ExecutorContext = {
        userPhone: state.user.phone,
        timezone: state.user.timezone,
        language: state.user.language,
        authContext: state.authContext,
      };
      
      // Find resolver results for this capability
      const executionResults = new Map(state.executionResults);
      
      for (const [stepId, resolverResult] of state.resolverResults) {
        // Skip if already executed
        if (executionResults.has(stepId)) continue;
        
        // Skip if not for this capability
        const step = state.plannerOutput?.plan.find((s: { id: string }) => s.id === stepId);
        if (!step || step.capability !== this.capability) continue;
        
        // Skip if resolver didn't produce execute result
        if (resolverResult.type !== 'execute') continue;
        
        // Execute
        const result = await this.execute(stepId, resolverResult.args, context);
        executionResults.set(stepId, result);
      }
      
      // Update metadata
      const metadata = {
        ...state.metadata,
        nodeExecutions: [
          ...state.metadata.nodeExecutions,
          {
            node: this.name,
            startTime,
            endTime: Date.now(),
            durationMs: Date.now() - startTime,
          },
        ],
      };
      
      return {
        executionResults,
        metadata,
      };
    };
  }
}

