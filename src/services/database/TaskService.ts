import { CreateMultipleRequest, CreateRequest, DeleteRequest, GetRequest, IResponse, UpdateRequest } from '../../core/types/AgentTypes';
import { BulkPatch, TaskFilter } from '../../core/types/Filters';
import { SQLCompiler } from '../../utils/SQLCompiler';
import { logger } from '../../utils/logger';
import { BaseService } from './BaseService';

export interface Task {
  id: string;
  user_id: string;
  text: string;
  category?: string;
  due_date?: string;
  completed: boolean;
  created_at: string;
  subtasks?: Subtask[];
}

export interface Subtask {
  id: string;
  task_id: string;
  text: string;
  completed: boolean;
  created_at: string;
}

export interface CreateTaskRequest {
  text: string;
  category?: string;
  dueDate?: string;
}

export interface UpdateTaskRequest {
  text?: string;
  category?: string;
  dueDate?: string;
  completed?: boolean;
}

export interface TaskFilters {
  completed?: boolean;
  category?: string;
  dueDateFrom?: string;
  dueDateTo?: string;
}

export class TaskService extends BaseService {
  constructor(loggerInstance: any = logger) {
    super(loggerInstance);
  }

  async create(request: CreateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['text']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const result = await this.executeSingleQuery<Task>(
        `INSERT INTO tasks (user_id, text, category, due_date) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, text, category, due_date, completed, created_at`,
        [userId, data.text, data.category || null, data.dueDate || null]
      );

      this.logger.info(`✅ Task created: "${data.text}" for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Task created successfully');
    } catch (error) {
      this.logger.error('Error creating task:', error);
      return this.createErrorResponse('Failed to create task');
    }
  }

  async createMultiple(request: CreateMultipleRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const results = [];
      const errors = [];

      for (const item of request.items) {
        try {
          const sanitizedItem = this.sanitizeInput(item);
          const validation = this.validateRequiredFields(sanitizedItem, ['text']);
          
          if (validation) {
            errors.push({ item, error: validation });
            continue;
          }

          const result = await this.executeSingleQuery<Task>(
            `INSERT INTO tasks (user_id, text, category, due_date) 
             VALUES ($1, $2, $3, $4) 
             RETURNING id, text, category, due_date, completed, created_at`,
            [userId, sanitizedItem.text, sanitizedItem.category || null, sanitizedItem.dueDate || null]
          );

          results.push(result);
        } catch (error) {
          errors.push({ item, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      this.logger.info(`✅ Created ${results.length} tasks for user: ${userId}`);
      
      return this.createSuccessResponse({
        created: results,
        errors: errors.length > 0 ? errors : undefined,
        count: results.length
      }, `Created ${results.length} tasks`);
    } catch (error) {
      this.logger.error('Error creating multiple tasks:', error);
      return this.createErrorResponse('Failed to create tasks');
    }
  }

  async getById(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      const task = await this.executeSingleQuery<Task>(
        `SELECT t.id, t.text, t.category, t.due_date, t.completed, t.created_at,
                COALESCE(
                  json_agg(
                    json_build_object('id', s.id, 'text', s.text, 'completed', s.completed, 'created_at', s.created_at)
                  ) FILTER (WHERE s.id IS NOT NULL),
                  '[]'
                ) as subtasks
         FROM tasks t
         LEFT JOIN subtasks s ON s.task_id = t.id
         WHERE t.user_id = $1 AND t.id = $2
         GROUP BY t.id`,
        [userId, request.id]
      );

      if (!task) {
        return this.createErrorResponse('Task not found');
      }

      return this.createSuccessResponse(task);
    } catch (error) {
      this.logger.error('Error getting task by ID:', error);
      return this.createErrorResponse('Failed to get task');
    }
  }

  async getAll(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      let query = `
        SELECT t.id, t.text, t.category, t.due_date, t.completed, t.created_at,
               COALESCE(
                 json_agg(
                   json_build_object('id', s.id, 'text', s.text, 'completed', s.completed, 'created_at', s.created_at)
                 ) FILTER (WHERE s.id IS NOT NULL),
                 '[]'
               ) as subtasks
        FROM tasks t
        LEFT JOIN subtasks s ON s.task_id = t.id
        WHERE t.user_id = $1
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Apply filters
      if (request.filters) {
        if (request.filters.completed !== undefined) {
          paramCount++;
          query += ` AND t.completed = $${paramCount}`;
          params.push(request.filters.completed);
        }

        if (request.filters.category) {
          paramCount++;
          query += ` AND t.category = $${paramCount}`;
          params.push(request.filters.category);
        }

        if (request.filters.dueDateFrom) {
          paramCount++;
          query += ` AND t.due_date >= $${paramCount}`;
          params.push(request.filters.dueDateFrom);
        }

        if (request.filters.dueDateTo) {
          paramCount++;
          query += ` AND t.due_date <= $${paramCount}`;
          params.push(request.filters.dueDateTo);
        }
      }

      query += ` GROUP BY t.id ORDER BY t.created_at DESC`;

      if (request.limit) {
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(request.limit);
      }

      if (request.offset) {
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(request.offset);
      }

      const tasks = await this.executeQuery<Task>(query, params);

      return this.createSuccessResponse({
        tasks,
        count: tasks.length
      });
    } catch (error) {
      this.logger.error('Error getting tasks:', error);
      return this.createErrorResponse('Failed to get tasks');
    }
  }

  async update(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const updateFields = [];
      const params: any[] = [userId, request.id];
      let paramCount = 2;

      if (data.text !== undefined) {
        paramCount++;
        updateFields.push(`text = $${paramCount}`);
        params.push(data.text);
      }

      if (data.category !== undefined) {
        paramCount++;
        updateFields.push(`category = $${paramCount}`);
        params.push(data.category);
      }

      if (data.dueDate !== undefined) {
        paramCount++;
        updateFields.push(`due_date = $${paramCount}`);
        params.push(data.dueDate);
      }

      if (data.completed !== undefined) {
        paramCount++;
        updateFields.push(`completed = $${paramCount}`);
        params.push(data.completed);
      }

      if (updateFields.length === 0) {
        return this.createErrorResponse('No fields to update');
      }

      const result = await this.executeSingleQuery<Task>(
        `UPDATE tasks 
         SET ${updateFields.join(', ')}
         WHERE user_id = $1 AND id = $2
         RETURNING id, text, category, due_date, completed, created_at`,
        params
      );

      if (!result) {
        return this.createErrorResponse('Task not found');
      }

      this.logger.info(`✅ Task updated: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Task updated successfully');
    } catch (error) {
      this.logger.error('Error updating task:', error);
      return this.createErrorResponse('Failed to update task');
    }
  }

  async delete(request: DeleteRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);

      const result = await this.executeSingleQuery<Task>(
        `DELETE FROM tasks 
         WHERE user_id = $1 AND id = $2
         RETURNING id, text`,
        [userId, request.id]
      );

      if (!result) {
        return this.createErrorResponse('Task not found');
      }

      this.logger.info(`✅ Task deleted: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Task deleted successfully');
    } catch (error) {
      this.logger.error('Error deleting task:', error);
      return this.createErrorResponse('Failed to delete task');
    }
  }

  async complete(request: UpdateRequest): Promise<IResponse> {
    return this.update({
      ...request,
      data: { ...request.data, completed: true }
    });
  }

  async addSubtask(request: CreateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['taskId', 'text']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      // Verify task belongs to user
      const task = await this.executeSingleQuery<Task>(
        'SELECT id FROM tasks WHERE user_id = $1 AND id = $2',
        [userId, data.taskId]
      );

      if (!task) {
        return this.createErrorResponse('Task not found');
      }

      const result = await this.executeSingleQuery<Subtask>(
        `INSERT INTO subtasks (task_id, text) 
         VALUES ($1, $2) 
         RETURNING id, task_id, text, completed, created_at`,
        [data.taskId, data.text]
      );

      this.logger.info(`✅ Subtask created: "${data.text}" for task: ${data.taskId}`);
      
      return this.createSuccessResponse(result, 'Subtask created successfully');
    } catch (error) {
      this.logger.error('Error creating subtask:', error);
      return this.createErrorResponse('Failed to create subtask');
    }
  }

  /**
   * Delete multiple tasks matching filter conditions
   */
  async deleteAll(userPhone: string, filter: TaskFilter, preview = false): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(userPhone);

      // Compile WHERE clause using SQLCompiler
      const { whereSql, params } = SQLCompiler.compileWhere('tasks', userId, filter);

      // Safety check: refuse empty where unless preview
      if (!whereSql.trim() && !preview) {
        return this.createErrorResponse(
          'Bulk delete requires filter conditions. Set preview=true to review affected rows.'
        );
      }

      let query: string;
      
      if (preview) {
        // Preview mode: SELECT instead of DELETE
        query = `SELECT t.id, t.text, t.category, t.due_date, t.completed, t.created_at 
                 FROM tasks t 
                 WHERE ${whereSql}`;
      } else {
        // Execute DELETE with RETURNING
        query = `DELETE FROM tasks t 
                 WHERE ${whereSql}
                 RETURNING t.id, t.text, t.category, t.due_date, t.completed, t.created_at`;
      }

      const results = await this.executeQuery<Task>(query, params);

      this.logger.info(`✅ ${preview ? 'Preview' : 'Deleted'} ${results.length} tasks for user: ${userId}`);

      return this.createSuccessResponse({
        tasks: results,
        count: results.length,
        preview
      }, preview ? `Preview: ${results.length} tasks would be deleted` : `${results.length} tasks deleted`);
    } catch (error) {
      this.logger.error('Error in bulk delete tasks:', error);
      return this.createErrorResponse('Failed to delete tasks');
    }
  }

  /**
   * Update multiple tasks matching filter conditions
   */
  async updateAll(userPhone: string, filter: TaskFilter, patch: BulkPatch, preview = false): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(userPhone);
      const allowedColumns = SQLCompiler.getAllowedColumns('tasks');

      // Compile SET clause
      const { setSql, setParams } = SQLCompiler.compileSet(patch, allowedColumns, 1);
      
      if (!setSql) {
        return this.createErrorResponse('No valid fields to update');
      }

      // Compile WHERE clause
      const { whereSql, params } = SQLCompiler.compileWhere('tasks', userId, filter);

      // Safety check: refuse empty where unless preview
      if (!whereSql.trim() && !preview) {
        return this.createErrorResponse(
          'Bulk update requires filter conditions. Set preview=true to review affected rows.'
        );
      }

      // Combine params: setParams first, then where params
      const allParams = [...setParams, ...params];

      let query: string;
      
      if (preview) {
        // Preview mode: SELECT matching rows
        query = `SELECT t.id, t.text, t.category, t.due_date, t.completed, t.created_at 
                 FROM tasks t 
                 WHERE ${whereSql}`;
      } else {
        // Execute UPDATE with RETURNING
        query = `UPDATE tasks t 
                 SET ${setSql}
                 WHERE ${whereSql}
                 RETURNING t.id, t.text, t.category, t.due_date, t.completed, t.created_at`;
      }

      const results = await this.executeQuery<Task>(query, preview ? params : allParams);

      this.logger.info(`✅ ${preview ? 'Preview' : 'Updated'} ${results.length} tasks for user: ${userId}`);

      return this.createSuccessResponse({
        tasks: results,
        count: results.length,
        preview
      }, preview ? `Preview: ${results.length} tasks would be updated` : `${results.length} tasks updated`);
    } catch (error) {
      this.logger.error('Error in bulk update tasks:', error);
      return this.createErrorResponse('Failed to update tasks');
    }
  }

  /**
   * Mark multiple tasks as completed matching filter conditions
   */
  async completeAll(userPhone: string, filter: TaskFilter, preview = false): Promise<IResponse> {
    return this.updateAll(userPhone, filter, { completed: true }, preview);
  }
}
