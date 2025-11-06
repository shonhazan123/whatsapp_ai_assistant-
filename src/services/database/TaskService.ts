import { CreateMultipleRequest, CreateRequest, DeleteRequest, GetRequest, IResponse, UpdateRequest } from '../../core/types/AgentTypes';
import { BulkPatch, TaskFilter } from '../../core/types/Filters';
import { SQLCompiler } from '../../utils/SQLCompiler';
import { logger } from '../../utils/logger';
import { BaseService, DuplicateEntryError } from './BaseService';

export interface ReminderRecurrence {
  type: 'daily' | 'weekly' | 'monthly';
  time: string; // "08:00" format HH:mm
  days?: number[]; // For weekly: [0-6] where 0=Sunday, 6=Saturday
  dayOfMonth?: number; // For monthly: 1-31
  until?: string; // Optional ISO date string
  timezone?: string; // Optional timezone override
}

export interface Task {
  id: string;
  user_id: string;
  text: string;
  category?: string;
  due_date?: string;
  reminder?: string; // INTERVAL string for one-time reminders
  reminder_recurrence?: ReminderRecurrence | null;
  next_reminder_at?: string | null;
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
  reminder?: string; // INTERVAL string for one-time reminders
  reminderRecurrence?: ReminderRecurrence; // For recurring reminders
}

export interface UpdateTaskRequest {
  text?: string;
  category?: string;
  dueDate?: string;
  reminder?: string;
  reminderRecurrence?: ReminderRecurrence | null; // null to remove recurring reminder
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

  /**
   * Validate reminder fields - ensure only one reminder type is set
   */
  private validateReminderFields(data: any): string | null {
    const hasOneTimeReminder = (data.dueDate && data.reminder !== undefined) || data.reminder !== undefined;
    const hasRecurringReminder = data.reminderRecurrence !== undefined && data.reminderRecurrence !== null;

    if (hasOneTimeReminder && hasRecurringReminder) {
      return 'Cannot have both one-time reminder (dueDate+reminder) and recurring reminder (reminderRecurrence). Choose one.';
    }

    if (hasRecurringReminder && data.dueDate) {
      return 'Recurring reminders cannot have a dueDate. Remove dueDate when creating a recurring reminder.';
    }

    if (hasRecurringReminder && data.reminder) {
      return 'Recurring reminders cannot have a reminder interval. Remove reminder when creating a recurring reminder.';
    }

    return null;
  }

  /**
   * Calculate default reminder (30 minutes) if not specified
   */
  private calculateDefaultReminder(dueDate?: string): string | null {
    if (dueDate) {
      return '30 minutes';
    }
    return null;
  }

  /**
   * Calculate next_reminder_at for one-time reminders
   * Formula: next_reminder_at = due_date - reminder_interval
   * @param dueDate - ISO date string
   * @param reminderInterval - PostgreSQL INTERVAL string (e.g., "30 minutes", "2 hours", "1 day")
   * @returns ISO date string
   */
  private calculateOneTimeReminderAt(dueDate: string, reminderInterval: string): string {
    // Parse the due date
    const due = new Date(dueDate);
    if (isNaN(due.getTime())) {
      throw new Error('Invalid due date format');
    }

    // Parse reminder interval
    // PostgreSQL INTERVAL format examples: "30 minutes", "2 hours", "1 day", "30 mins"
    const intervalLower = reminderInterval.toLowerCase().trim();
    
    // Extract number and unit
    const match = intervalLower.match(/^(\d+)\s+(second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)$/i);
    
    if (!match) {
      throw new Error(`Invalid reminder interval format: "${reminderInterval}"`);
    }

    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    // Calculate milliseconds to subtract
    let millisecondsToSubtract = 0;
    
    switch (unit) {
      case 'second':
      case 'seconds':
        millisecondsToSubtract = amount * 1000;
        break;
      case 'minute':
      case 'minutes':
        millisecondsToSubtract = amount * 60 * 1000;
        break;
      case 'hour':
      case 'hours':
        millisecondsToSubtract = amount * 60 * 60 * 1000;
        break;
      case 'day':
      case 'days':
        millisecondsToSubtract = amount * 24 * 60 * 60 * 1000;
        break;
      case 'week':
      case 'weeks':
        millisecondsToSubtract = amount * 7 * 24 * 60 * 60 * 1000;
        break;
      case 'month':
      case 'months':
        // Approximate: 30 days per month
        millisecondsToSubtract = amount * 30 * 24 * 60 * 60 * 1000;
        break;
      case 'year':
      case 'years':
        // Approximate: 365 days per year
        millisecondsToSubtract = amount * 365 * 24 * 60 * 60 * 1000;
        break;
      default:
        throw new Error(`Unsupported time unit: "${unit}"`);
    }

    // Subtract interval from due date
    const nextReminderDate = new Date(due.getTime() - millisecondsToSubtract);
    
    return nextReminderDate.toISOString();
  }

  /**
   * Calculate next reminder time from recurrence pattern
   */
  private calculateNextReminderAt(recurrence: ReminderRecurrence, currentTime?: Date): string {
    const now = currentTime || new Date();
    const timezone = recurrence.timezone || 'Asia/Jerusalem';
    
    // Parse time string (HH:mm)
    const [hours, minutes] = recurrence.time.split(':').map(Number);
    
    let nextDate = new Date(now);
    
    // Set time
    nextDate.setHours(hours, minutes, 0, 0);
    
    switch (recurrence.type) {
      case 'daily': {
        // If time has passed today, set for tomorrow
        if (nextDate <= now) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;
      }
      
      case 'weekly': {
        if (!recurrence.days || recurrence.days.length === 0) {
          throw new Error('Weekly recurrence requires days array');
        }
        
        // Find next occurrence day
        const currentDay = now.getDay(); // 0=Sunday, 6=Saturday
        let daysToAdd = 0;
        let found = false;
        
        // Check next 7 days
        for (let i = 0; i < 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (recurrence.days.includes(checkDay)) {
            nextDate.setDate(now.getDate() + i);
            daysToAdd = i;
            found = true;
            break;
          }
        }
        
        if (!found) {
          // Next week
          const firstDay = Math.min(...recurrence.days);
          daysToAdd = 7 - currentDay + firstDay;
          nextDate.setDate(now.getDate() + daysToAdd);
        } else {
          // If time has passed on the found day, set for next week
          if (daysToAdd === 0 && nextDate <= now) {
            daysToAdd = 7;
            nextDate.setDate(now.getDate() + daysToAdd);
          }
        }
        break;
      }
      
      case 'monthly': {
        if (!recurrence.dayOfMonth) {
          throw new Error('Monthly recurrence requires dayOfMonth');
        }
        
        // Set day of month
        const maxDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const dayToSet = Math.min(recurrence.dayOfMonth, maxDay);
        nextDate.setDate(dayToSet);
        nextDate.setMonth(now.getMonth());
        
        // If time/date has passed this month, set for next month
        if (nextDate <= now) {
          nextDate.setMonth(now.getMonth() + 1);
          // Recalculate max day for next month
          const nextMaxDay = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
          const nextDayToSet = Math.min(recurrence.dayOfMonth, nextMaxDay);
          nextDate.setDate(nextDayToSet);
        }
        break;
      }
    }
    
    // Check until date
    if (recurrence.until) {
      const untilDate = new Date(recurrence.until);
      if (nextDate > untilDate) {
        throw new Error('Next reminder time exceeds until date');
      }
    }
    
    return nextDate.toISOString();
  }

  async create(request: CreateRequest): Promise<IResponse> {
    let userId: string | undefined;
    let data: any;
    try {
      userId = await this.ensureUserExists(request.userPhone);
      data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['text']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      // Validate reminder fields
      const reminderValidation = this.validateReminderFields(data);
      if (reminderValidation) {
        return this.createErrorResponse(reminderValidation);
      }

      // Handle reminders
      let reminder: string | null = data.reminder || null;
      let reminderRecurrence: any = null;
      let nextReminderAt: string | null = null;

      // One-time reminder: calculate default if needed
      if (data.dueDate && !data.reminder && !data.reminderRecurrence) {
        reminder = this.calculateDefaultReminder(data.dueDate);
      }

      // One-time reminder: calculate next_reminder_at
      if (data.dueDate && reminder && !data.reminderRecurrence) {
        try {
          nextReminderAt = this.calculateOneTimeReminderAt(data.dueDate, reminder);
        } catch (error) {
          return this.createErrorResponse(
            error instanceof Error ? error.message : 'Failed to calculate next reminder time'
          );
        }
      }

      // Recurring reminder: calculate next_reminder_at
      if (data.reminderRecurrence) {
        reminderRecurrence = JSON.stringify(data.reminderRecurrence);
        try {
          nextReminderAt = this.calculateNextReminderAt(data.reminderRecurrence);
        } catch (error) {
          return this.createErrorResponse(
            error instanceof Error ? error.message : 'Failed to calculate next reminder time'
          );
        }
      }

      const result = await this.executeSingleQuery<Task>(
        `INSERT INTO tasks (user_id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at`,
        [
          userId,
          data.text,
          data.category || null,
          data.dueDate || null,
          reminder,
          reminderRecurrence,
          nextReminderAt
        ]
      );

      // Parse reminder_recurrence JSONB if present
      if (result && result.reminder_recurrence && typeof result.reminder_recurrence === 'string') {
        result.reminder_recurrence = JSON.parse(result.reminder_recurrence);
      }

      this.logger.info(`✅ Task created: "${data.text}" for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Task created successfully');
    } catch (error) {
      if (error instanceof DuplicateEntryError) {
        this.logger.info(`Duplicate task name detected for user ${userId ?? 'unknown'}: ${data?.text}`);
        return this.createErrorResponse('Task name already exists. Please choose a different name.');
      }
      this.logger.error('Error creating task:', error);
      return this.createErrorResponse('Failed to create task');
    }
  }

  async createMultiple(request: CreateMultipleRequest): Promise<IResponse> {
    let userId: string | undefined;
    try {
      userId = await this.ensureUserExists(request.userPhone);
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

          // Validate reminder fields
          const reminderValidation = this.validateReminderFields(sanitizedItem);
          if (reminderValidation) {
            errors.push({ item, error: reminderValidation });
            continue;
          }

          // Handle reminders (same logic as create)
          let reminder: string | null = sanitizedItem.reminder || null;
          let reminderRecurrence: any = null;
          let nextReminderAt: string | null = null;

          if (sanitizedItem.dueDate && !sanitizedItem.reminder && !sanitizedItem.reminderRecurrence) {
            reminder = this.calculateDefaultReminder(sanitizedItem.dueDate);
          }
          
          // One-time reminder: calculate next_reminder_at
          if (sanitizedItem.dueDate && reminder && !sanitizedItem.reminderRecurrence) {
            try {
              nextReminderAt = this.calculateOneTimeReminderAt(sanitizedItem.dueDate, reminder);
            } catch (error) {
              errors.push({
                item,
                error: error instanceof Error ? error.message : 'Failed to calculate next reminder time'
              });
              continue;
            }
          }

          // Recurring reminder: calculate next_reminder_at
          if (sanitizedItem.reminderRecurrence) {
            reminderRecurrence = JSON.stringify(sanitizedItem.reminderRecurrence);
            try {
              nextReminderAt = this.calculateNextReminderAt(sanitizedItem.reminderRecurrence);
            } catch (error) {
              errors.push({
                item,
                error: error instanceof Error ? error.message : 'Failed to calculate next reminder time'
              });
              continue;
            }
          }

          const result = await this.executeSingleQuery<Task>(
            `INSERT INTO tasks (user_id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at`,
            [
              userId,
              sanitizedItem.text,
              sanitizedItem.category || null,
              sanitizedItem.dueDate || null,
              reminder,
              reminderRecurrence,
              nextReminderAt
            ]
          );

          // Parse reminder_recurrence JSONB if present
          if (result && result.reminder_recurrence && typeof result.reminder_recurrence === 'string') {
            result.reminder_recurrence = JSON.parse(result.reminder_recurrence);
          }

          results.push(result);
        } catch (error) {
          if (error instanceof DuplicateEntryError) {
            errors.push({ item, error: 'Task name already exists. Please choose a different name.' });
            continue;
          }
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
      if (error instanceof DuplicateEntryError) {
        this.logger.info(`Duplicate task name detected during bulk create for user ${request.userPhone}`);
        return this.createErrorResponse('Task name already exists. Please choose a different name.');
      }
      this.logger.error('Error creating multiple tasks:', error);
      return this.createErrorResponse('Failed to create tasks');
    }
  }

  async getById(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      const task = await this.executeSingleQuery<Task>(
        `SELECT t.id, t.text, t.category, t.due_date, t.reminder, t.reminder_recurrence, t.next_reminder_at, t.completed, t.created_at,
                COALESCE(
                  json_agg(
                    json_build_object('id', s.id, 'text', s.text, 'completed', s.completed, 'created_at', s.created_at)
                  ) FILTER (WHERE s.id IS NOT NULL),
                  '[]'
                ) as subtasks
         FROM tasks t
         LEFT JOIN subtasks s ON s.task_id = t.id
         WHERE t.user_id = $1 AND t.id = $2
         GROUP BY t.id, t.reminder, t.reminder_recurrence, t.next_reminder_at`,
        [userId, request.id]
      );

      // Parse reminder_recurrence JSONB if present
      if (task && task.reminder_recurrence && typeof task.reminder_recurrence === 'string') {
        task.reminder_recurrence = JSON.parse(task.reminder_recurrence);
      }

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
        SELECT t.id, t.text, t.category, t.due_date, t.reminder, t.reminder_recurrence, t.next_reminder_at, t.completed, t.created_at,
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

      query += ` GROUP BY t.id, t.reminder, t.reminder_recurrence, t.next_reminder_at ORDER BY t.created_at DESC`;

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

      // Parse reminder_recurrence JSONB for all tasks
      tasks.forEach((task: Task) => {
        if (task.reminder_recurrence && typeof task.reminder_recurrence === 'string') {
          task.reminder_recurrence = JSON.parse(task.reminder_recurrence);
        }
      });

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

      // Validate reminder fields
      const reminderValidation = this.validateReminderFields(data);
      if (reminderValidation) {
        return this.createErrorResponse(reminderValidation);
      }

      // Fetch current task to calculate next_reminder_at for one-time reminders
      const currentTask = await this.executeSingleQuery<Task>(
        'SELECT due_date, reminder, reminder_recurrence FROM tasks WHERE user_id = $1 AND id = $2',
        [userId, request.id]
      );

      if (!currentTask) {
        return this.createErrorResponse('Task not found');
      }

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

      // Handle reminder updates
      if (data.reminder !== undefined) {
        paramCount++;
        updateFields.push(`reminder = $${paramCount}`);
        params.push(data.reminder || null);
        // If clearing reminder, also clear reminder_recurrence and next_reminder_at
        if (!data.reminder) {
          paramCount++;
          updateFields.push(`reminder_recurrence = $${paramCount}`);
          params.push(null);
          paramCount++;
          updateFields.push(`next_reminder_at = $${paramCount}`);
          params.push(null);
        }
      }

      if (data.reminderRecurrence !== undefined) {
        if (data.reminderRecurrence === null) {
          // Remove recurring reminder
          paramCount++;
          updateFields.push(`reminder_recurrence = $${paramCount}`);
          params.push(null);
          paramCount++;
          updateFields.push(`next_reminder_at = $${paramCount}`);
          params.push(null);
          paramCount++;
          updateFields.push(`reminder = $${paramCount}`);
          params.push(null);
        } else {
          // Update recurring reminder
          paramCount++;
          updateFields.push(`reminder_recurrence = $${paramCount}::jsonb`);
          params.push(JSON.stringify(data.reminderRecurrence));
          
          // Recalculate next_reminder_at
          try {
            const nextReminderAt = this.calculateNextReminderAt(data.reminderRecurrence);
            paramCount++;
            updateFields.push(`next_reminder_at = $${paramCount}`);
            params.push(nextReminderAt);
          } catch (error) {
            return this.createErrorResponse(
              error instanceof Error ? error.message : 'Failed to calculate next reminder time'
            );
          }
          
          // Clear reminder if was set
          paramCount++;
          updateFields.push(`reminder = $${paramCount}`);
          params.push(null);
        }
      }

      if (data.completed !== undefined) {
        paramCount++;
        updateFields.push(`completed = $${paramCount}`);
        params.push(data.completed);
      }

      // Recalculate next_reminder_at for one-time reminders
      // Check if we need to recalculate based on changes to dueDate or reminder
      const dueDateChanged = data.dueDate !== undefined;
      const reminderChanged = data.reminder !== undefined;
      const shouldRecalcOneTime = dueDateChanged || reminderChanged;

      if (shouldRecalcOneTime) {
        // Determine the actual values after update
        const finalDueDate = data.dueDate !== undefined ? data.dueDate : currentTask.due_date;
        const finalReminder = data.reminder !== undefined ? data.reminder : currentTask.reminder;
        
        // Only recalculate if both dueDate and reminder are present (one-time reminder)
        if (finalDueDate && finalReminder && !data.reminderRecurrence) {
          try {
            const nextReminderAt = this.calculateOneTimeReminderAt(finalDueDate, finalReminder);
            // Check if next_reminder_at is already in the update fields
            const alreadyIncluded = updateFields.some(field => field.includes('next_reminder_at'));
            if (!alreadyIncluded) {
              paramCount++;
              updateFields.push(`next_reminder_at = $${paramCount}`);
              params.push(nextReminderAt);
            }
          } catch (error) {
            // If calculation fails, clear next_reminder_at
            const alreadyIncluded = updateFields.some(field => field.includes('next_reminder_at'));
            if (!alreadyIncluded) {
              paramCount++;
              updateFields.push(`next_reminder_at = $${paramCount}`);
              params.push(null);
            }
          }
        }
      }

      if (updateFields.length === 0) {
        return this.createErrorResponse('No fields to update');
      }

      const result = await this.executeSingleQuery<Task>(
        `UPDATE tasks 
         SET ${updateFields.join(', ')}
         WHERE user_id = $1 AND id = $2
         RETURNING id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at`,
        params
      );

      if (!result) {
        return this.createErrorResponse('Task not found');
      }

      // Parse reminder_recurrence JSONB if present
      if (result.reminder_recurrence && typeof result.reminder_recurrence === 'string') {
        result.reminder_recurrence = JSON.parse(result.reminder_recurrence);
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
