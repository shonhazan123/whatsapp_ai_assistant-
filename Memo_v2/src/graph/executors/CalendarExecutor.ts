/**
 * CalendarExecutor
 * 
 * Executes calendar operations using CalendarServiceAdapter.
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
      // Build UserContext from ExecutorContext (need to get full user context from state)
      // For now, create a minimal UserContext - this will be improved when ExecutorContext includes full user
      const userContext: any = {
        phone: context.userPhone,
        timezone: context.timezone,
        language: context.language,
        planTier: 'free', // Will be populated from state in future
        googleConnected: false, // Will be populated from state
        capabilities: { calendar: true, gmail: false, database: true, secondBrain: true },
      };
      const adapter = new CalendarServiceAdapter(context.userPhone, userContext);
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

