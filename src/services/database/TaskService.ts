import { CreateMultipleRequest, CreateRequest, DeleteRequest, GetRequest, IResponse, UpdateRequest } from '../../core/types/AgentTypes';
import { BulkPatch, TaskFilter } from '../../core/types/Filters';
import { SQLCompiler } from '../../utils/SQLCompiler';
import { logger } from '../../utils/logger';
import { BaseService, DuplicateEntryError, InvalidIdentifierError } from './BaseService';

export interface ReminderRecurrence {
  type: 'daily' | 'weekly' | 'monthly' | 'nudge';
  time?: string; // "08:00" format HH:mm (not used for nudge)
  days?: number[]; // For weekly: [0-6] where 0=Sunday, 6=Saturday
  dayOfMonth?: number; // For monthly: 1-31
  interval?: string; // For nudge: "10 minutes", "1 hour", "2 hours"
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

  private calculateDefaultReminder(dueDate?: string): string | null {
    if (dueDate) {
      return '30 minutes';
    }
    return null;
  }

  private normalizeReminderPayload(
    data: any,
    options: { allowDefaultReminder?: boolean } = {}
  ): {
    dueDate?: string;
    reminder?: string | null;
    reminderRecurrence?: ReminderRecurrence | null;
    validationError?: string | null;
    nextReminderAt?: string | null;
  } {
    const result: {
      dueDate?: string;
      reminder?: string | null;
      reminderRecurrence?: ReminderRecurrence | null;
      validationError?: string | null;
      nextReminderAt?: string | null;
    } = {
      dueDate: data.dueDate,
      reminder: data.reminder ?? null,
      reminderRecurrence: data.reminderRecurrence ?? null
    };

    const hasOneTimeReminder =
      (result.dueDate && result.reminder !== undefined && result.reminder !== null) ||
      (result.reminder !== undefined && result.reminder !== null);
    const hasRecurringReminder =
      result.reminderRecurrence !== undefined && result.reminderRecurrence !== null;

    if (hasOneTimeReminder && hasRecurringReminder) {
      result.validationError =
        'Cannot have both one-time reminder (dueDate+reminder) and recurring reminder (reminderRecurrence). Choose one.';
      return result;
    }

    // Allow dueDate with reminderRecurrence ONLY for nudge type (nudge starts from that time)
    if (hasRecurringReminder && result.dueDate) {
      const recurrenceType = typeof result.reminderRecurrence === 'string' 
        ? JSON.parse(result.reminderRecurrence).type 
        : result.reminderRecurrence?.type;
      
      if (recurrenceType !== 'nudge') {
        result.validationError =
          'Only nudge-type reminders can have a dueDate. Daily/weekly/monthly reminders are standalone and cannot have a dueDate.';
        return result;
      }
    }

    if (hasRecurringReminder && result.reminder) {
      result.validationError =
        'Recurring reminders cannot have a reminder interval. Remove reminder when creating a recurring reminder.';
      return result;
    }

    if (
      options.allowDefaultReminder !== false &&
      !hasOneTimeReminder &&
      !hasRecurringReminder &&
      result.dueDate
    ) {
      result.reminder = this.calculateDefaultReminder(result.dueDate);
    }

    try {
      if (result.dueDate && result.reminder && typeof result.reminder === 'string' && !hasRecurringReminder) {
        result.nextReminderAt = this.calculateOneTimeReminderAt(result.dueDate, result.reminder);
      } else if (result.reminderRecurrence) {
        result.nextReminderAt = this.calculateNextReminderAt(result.reminderRecurrence);
      } else {
        result.nextReminderAt = null;
      }
    } catch (error) {
      result.validationError =
        error instanceof Error ? error.message : 'Failed to calculate next reminder time';
    }

    return result;
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
    
    let nextDate = new Date(now);
    
    switch (recurrence.type) {
      case 'nudge': {
        // Nudge: repeat after specified interval (default 10 minutes)
        const interval = recurrence.interval || '10 minutes';
        const minutes = this.parseIntervalToMinutes(interval);
        
        if (minutes < 1) {
          throw new Error('Nudge interval must be at least 1 minute');
        }
        
        // Round to start of current minute (strip seconds/milliseconds)
        now.setSeconds(0, 0);
        nextDate.setSeconds(0, 0);
        
        // Add interval to current time
        nextDate.setMinutes(now.getMinutes() + minutes);
        break;
      }
      
      case 'daily': {
        // Parse time string (HH:mm) - required for daily/weekly/monthly
        if (!recurrence.time) {
          throw new Error('Daily recurrence requires time');
        }
        const [hours, minutes] = recurrence.time.split(':').map(Number);
        nextDate.setHours(hours, minutes, 0, 0);
        // If time has passed today, set for tomorrow
        if (nextDate <= now) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;
      }
      
      case 'weekly': {
        if (!recurrence.time) {
          throw new Error('Weekly recurrence requires time');
        }
        if (!recurrence.days || recurrence.days.length === 0) {
          throw new Error('Weekly recurrence requires days array');
        }
        
        const [hours, minutes] = recurrence.time.split(':').map(Number);
        nextDate.setHours(hours, minutes, 0, 0);
        
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
        if (!recurrence.time) {
          throw new Error('Monthly recurrence requires time');
        }
        if (!recurrence.dayOfMonth) {
          throw new Error('Monthly recurrence requires dayOfMonth');
        }
        
        const [hours, minutes] = recurrence.time.split(':').map(Number);
        nextDate.setHours(hours, minutes, 0, 0);
        
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

  /**
   * Parse interval string to minutes
   * Examples: "10 minutes" → 10, "1 hour" → 60, "2 hours" → 120
   */
  private parseIntervalToMinutes(interval: string): number {
    const normalizedInterval = interval.toLowerCase().trim();
    
    // Match patterns like "10 minutes", "1 hour", "2 hours"
    const minuteMatch = normalizedInterval.match(/^(\d+)\s*(minute|minutes|min|mins|דקות|דקה)$/);
    if (minuteMatch) {
      return parseInt(minuteMatch[1], 10);
    }
    
    const hourMatch = normalizedInterval.match(/^(\d+)\s*(hour|hours|hr|hrs|שעות|שעה)$/);
    if (hourMatch) {
      return parseInt(hourMatch[1], 10) * 60;
    }
    
    // If no match, try to extract just the number and assume minutes
    const numberMatch = normalizedInterval.match(/^(\d+)$/);
    if (numberMatch) {
      return parseInt(numberMatch[1], 10);
    }
    
    throw new Error(`Invalid interval format: ${interval}. Use format like "10 minutes" or "1 hour"`);
  }

  async create(request: CreateRequest): Promise<IResponse> {
    let userId: string | undefined;
    let data: any;
    try {
      userId = await this.resolveUserId(request.userId, request.userPhone);
      data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['text']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const reminderPayload = this.normalizeReminderPayload(data);
      if (reminderPayload.validationError) {
        return this.createErrorResponse(reminderPayload.validationError);
      }

      const result = await this.executeSingleQuery<Task>(
        `INSERT INTO tasks (user_id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) 
         RETURNING id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at`,
        [
          userId,
          data.text,
          data.category || null,
          reminderPayload.dueDate || null,
          reminderPayload.reminder || null,
          reminderPayload.reminderRecurrence ? JSON.stringify(reminderPayload.reminderRecurrence) : null,
          reminderPayload.nextReminderAt || null
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
        return this.createErrorResponse(
          'There is already a task with this text. Ask me to update its reminder instead of creating a new one.'
        );
      }
      this.logger.error('Error creating task:', error);
      return this.createErrorResponse('Failed to create task');
    }
  }

  async createMultiple(request: CreateMultipleRequest): Promise<IResponse> {
    let userId: string | undefined;
    try {
      userId = await this.resolveUserId(request.userId, request.userPhone);
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

          const reminderPayload = this.normalizeReminderPayload(sanitizedItem);
          if (reminderPayload.validationError) {
            errors.push({ item, error: reminderPayload.validationError });
            continue;
          }

          const result = await this.executeSingleQuery<Task>(
            `INSERT INTO tasks (user_id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at`,
            [
              userId,
              sanitizedItem.text,
              sanitizedItem.category || null,
              reminderPayload.dueDate || null,
              reminderPayload.reminder || null,
              reminderPayload.reminderRecurrence ? JSON.stringify(reminderPayload.reminderRecurrence) : null,
              reminderPayload.nextReminderAt || null
            ]
          );

          // Parse reminder_recurrence JSONB if present
          if (result && result.reminder_recurrence && typeof result.reminder_recurrence === 'string') {
            result.reminder_recurrence = JSON.parse(result.reminder_recurrence);
          }

          results.push(result);
        } catch (error) {
          if (error instanceof DuplicateEntryError) {
            errors.push({
              item,
              error: 'One of these tasks already exists. Ask me to update its reminder instead of creating it again.'
            });
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
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      
      const task = await this.executeSingleQuery<Task>(
        `SELECT id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at
         FROM tasks
         WHERE user_id = $1 AND id = $2`,
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
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      
      let query = `
        SELECT id, text, category, due_date, reminder, reminder_recurrence, next_reminder_at, completed, created_at
        FROM tasks
        WHERE user_id = $1
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Apply filters
      if (request.filters) {
        if (request.filters.completed !== undefined) {
          paramCount++;
          query += ` AND completed = $${paramCount}`;
          params.push(request.filters.completed);
        }

        if (request.filters.category) {
          paramCount++;
          query += ` AND category = $${paramCount}`;
          params.push(request.filters.category);
        }

        if (request.filters.dueDateFrom) {
          paramCount++;
          query += ` AND due_date >= $${paramCount}`;
          params.push(request.filters.dueDateFrom);
        }

        if (request.filters.dueDateTo) {
          paramCount++;
          query += ` AND due_date <= $${paramCount}`;
          params.push(request.filters.dueDateTo);
        }
      }

      query += ` ORDER BY created_at DESC`;

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
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      const data = this.sanitizeInput(request.data);

      // Validate reminder fields
      const currentTask = await this.executeSingleQuery<Task>(
        'SELECT due_date, reminder, reminder_recurrence FROM tasks WHERE user_id = $1 AND id = $2',
        [userId, request.id]
      );

      if (!currentTask) {
        return this.createErrorResponse('Task not found');
      }

      const currentReminderRecurrence =
        typeof currentTask.reminder_recurrence === 'string'
          ? JSON.parse(currentTask.reminder_recurrence)
          : currentTask.reminder_recurrence;

      const reminderInput = {
        dueDate: data.dueDate !== undefined ? data.dueDate : currentTask.due_date || undefined,
        reminder: data.reminder !== undefined ? data.reminder : currentTask.reminder ?? undefined,
        reminderRecurrence:
          data.reminderRecurrence !== undefined
            ? data.reminderRecurrence
            : currentReminderRecurrence ?? undefined
      };

      const reminderPayload = this.normalizeReminderPayload(reminderInput, {
        allowDefaultReminder: false
      });

      if (reminderPayload.validationError) {
        return this.createErrorResponse(reminderPayload.validationError);
      }

      const updateFields: string[] = [];
      const params: any[] = [userId, request.id];
      let paramCount = 2;

      const pushField = (field: string, value: any) => {
        paramCount++;
        updateFields.push(`${field} = $${paramCount}`);
        params.push(value);
      };

      if (data.text !== undefined) {
        pushField('text', data.text);
      }

      if (data.category !== undefined) {
        pushField('category', data.category);
      }

      if (data.dueDate !== undefined) {
        pushField('due_date', reminderPayload.dueDate || null);
      }

      if (data.reminder !== undefined || data.dueDate !== undefined) {
        pushField('reminder', reminderPayload.reminder || null);
      }

      if (data.reminderRecurrence !== undefined) {
        pushField(
          'reminder_recurrence',
          reminderPayload.reminderRecurrence ? JSON.stringify(reminderPayload.reminderRecurrence) : null
        );
      }

      if (data.completed !== undefined) {
        pushField('completed', data.completed);
      }

      if (
        data.reminder !== undefined ||
        data.reminderRecurrence !== undefined ||
        data.dueDate !== undefined
      ) {
        pushField('next_reminder_at', reminderPayload.nextReminderAt || null);
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
      if (error instanceof InvalidIdentifierError) {
        this.logger.warn('Attempted to update task with invalid identifier', { detail: error.detail });
        return this.createErrorResponse(
          'I could not find that task. Mention it by the original task text so I can locate it.'
        );
      }
      this.logger.error('Error updating task:', error);
      return this.createErrorResponse('Failed to update task');
    }
  }

  async delete(request: DeleteRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);

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
      const userId = await this.resolveUserId(request.userId, request.userPhone);
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
      const userId = await this.resolveUserId(undefined, userPhone);

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
      const userId = await this.resolveUserId(undefined, userPhone);
      const allowedColumns = SQLCompiler.getAllowedColumns('tasks');

      const sanitizedPatch = this.sanitizeInput({ ...patch });

      if (sanitizedPatch.reminderDetails && typeof sanitizedPatch.reminderDetails === 'object') {
        const details = sanitizedPatch.reminderDetails;
        if (details.dueDate !== undefined) {
          sanitizedPatch.dueDate = details.dueDate;
        }
        if (details.reminder !== undefined) {
          sanitizedPatch.reminder = details.reminder;
        }
        if (details.reminderRecurrence !== undefined) {
          sanitizedPatch.reminderRecurrence = details.reminderRecurrence;
        }
        delete sanitizedPatch.reminderDetails;
      }

      const normalizedPatch: BulkPatch = {};

      if (sanitizedPatch.text !== undefined) {
        normalizedPatch.text = sanitizedPatch.text;
      }

      if (sanitizedPatch.category !== undefined) {
        normalizedPatch.category = sanitizedPatch.category;
      }

      const reminderFieldsProvided =
        sanitizedPatch.dueDate !== undefined ||
        sanitizedPatch.reminder !== undefined ||
        sanitizedPatch.reminderRecurrence !== undefined;

      if (reminderFieldsProvided) {
        const reminderPayload = this.normalizeReminderPayload(
          {
            dueDate: sanitizedPatch.dueDate,
            reminder: sanitizedPatch.reminder,
            reminderRecurrence: sanitizedPatch.reminderRecurrence
          },
          { allowDefaultReminder: false }
        );

        if (reminderPayload.validationError) {
          return this.createErrorResponse(reminderPayload.validationError);
        }

        if (sanitizedPatch.dueDate !== undefined) {
          normalizedPatch.due_date = reminderPayload.dueDate || null;
        }

        if (sanitizedPatch.reminder !== undefined || sanitizedPatch.dueDate !== undefined) {
          normalizedPatch.reminder = reminderPayload.reminder || null;
        }

        if (sanitizedPatch.reminderRecurrence !== undefined) {
          normalizedPatch.reminder_recurrence = reminderPayload.reminderRecurrence
            ? JSON.stringify(reminderPayload.reminderRecurrence)
            : null;
        }

        normalizedPatch.next_reminder_at = reminderPayload.nextReminderAt || null;
      }

      if (sanitizedPatch.completed !== undefined) {
        normalizedPatch.completed = sanitizedPatch.completed;
      }

      // Compile SET clause
      const { setSql, setParams } = SQLCompiler.compileSet(normalizedPatch, allowedColumns, 1);
      
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
