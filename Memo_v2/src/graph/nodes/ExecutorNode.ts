/**
 * ExecutorNode
 * 
 * Unified executor node that dispatches to capability-specific executors.
 * Processes all resolver results and executes them in parallel where possible.
 */

import type { ExecutionResult } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

import { CalendarServiceAdapter } from '../../services/adapters/CalendarServiceAdapter.js';
import { GmailServiceAdapter } from '../../services/adapters/GmailServiceAdapter.js';
import { ListServiceAdapter } from '../../services/adapters/ListServiceAdapter.js';
import { SecondBrainServiceAdapter } from '../../services/adapters/SecondBrainServiceAdapter.js';
import { TaskServiceAdapter } from '../../services/adapters/TaskServiceAdapter.js';

// ============================================================================
// EXECUTOR NODE
// ============================================================================

export class ExecutorNode extends CodeNode {
  readonly name = 'executor';

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const resolverResults = state.resolverResults;
    const executorArgs = state.executorArgs; // Resolved args from EntityResolutionNode
    const plan = state.plannerOutput?.plan || [];
    const userPhone = state.user.phone;
    
    console.log(`[ExecutorNode] Executing - resolverResults: ${resolverResults.size}, executorArgs: ${executorArgs?.size || 0}`);
    
    const executionResults = new Map<string, ExecutionResult>();
    
    // Execute all steps from the plan
    const executionPromises: Promise<void>[] = [];
    
    for (const step of plan) {
      const stepId = step.id;
      const resolverResult = resolverResults.get(stepId);
      
      // Skip non-execute results
      if (resolverResult?.type !== 'execute') {
        console.log(`[ExecutorNode] Skipping step ${stepId}: type=${resolverResult?.type || 'unknown'}`);
        continue;
      }
      
      // IMPORTANT: Prefer executorArgs (resolved with IDs) over resolverResults (original)
      // EntityResolutionNode stores resolved args in executorArgs after fuzzy matching
      const args = executorArgs?.get(stepId) || resolverResult.args;
      
      if (!args) {
        console.warn(`[ExecutorNode] No args found for step ${stepId}`);
        continue;
      }
      
      console.log(`[ExecutorNode] Step ${stepId} args source: ${executorArgs?.has(stepId) ? 'executorArgs (resolved)' : 'resolverResults (original)'}`);
      
      // Execute asynchronously
      const promise = this.executeStep(
        stepId,
        step.capability,
        args,
        userPhone
      ).then(execResult => {
        executionResults.set(stepId, execResult);
      });
      
      executionPromises.push(promise);
    }
    
    // Wait for all executions to complete 
    await Promise.all(executionPromises);
    
    console.log(`[ExecutorNode] Completed ${executionResults.size} executions`);
    
    return {
      executionResults,
    };
  }
  
  /**
   * Execute a single step using the appropriate adapter
   */
  private async executeStep(
    stepId: string,
    capability: string,
    args: Record<string, any>,
    userPhone: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      let result;
      
      switch (capability) {
        case 'calendar':
          const calendarAdapter = new CalendarServiceAdapter(userPhone);
          result = await calendarAdapter.execute(args as any);
          break;
          
        case 'database':
          if (this.isListOperation(args)) {
            const listAdapter = new ListServiceAdapter(userPhone);
            result = await listAdapter.execute(args as any);
          } else {
            const taskAdapter = new TaskServiceAdapter(userPhone);
            result = await taskAdapter.execute(args as any);
          }
          break;
          
        case 'gmail':
          const gmailAdapter = new GmailServiceAdapter(userPhone);
          result = await gmailAdapter.execute(args as any);
          break;
          
        case 'second-brain':
          const secondBrainAdapter = new SecondBrainServiceAdapter(userPhone);
          result = await secondBrainAdapter.execute(args as any);
          break;
          
        case 'general':
        case 'meta':
          // No external service call needed
          result = { success: true, data: args };
          break;
          
        default:
          result = { success: false, error: `Unknown capability: ${capability}` };
      }
      
      return {
        stepId,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[ExecutorNode] Error executing step ${stepId}:`, error);
      return {
        stepId,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }
  
  /**
   * Determine if args are for a list operation
   */
  private isListOperation(args: Record<string, any>): boolean {
    
    if (args._entityType) {
      return args._entityType === 'list';
    }

    if (args.listId || args.listName || args.isChecklist !== undefined) {
      return true;
    }
    if (args.taskId || args.dueDate || args.reminder || args.reminderRecurrence) {
      return false;
    }
    const op = args.operation;
    if (op === 'addItem' || op === 'toggleItem' || op === 'deleteItem') {
      return true;
    }
    return false;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createExecutorNode() {
  const node = new ExecutorNode();
  return node.asNodeFunction();
}

