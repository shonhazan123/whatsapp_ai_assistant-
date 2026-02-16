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

      const operation = (args as CalendarOperationArgs).operation;
      const isListOperation = operation === 'getEvents' || operation === 'get';

      // For list operations: strip links so response writer doesn't show them (messy for "what are my events")
      // For create/update: merge calendarLink so user gets the link to the created/updated event
      let data: Record<string, any>;
      if (isListOperation && result.data) {
        const { htmlLink: _h, ...rest } = result.data as Record<string, any>;
        data = {
          ...rest,
          events: Array.isArray(rest.events)
            ? rest.events.map((e: any) => {
                const { htmlLink: _eh, ...ev } = e || {};
                return ev;
              })
            : rest.events,
        };
      } else {
        data = {
          ...result.data,
          ...(result.calendarLink && !result.data?.htmlLink && { htmlLink: result.calendarLink }),
        };
      }

      return {
        stepId,
        success: result.success,
        data,
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

