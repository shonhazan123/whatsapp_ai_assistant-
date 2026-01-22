/**
 * SecondBrainExecutor
 * 
 * Executes second brain (memory) operations using SecondBrainServiceAdapter.
 */

import { SecondBrainServiceAdapter, type SecondBrainOperationArgs } from '../../services/adapters/SecondBrainServiceAdapter.js';
import type { ExecutionResult } from '../../types/index.js';
import { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';

export class SecondBrainExecutor extends BaseExecutor {
  readonly name = 'secondbrain_executor';
  readonly capability = 'second-brain';

  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      const adapter = new SecondBrainServiceAdapter(context.userPhone);
      const result = await adapter.execute(args as SecondBrainOperationArgs);

      return {
        stepId,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[SecondBrainExecutor] Error executing step ${stepId}:`, error);
      return {
        stepId,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }
}

export function createSecondBrainExecutor() {
  const executor = new SecondBrainExecutor();
  return executor.asNodeFunction();
}

