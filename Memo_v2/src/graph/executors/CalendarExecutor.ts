/**
 * CalendarExecutor
 * 
 * Executes calendar operations using CalendarServiceAdapter.
 * Uses AuthContext from LangGraph shared state (no redundant DB fetches).
 */

import { CalendarServiceAdapter, type CalendarOperationArgs } from '../../services/adapters/CalendarServiceAdapter.js';
import type { ExecutionResult } from '../../types/index.js';
import { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';

export class CalendarExecutor extends BaseExecutor {
  readonly name = 'calendar_executor';
  readonly capability = 'calendar';

  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      if (!context.authContext) {
        return {
          stepId,
          success: false,
          error: 'AuthContext not available — cannot execute calendar operation',
          durationMs: Date.now() - startTime,
        };
      }

      const adapter = new CalendarServiceAdapter(context.authContext);
      const result = await adapter.execute(args as CalendarOperationArgs);

      return {
        stepId,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[CalendarExecutor] Error executing step ${stepId}:`, error);
      return {
        stepId,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export function createCalendarExecutor() {
  const executor = new CalendarExecutor();
  return executor.asNodeFunction();
}

