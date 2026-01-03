/**
 * JoinNode
 * 
 * Merges parallel execution results from resolvers/executors.
 * 
 * Responsibilities:
 * - Collect results from all completed steps
 * - Detect partial failures
 * - Decide recovery strategy or HITL escalation
 * - Build unified execution summary for response formatting
 */

import type { ExecutionResult, ResolverResult } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// TYPES
// ============================================================================

interface JoinSummary {
  totalSteps: number;
  successfulSteps: number;
  failedSteps: number;
  partialFailure: boolean;
  results: Map<string, ExecutionResult>;
  errors: Array<{ stepId: string; error: string }>;
}

// ============================================================================
// JOIN NODE
// ============================================================================

export class JoinNode extends CodeNode {
  readonly name = 'join';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const resolverResults = state.resolverResults;
    const plan = state.plannerOutput?.plan || [];
    
    console.log(`[JoinNode] Processing ${resolverResults.size} resolver results`);
    
    // Convert resolver results to execution results
    // In a full implementation, there would be an Executor step between Resolver and Join
    // For now, we simulate execution by converting resolver args to execution results
    const executionResults = new Map<string, ExecutionResult>();
    const errors: Array<{ stepId: string; error: string }> = [];
    
    let successCount = 0;
    let failCount = 0;
    
    for (const [stepId, result] of resolverResults) {
      const startTime = Date.now();
      
      if (result.type === 'execute') {
        // Check for error markers in args
        if (result.args.error || result.args._fallback) {
          failCount++;
          errors.push({
            stepId,
            error: result.args.error || 'Fallback resolver used',
          });
          
          executionResults.set(stepId, {
            stepId,
            success: false,
            error: result.args.error,
            durationMs: Date.now() - startTime,
          });
        } else {
          successCount++;
          
          // Simulate successful execution
          // In real implementation, this would call the actual service
          executionResults.set(stepId, {
            stepId,
            success: true,
            data: this.simulateExecution(result),
            durationMs: Date.now() - startTime,
          });
        }
      } else {
        // Clarify type - should not reach here if HITL worked correctly
        failCount++;
        errors.push({
          stepId,
          error: 'Step required clarification but reached Join node',
        });
        
        executionResults.set(stepId, {
          stepId,
          success: false,
          error: 'Clarification not resolved',
          durationMs: Date.now() - startTime,
        });
      }
    }
    
    const summary: JoinSummary = {
      totalSteps: plan.length,
      successfulSteps: successCount,
      failedSteps: failCount,
      partialFailure: failCount > 0 && successCount > 0,
      results: executionResults,
      errors,
    };
    
    console.log(`[JoinNode] Summary: ${successCount} success, ${failCount} failed`);
    
    // Handle partial failures
    if (summary.partialFailure) {
      console.warn('[JoinNode] Partial failure detected');
      // Could trigger HITL for recovery decisions
      // For now, we continue with successful results
    }
    
    // Handle complete failure
    if (failCount > 0 && successCount === 0) {
      console.error('[JoinNode] All steps failed');
      return {
        executionResults,
        error: `All ${failCount} step(s) failed: ${errors.map(e => e.error).join('; ')}`,
      };
    }
    
    return {
      executionResults,
    };
  }
  
  /**
   * Simulate execution of a resolver result
   * In real implementation, this would be handled by Executor nodes
   */
  private simulateExecution(result: ResolverResult): any {
    if (result.type !== 'execute') return null;
    
    const { args } = result;
    const operation = args.operation;
    
    // Return a simulated response based on the operation type
    switch (operation) {
      case 'create':
        return {
          created: true,
          id: `sim-${Date.now()}`,
          ...args,
        };
        
      case 'getAll':
      case 'getEvents':
      case 'listEmails':
        return {
          items: [],
          count: 0,
          query: args,
        };
        
      case 'get':
      case 'getEmailById':
      case 'getMemoryById':
        return {
          found: false,
          query: args,
        };
        
      case 'update':
        return {
          updated: true,
          id: args.eventId || args.taskId || args.listId,
          changes: args.updateFields || args,
        };
        
      case 'delete':
        return {
          deleted: true,
          id: args.eventId || args.taskId || args.listId,
        };
        
      case 'complete':
        return {
          completed: true,
          taskId: args.taskId,
        };
        
      case 'storeMemory':
        return {
          stored: true,
          memoryId: `mem-${Date.now()}`,
        };
        
      case 'searchMemory':
        return {
          results: [],
          query: args.query,
        };
        
      default:
        return {
          executed: true,
          operation,
          args,
        };
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createJoinNode() {
  const node = new JoinNode();
  return node.asNodeFunction();
}


