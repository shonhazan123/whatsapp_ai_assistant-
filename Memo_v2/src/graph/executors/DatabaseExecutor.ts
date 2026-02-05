/**
 * DatabaseExecutor
 * 
 * Executes database operations (tasks and lists) using TaskServiceAdapter and ListServiceAdapter.
 */

import { ListServiceAdapter, type ListOperationArgs } from '../../services/adapters/ListServiceAdapter.js';
import { TaskServiceAdapter, type TaskOperationArgs } from '../../services/adapters/TaskServiceAdapter.js';
import type { ExecutionResult } from '../../types/index.js';
import { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';

// Task operations
const TASK_OPERATIONS = [
  'create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple',
  'delete', 'deleteMultiple', 'deleteAll', 'complete', 'addSubtask',
];

// List operations
const LIST_OPERATIONS = [
  'create', 'get', 'getAll', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem',
];

export class DatabaseExecutor extends BaseExecutor {
  readonly name = 'database_executor';
  readonly capability = 'database';

  async execute(
    stepId: string,
    args: Record<string, any>,
    context: ExecutorContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // If data was pre-fetched and filtered by EntityResolver, use it directly
      if (args._prefetchedData) {
        console.log(`[DatabaseExecutor] Using pre-fetched data for step ${stepId}`);
        return {
          stepId,
          success: true,
          data: args._prefetchedData,
          durationMs: Date.now() - startTime,
        };
      }

      // Determine if this is a task or list operation based on the args
      const isListOperation = this.isListOperation(args);

      let result;
      if (isListOperation) {
        const adapter = new ListServiceAdapter(context.userPhone);
        result = await adapter.execute(args as ListOperationArgs);
      } else {
        const adapter = new TaskServiceAdapter(context.userPhone);
        result = await adapter.execute(args as TaskOperationArgs);
      }

      return {
        stepId,
        success: result.success,
        data: result.data,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      console.error(`[DatabaseExecutor] Error executing step ${stepId}:`, error);
      return {
        stepId,
        success: false,
        error: error.message || String(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Determine if this is a list operation based on args
   */
  private isListOperation(args: Record<string, any>): boolean {
    // Check explicit entity type first (set by resolver)
    if (args._entityType) {
      return args._entityType === 'list';
    }

    // Fall back to field-based detection for backward compatibility
    // If it has list-specific fields, it's a list operation
    if (args.listId || args.listName || args.isChecklist !== undefined) {
      return true;
    }

    // If it has task-specific fields, it's a task operation
    if (args.taskId || args.dueDate || args.reminder || args.reminderRecurrence) {
      return false;
    }

    // Check operation name patterns
    const op = args.operation;
    if (op === 'addItem' || op === 'toggleItem' || op === 'deleteItem') {
      return true;
    }

    // Default to task operation
    return false;
  }
}

export function createDatabaseExecutor() {
  const executor = new DatabaseExecutor();
  return executor.asNodeFunction();
}

