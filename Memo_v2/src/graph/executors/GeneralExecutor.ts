/**
 * GeneralExecutor
 *
 * Handles general capability: user/agent informative responses (no external service calls).
 * Single executor for all user info and system (help, plan, status, etc.) questions.
 */

import type { ExecutionResult } from '../../types/index.js';
import { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';

export class GeneralExecutor extends BaseExecutor {
  readonly name = 'general_executor';
  readonly capability = 'general';

  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    return {
      stepId,
      success: true,
      data: args,
      durationMs: Date.now() - startTime,
    };
  }
}

export function createGeneralExecutor() {
  const executor = new GeneralExecutor();
  return executor.asNodeFunction();
}

