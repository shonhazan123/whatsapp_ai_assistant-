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
    reminderRecurrence?: string;
  };
  tasks?: Array<{
    text: string;
    category?: string;
    dueDate?: string;
    reminder?: string;
    reminderRecurrence?: ReminderRecurrence;
  }>;
  updates?: Array<{
    text: string;
    reminderDetails?: any;
  }>;
  where?: {
    window?: string;
    reminderRecurrence?: string;
  };
  preview?: boolean;
  subtaskText?: string;
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
    const result = await taskService.getAll({
      userPhone: this.userPhone,
      data: args.filters,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
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
}
