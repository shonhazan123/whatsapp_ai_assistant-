/**
 * ExecutorNode
 *
 * Unified executor node that dispatches to capability-specific executors.
 * Processes all resolver results and executes them in parallel where possible.
 *
 * Idempotency: checks executedOperations[operationId] before executing.
 * operationId = traceId + ':' + stepId.
 * If present -> skip execution and reuse executionResults.
 * If absent -> execute, write executionResults + PII-safe ledger entry.
 */

import { createHash } from 'crypto';
import type { AuthContext, ExecutedOperation, ExecutionResult } from '../../types/index.js';
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
    const executorArgs = state.executorArgs;
    const plan = state.plannerOutput?.plan || [];
    const userPhone = state.user.phone;
    const authContext = state.authContext;
    const traceId = state.traceId;
    const existingLedger = state.executedOperations || {};

    console.log(`[ExecutorNode] Executing - resolverResults: ${resolverResults.size}, executorArgs: ${executorArgs?.size || 0}, authContext: ${authContext ? 'present' : 'missing'}`);

    const executionResults = new Map<string, ExecutionResult>();
    const newLedgerEntries: Record<string, ExecutedOperation> = {};

    const executionPromises: Promise<void>[] = [];

    for (const step of plan) {
      const stepId = step.id;
      const resolverResult = resolverResults.get(stepId);

      if (resolverResult?.type !== 'execute') {
        console.log(`[ExecutorNode] Skipping step ${stepId}: type=${resolverResult?.type || 'unknown'}`);
        continue;
      }

      const args = executorArgs?.get(stepId) || resolverResult.args;
      if (!args) {
        console.warn(`[ExecutorNode] No args found for step ${stepId}`);
        continue;
      }

      // Idempotency guard
      const operationId = `${traceId}:${stepId}`;
      if (existingLedger[operationId]) {
        console.log(`[ExecutorNode] IDEMPOTENCY_SKIP: ${operationId} already executed`);
        const cached = state.executionResults?.get(stepId);
        if (cached) {
          executionResults.set(stepId, cached);
        } else {
          console.warn(`[ExecutorNode] IDEMPOTENCY_MISSING_RESULT: ledger exists but executionResults missing for ${operationId}`);
          executionResults.set(stepId, {
            stepId,
            success: false,
            error: 'IDEMPOTENCY_MISSING_RESULT: previously executed but result unavailable',
            durationMs: 0,
          });
        }
        continue;
      }

      console.log(`[ExecutorNode] Step ${stepId} args source: ${executorArgs?.has(stepId) ? 'executorArgs (resolved)' : 'resolverResults (original)'}`);

      const promise = this.executeStep(
        stepId,
        step.capability,
        args,
        userPhone,
        authContext
      ).then(execResult => {
        executionResults.set(stepId, execResult);

        // Write PII-safe ledger entry
        const argsHash = stableHash(args);
        const resultHash = stableHash({ success: execResult.success, stepId: execResult.stepId });
        const externalIds = this.extractExternalIds(execResult);

        newLedgerEntries[operationId] = {
          at: new Date().toISOString(),
          stepId,
          capability: step.capability,
          argsHash,
          success: execResult.success,
          resultHash,
          ...(externalIds ? { externalIds } : {}),
        };
      });

      executionPromises.push(promise);
    }

    await Promise.all(executionPromises);

    console.log(`[ExecutorNode] Completed ${executionResults.size} executions`);

    return {
      executionResults,
      ...(Object.keys(newLedgerEntries).length > 0
        ? { executedOperations: { ...existingLedger, ...newLedgerEntries } }
        : {}),
    };
  }
  
  /**
   * Execute a single step using the appropriate adapter.
   * Uses AuthContext from shared state (no redundant DB fetches).
   */
  private async executeStep(
    stepId: string,
    capability: string,
    args: Record<string, any>,
    userPhone: string,
    authContext?: AuthContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      let result;
      
      switch (capability) {
        case 'calendar':
          if (!authContext) {
            return { stepId, success: false, error: 'AuthContext not available for calendar operation', durationMs: Date.now() - startTime };
          }
          const calendarAdapter = new CalendarServiceAdapter(authContext);
          result = await calendarAdapter.execute(args as any);
          // Strip links for list operations so response doesn't show them (messy for "what are my events")
          if ((args.operation === 'getEvents' || args.operation === 'get') && result.data) {
            result = {
              ...result,
              data: this.stripCalendarLinksFromListData(result.data),
            };
          }
          break;
          
        case 'database':
          // Defensive: task adapter requires operation; default to getAll (list) when missing
          if (!this.isListOperation(args)) {
            const taskArgs = { ...args };
            if (taskArgs.operation === undefined || taskArgs.operation === null || taskArgs.operation === '') {
              taskArgs.operation = 'getAll';
            }
            args = taskArgs;
          }
          if (this.isListOperation(args)) {
            const listAdapter = new ListServiceAdapter(userPhone);
            result = await listAdapter.execute(args as any);
          } else {
            const taskAdapter = new TaskServiceAdapter(userPhone);
            result = await taskAdapter.execute(args as any);
          }
          break;
          
        case 'gmail':
          if (!authContext) {
            return { stepId, success: false, error: 'AuthContext not available for gmail operation', durationMs: Date.now() - startTime };
          }
          const gmailAdapter = new GmailServiceAdapter(authContext);
          result = await gmailAdapter.execute(args as any);
          break;
          
        case 'second-brain':
          const secondBrainAdapter = new SecondBrainServiceAdapter(userPhone);
          result = await secondBrainAdapter.execute(args as any);
          break;
          
        case 'general':
          // No external service call needed (user/agent info responses)
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
   * Strip htmlLink from calendar list data so ResponseWriter doesn't include links
   * (links are only for create/update, not for "what are my events")
   */
  private stripCalendarLinksFromListData(data: Record<string, any>): Record<string, any> {
    const { htmlLink: _h, ...rest } = data;
    const events = Array.isArray(rest.events)
      ? rest.events.map((e: any) => {
          if (!e || typeof e !== 'object') return e;
          const { htmlLink: _eh, ...ev } = e;
          return ev;
        })
      : rest.events;
    return { ...rest, events };
  }

  /**
   * Extract external IDs from execution result (PII-safe: IDs only).
   */
  private extractExternalIds(result: ExecutionResult): Record<string, string | string[]> | undefined {
    if (!result.success || !result.data) return undefined;
    const ids: Record<string, string | string[]> = {};
    const d = result.data;
    if (d.id) ids.id = String(d.id);
    if (d.eventId) ids.eventId = String(d.eventId);
    if (d.taskId) ids.taskId = String(d.taskId);
    if (d.messageId) ids.messageId = String(d.messageId);
    if (d.memoryId) ids.memoryId = String(d.memoryId);
    if (Array.isArray(d.events)) {
      const eventIds = d.events.map((e: any) => e?.id).filter(Boolean);
      if (eventIds.length > 0) ids.eventIds = eventIds;
    }
    return Object.keys(ids).length > 0 ? ids : undefined;
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

function stableHash(obj: any): string {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
}

