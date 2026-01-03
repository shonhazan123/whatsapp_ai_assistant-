/**
 * GmailExecutor
 * 
 * Executes Gmail operations using GmailServiceAdapter.
 */

import type { ExecutionResult } from '../../types/index.js';
import { GmailServiceAdapter, type GmailOperationArgs } from '../../services/adapters/GmailServiceAdapter.js';
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
      const adapter = new GmailServiceAdapter(context.userPhone);
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

