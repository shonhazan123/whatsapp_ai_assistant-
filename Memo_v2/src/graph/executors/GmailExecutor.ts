/**
 * GmailExecutor
 * 
 * Executes Gmail operations using GmailServiceAdapter.
 */

import { GmailServiceAdapter, type GmailOperationArgs } from '../../services/adapters/GmailServiceAdapter.js';
import type { ExecutionResult } from '../../types/index.js';
import { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';

export class GmailExecutor extends BaseExecutor {
  readonly name = 'gmail_executor';
  readonly capability = 'gmail';

  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Build UserContext from ExecutorContext (need to get full user context from state)
      const userContext: any = {
        phone: context.userPhone,
        timezone: context.timezone,
        language: context.language,
        planTier: 'free', // Will be populated from state in future
        googleConnected: false, // Will be populated from state
        capabilities: { calendar: false, gmail: true, database: true, secondBrain: true },
      };
      const adapter = new GmailServiceAdapter(context.userPhone, userContext);
      const result = await adapter.execute(args as GmailOperationArgs);

      return {
        stepId,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[GmailExecutor] Error executing step ${stepId}:`, error);
      return {
        stepId,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export function createGmailExecutor() {
  const executor = new GmailExecutor();
  return executor.asNodeFunction();
}

