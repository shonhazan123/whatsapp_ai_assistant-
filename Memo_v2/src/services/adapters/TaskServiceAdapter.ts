/**
 * TaskServiceAdapter
 * 
 * Adapter for V1 TaskService.
 * Converts resolver args (taskOperations) into TaskService method calls.
 */

import { getTaskService } from '../v1-services.js';

export interface ReminderRecurrence {
  type: 'daily' | 'weekly' | 'monthly' | 'nudge';
  interval?: string;
  days?: string[];
  time?: string;
  until?: string;
}

export interface TaskOperationArgs {
  operation: string;
  taskId?: string;
  taskIds?: string[];  // For bulk operations with resolved IDs
  text?: string;
  category?: string;
  dueDate?: string;
  reminder?: string;
  reminderRecurrence?: ReminderRecurrence;
  reminderDetails?: {
    dueDate?: string;
    reminder?: string;
    reminderRecurrence?: ReminderRecurrence;
  };
  filters?: {
    completed?: boolean;
    category?: string;
    window?: string;
    type?: string;  // recurring | unplanned | reminder
    reminderRecurrence?: string;
  };
  tasks?: Array<{
    text: string;
    taskId?: string;  // Added: resolved ID for deleteMultiple
    category?: string;
    dueDate?: string;
    reminder?: string;
    reminderRecurrence?: ReminderRecurrence;
  }>;
  updates?: Array<{
    text: string;
    taskId?: string;  // Added: resolved ID for updateMultiple
    reminderDetails?: any;
  }>;
  where?: {
    window?: string;
    reminderRecurrence?: string;
  };
  patch?: {  // For updateAll operation
    dueDate?: string;
    category?: string;
    completed?: boolean;
    reminder?: string;
    reminderRecurrence?: ReminderRecurrence;
  };
  preview?: boolean;
  subtaskText?: string;
  _notFound?: string[];  // Tasks that weren't found during resolution
}

export interface TaskOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class TaskServiceAdapter {
  private userPhone: string;
  
  constructor(userPhone: string) {
    this.userPhone = userPhone;
  }
  
  /**
   * Execute a task operation
   */
  async execute(args: TaskOperationArgs): Promise<TaskOperationResult> {
    const { operation } = args;
    const taskService = getTaskService();
    
    if (!taskService) {
      return { success: false, error: 'TaskService not available' };
    }
    
    try {
      switch (operation) {
        case 'create':
          return await this.createTask(taskService, args);
          
        case 'createMultiple':
          return await this.createMultipleTasks(taskService, args);
          
        case 'get':
          return await this.getTask(taskService, args);
          
        case 'getAll':
          return await this.getAllTasks(taskService, args);
          
        case 'update':
          return await this.updateTask(taskService, args);
          
        case 'delete':
          return await this.deleteTask(taskService, args);
          
        case 'complete':
          return await this.completeTask(taskService, args);
          
        case 'addSubtask':
          return await this.addSubtask(taskService, args);
          
        case 'deleteAll':
          return await this.deleteAllTasks(taskService, args);
          
        case 'deleteMultiple':
          return await this.deleteMultipleTasks(taskService, args);
          
        case 'updateMultiple':
          return await this.updateMultipleTasks(taskService, args);
          
        case 'updateAll':
          return await this.updateAllTasks(taskService, args);
          
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      console.error(`[TaskServiceAdapter] Error in ${operation}:`, error);
      return { success: false, error: error.message || String(error) };
    }
  }
  
  // ========================================================================
  // OPERATION IMPLEMENTATIONS
  // ========================================================================
  
  private async createTask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const result = await taskService.create({
      userPhone: this.userPhone,
      data: {
        text: args.text,
        category: args.category,
        dueDate: args.dueDate,
        reminder: args.reminder,
        reminderRecurrence: args.reminderRecurrence,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async createMultipleTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const tasks = args.tasks || [];
    const results = [];
    const errors = [];
    
    for (const task of tasks) {
      const result = await taskService.create({
        userPhone: this.userPhone,
        data: task,
      });
      
      if (result.success) {
        results.push(result.data);
      } else {
        errors.push({ task: task.text, error: result.error });
      }
    }
    
    return {
      success: errors.length === 0,
      data: { created: results, errors },
    };
  }
  
  private async getTask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    // Get all tasks and filter by text or id
    const result = await taskService.getAll({
      userPhone: this.userPhone,
    });
    
    if (!result.success) {
      return result;
    }
    
    // Handle different response formats from V1 TaskService:
    // - result.data could be an array directly
    // - result.data could be an object with a 'tasks' or 'items' property
    // - result.data could be null/undefined
    let tasks: any[] = [];
    if (Array.isArray(result.data)) {
      tasks = result.data;
    } else if (result.data?.tasks && Array.isArray(result.data.tasks)) {
      tasks = result.data.tasks;
    } else if (result.data?.items && Array.isArray(result.data.items)) {
      tasks = result.data.items;
    } else if (result.data && typeof result.data === 'object') {
      // If it's an object but not recognized format, log for debugging
      console.warn('[TaskServiceAdapter] Unexpected getAll response format:', Object.keys(result.data));
    }
    
    const found = tasks.find((t: any) => 
      (args.taskId && t.id === args.taskId) ||
      (args.text && t.text?.toLowerCase().includes(args.text.toLowerCase()))
    );
    
    return {
      success: !!found,
      data: found,
      error: found ? undefined : 'Task not found',
    };
  }
  
  private async getAllTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const filters = args.filters;
    const needsInMemoryFilter = filters && (filters.window || filters.type);

    // V1 supports only: completed, category, dueDateFrom, dueDateTo
    const v1Filters: Record<string, any> = { completed: false };
    if (filters?.category && !needsInMemoryFilter) {
      v1Filters.category = filters.category;
    }

    const result = await taskService.getAll({
      userPhone: this.userPhone,
      filters: v1Filters,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    let tasks = Array.isArray(result.data) ? result.data : result.data?.tasks ?? [];
    if (needsInMemoryFilter && tasks.length > 0 && filters) {
      tasks = this.filterTasks(tasks, filters);
      return {
        success: true,
        data: { tasks, count: tasks.length },
      };
    }

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  /**
   * Filter tasks by window and type (used when V1 does not support these filters)
   */
  private filterTasks(tasks: any[], filters: Record<string, any>): any[] {
    let result = tasks;
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    if (filters.window) {
      result = result.filter(task => {
        const dueDate = task.due_date ? new Date(task.due_date) : null;
        switch (filters.window) {
          case 'today':
            return dueDate && dueDate >= todayStart && dueDate <= todayEnd;
          case 'tomorrow': {
            const tomorrowStart = new Date(todayStart);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            const tomorrowEnd = new Date(todayEnd);
            tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);
            return dueDate && dueDate >= tomorrowStart && dueDate <= tomorrowEnd;
          }
          case 'this_week': {
            const weekEnd = new Date(todayStart);
            weekEnd.setDate(weekEnd.getDate() + 7);
            return dueDate && dueDate >= now && dueDate <= weekEnd;
          }
          case 'overdue':
            return dueDate && dueDate < now;
          case 'upcoming':
            return dueDate && dueDate >= now;
          default:
            return true;
        }
      });
    }

    if (filters.type) {
      result = result.filter(task => {
        const hasRecurrence = !!task.reminder_recurrence;
        const hasDueDate = !!task.due_date;
        switch (filters.type) {
          case 'recurring':
            return hasRecurrence;
          case 'unplanned':
            return !hasDueDate && !hasRecurrence;
          case 'reminder':
            return hasDueDate && !hasRecurrence;
          default:
            return true;
        }
      });
    }

    if (filters.category) {
      result = result.filter(task =>
        task.category?.toLowerCase() === filters.category.toLowerCase()
      );
    }

    return result;
  }
  
  private async updateTask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    // First find the task if we don't have an ID
    let taskId = args.taskId;
    
    if (!taskId && args.text) {
      const findResult = await this.getTask(taskService, { operation: 'get', text: args.text });
      if (findResult.success && findResult.data?.id) {
        taskId = findResult.data.id;
      } else {
        return { success: false, error: `Task not found: ${args.text}` };
      }
    }
    
    if (!taskId) {
      return { success: false, error: 'Task ID is required for update' };
    }
    
    const result = await taskService.update({
      userPhone: this.userPhone,
      id: taskId,
      data: {
        text: args.text,
        category: args.category,
        ...(args.reminderDetails || {}),
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async deleteTask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    // First find the task if we don't have an ID
    let taskId = args.taskId;
    
    if (!taskId && args.text) {
      const findResult = await this.getTask(taskService, { operation: 'get', text: args.text });
      if (findResult.success && findResult.data?.id) {
        taskId = findResult.data.id;
      } else {
        return { success: false, error: `Task not found: ${args.text}` };
      }
    }
    
    if (!taskId) {
      return { success: false, error: 'Task ID is required for delete' };
    }
    
    const result = await taskService.delete({
      userPhone: this.userPhone,
      id: taskId,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async completeTask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    // First find the task if we don't have an ID
    let taskId = args.taskId;
    
    if (!taskId && args.text) {
      const findResult = await this.getTask(taskService, { operation: 'get', text: args.text });
      if (findResult.success && findResult.data?.id) {
        taskId = findResult.data.id;
      } else {
        return { success: false, error: `Task not found: ${args.text}` };
      }
    }
    
    if (!taskId) {
      return { success: false, error: 'Task ID is required for complete' };
    }
    
    const result = await taskService.update({
      userPhone: this.userPhone,
      id: taskId,
      data: {
        completed: true,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async addSubtask(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    if (!args.taskId || !args.subtaskText) {
      return { success: false, error: 'Task ID and subtask text are required' };
    }
    
    const result = await taskService.addSubtask({
      userPhone: this.userPhone,
      data: {
        taskId: args.taskId,
        text: args.subtaskText,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  // ========================================================================
  // BULK OPERATION IMPLEMENTATIONS
  // ========================================================================
  
  /**
   * Delete all tasks matching a filter
   * Uses where.window to filter: 'today', 'this_week', 'overdue', 'all'
   */
  private async deleteAllTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const window = args.where?.window || 'all';
    
    // First, get all tasks matching the filter
    const getAllResult = await taskService.getAll({
      userPhone: this.userPhone,
      data: { window },
    });
    
    if (!getAllResult.success) {
      return { success: false, error: getAllResult.error || 'Failed to fetch tasks' };
    }
    
    // Extract tasks from response
    let tasks: any[] = [];
    if (Array.isArray(getAllResult.data)) {
      tasks = getAllResult.data;
    } else if (getAllResult.data?.tasks && Array.isArray(getAllResult.data.tasks)) {
      tasks = getAllResult.data.tasks;
    }
    
    if (tasks.length === 0) {
      return { success: true, data: { deleted: 0, tasks: [] } };
    }
    
    // Delete each task
    const deleted: any[] = [];
    const errors: any[] = [];
    
    for (const task of tasks) {
      const deleteResult = await taskService.delete({
        userPhone: this.userPhone,
        id: task.id,
      });
      
      if (deleteResult.success) {
        deleted.push(task);
      } else {
        errors.push({ task: task.text, error: deleteResult.error });
      }
    }
    
    return {
      success: errors.length === 0,
      data: { 
        deleted: deleted.length, 
        tasks: deleted,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }
  
  /**
   * Delete multiple specific tasks by their resolved IDs
   */
  private async deleteMultipleTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    // Use taskIds if available (from entity resolution), otherwise use tasks array
    const taskIds = args.taskIds || args.tasks?.map(t => t.taskId).filter(Boolean) || [];
    
    if (taskIds.length === 0) {
      return { success: false, error: 'No tasks to delete' };
    }
    
    const deleted: any[] = [];
    const errors: any[] = [];
    
    for (const taskId of taskIds) {
      const deleteResult = await taskService.delete({
        userPhone: this.userPhone,
        id: taskId,
      });
      
      if (deleteResult.success) {
        deleted.push(deleteResult.data || { id: taskId });
      } else {
        errors.push({ taskId, error: deleteResult.error || 'Delete failed' });
      }
    }
    
    // Include info about tasks that weren't found during resolution
    const notFound = args._notFound || [];
    
    // Build error summary when all deletes fail
    const allFailed = deleted.length === 0 && errors.length > 0;
    const errorSummary = allFailed 
      ? `Failed to delete ${errors.length} task(s): ${errors.map(e => e.error || 'Unknown error').join('; ')}`
      : undefined;
    
    return {
      success: deleted.length > 0,
      data: { 
        deleted: deleted.length, 
        tasks: deleted,
        errors: errors.length > 0 ? errors : undefined,
        notFound: notFound.length > 0 ? notFound : undefined,
      },
      // Add top-level error when all deletes fail for proper error propagation
      error: errorSummary,
    };
  }
  
  /**
   * Update multiple specific tasks
   */
  private async updateMultipleTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const updates = args.updates || [];
    
    if (updates.length === 0) {
      return { success: false, error: 'No updates to apply' };
    }
    
    const updated: any[] = [];
    const errors: any[] = [];
    
    for (const update of updates) {
      if (!update.taskId) {
        errors.push({ text: update.text, error: 'Task not resolved' });
        continue;
      }
      
      // Validate reminderDetails has actual fields to update
      const updateData = update.reminderDetails || {};
      if (Object.keys(updateData).length === 0) {
        errors.push({ text: update.text, error: 'No fields to update specified' });
        continue;
      }
      
      const updateResult = await taskService.update({
        userPhone: this.userPhone,
        id: update.taskId,
        data: updateData,
      });
      
      if (updateResult.success) {
        updated.push(updateResult.data || { id: update.taskId });
      } else {
        errors.push({ text: update.text, error: updateResult.error || 'Update failed' });
      }
    }
    
    // Include info about tasks that weren't found during resolution
    const notFound = args._notFound || [];
    
    // Build error summary when all updates fail
    const allFailed = updated.length === 0 && errors.length > 0;
    const errorSummary = allFailed 
      ? `Failed to update ${errors.length} task(s): ${errors.map(e => e.error || 'Unknown error').join('; ')}`
      : undefined;
    
    return {
      success: updated.length > 0,
      data: { 
        updated: updated.length, 
        tasks: updated,
        errors: errors.length > 0 ? errors : undefined,
        notFound: notFound.length > 0 ? notFound : undefined,
      },
      // Add top-level error when all updates fail for proper error propagation
      error: errorSummary,
    };
  }
  
  /**
   * Update all tasks matching a filter
   * Uses where.window to filter and patch to specify what to update
   */
  private async updateAllTasks(taskService: any, args: TaskOperationArgs): Promise<TaskOperationResult> {
    const window = args.where?.window || 'all';
    const patch = args.patch || {};
    
    if (Object.keys(patch).length === 0) {
      return { success: false, error: 'No update fields specified in patch' };
    }
    
    // First, get all tasks matching the filter
    const getAllResult = await taskService.getAll({
      userPhone: this.userPhone,
      data: { window },
    });
    
    if (!getAllResult.success) {
      return { success: false, error: getAllResult.error || 'Failed to fetch tasks' };
    }
    
    // Extract tasks from response
    let tasks: any[] = [];
    if (Array.isArray(getAllResult.data)) {
      tasks = getAllResult.data;
    } else if (getAllResult.data?.tasks && Array.isArray(getAllResult.data.tasks)) {
      tasks = getAllResult.data.tasks;
    }
    
    if (tasks.length === 0) {
      return { success: true, data: { updated: 0, tasks: [] } };
    }
    
    // Update each task
    const updated: any[] = [];
    const errors: any[] = [];
    
    for (const task of tasks) {
      const updateResult = await taskService.update({
        userPhone: this.userPhone,
        id: task.id,
        data: patch,
      });
      
      if (updateResult.success) {
        updated.push(updateResult.data || task);
      } else {
        errors.push({ task: task.text, error: updateResult.error });
      }
    }
    
    return {
      success: errors.length === 0,
      data: { 
        updated: updated.length, 
        tasks: updated,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  }
}
