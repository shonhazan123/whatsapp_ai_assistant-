/**
 * GeneralExecutor
 * 
 * Handles general/conversational responses (no external service calls).
 * Also handles meta operations (capability descriptions).
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
    
    // General and meta operations don't need external service calls
    // The resolver already prepared the response data
    return {
      stepId,
      success: true,
      data: args,
      durationMs: Date.now() - startTime,
    };
  }
}

export class MetaExecutor extends BaseExecutor {
  readonly name = 'meta_executor';
  readonly capability = 'meta';
  
  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // Meta operations return template responses directly
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

export function createMetaExecutor() {
  const executor = new MetaExecutor();
  return executor.asNodeFunction();
}

