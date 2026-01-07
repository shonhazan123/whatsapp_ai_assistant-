/**
 * JoinNode
 * 
 * Merges parallel execution results from ExecutorNode.
 * 
 * According to BLUEPRINT.md:
 * - ExecutorNode already executes resolver results and stores them in state.executionResults
 * - JoinNode's job is to merge results, detect partial failures, and prepare for response formatting
 * 
 * Responsibilities:
 * - Merge ExecutionResults from ExecutorNode (already executed)
 * - Detect partial failures
 * - Decide recovery strategy or HITL escalation
 * - Build unified execution summary for response formatting
 */

import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// ============================================================================
// JOIN NODE
// ============================================================================

export class JoinNode extends CodeNode {
  readonly name = 'join';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    // ExecutionResults are already populated by ExecutorNode
    const executionResults = state.executionResults;
    const plan = state.plannerOutput?.plan || [];
    
    console.log(`[JoinNode] Merging ${executionResults.size} execution results`);
    
    // Count successes and failures
    let successCount = 0;
    let failCount = 0;
    const errors: Array<{ stepId: string; error: string }> = [];
    
    for (const [stepId, result] of executionResults) {
      if (result.success) {
        successCount++;
      } else {
        failCount++;
        errors.push({
          stepId,
          error: result.error || 'Unknown error',
        });
      }
    }
    
    const partialFailure = failCount > 0 && successCount > 0;
    
    console.log(`[JoinNode] Summary: ${successCount} success, ${failCount} failed, partialFailure: ${partialFailure}`);
    
    // Handle partial failures
    if (partialFailure) {
      console.warn('[JoinNode] Partial failure detected - some steps succeeded, some failed');
      // Continue with successful results, errors are stored in executionResults
    }
    
    // Handle complete failure
    if (failCount > 0 && successCount === 0) {
      console.error('[JoinNode] All steps failed');
      return {
        executionResults,
        error: `All ${failCount} step(s) failed: ${errors.map(e => e.error).join('; ')}`,
      };
    }
    
    // Success - return executionResults as-is (ExecutorNode already populated them)
    return {
      executionResults,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createJoinNode() {
  const node = new JoinNode();
  return node.asNodeFunction();
}


