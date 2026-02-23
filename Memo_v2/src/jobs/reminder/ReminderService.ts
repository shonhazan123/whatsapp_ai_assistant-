import { query } from '../../legacy/config/database';
import { DEBUG_PHONE_NUMBER, ENVIRONMENT } from '../../config/environment';
import { NUDGE_LIMIT } from '../../legacy/config/reminder-config';
import { RequestUserContext } from '../../legacy/types/UserContext';
import { logger } from '../../legacy/utils/logger';
import { OpenAIService } from '../../legacy/services/ai/OpenAIService';
import { CalendarService } from '../../legacy/services/calendar/CalendarService';
import { ReminderRecurrence, Task, TaskService } from '../../legacy/services/database/TaskService';
import { UserService } from '../../legacy/services/database/UserService';
import { PerformanceTracker } from '../../legacy/services/performance/PerformanceTracker';
import { ConversationWindow } from '../../services/memory/ConversationWindow';
import { sendWhatsAppMessage } from '../../services/whatsapp';

interface User {
  id: string;
  phone: string;
  timezone: string;
  /** From users.settings.user_name; used only for morning digest greeting. */
  userName?: string;
}

interface TaskWithUser extends Task {
  phone: string;
  timezone: string;
}

export class ReminderService {
  private calendarService: CalendarService;
  private userService: UserService;
  private taskService: TaskService;
  private performanceTracker: PerformanceTracker;
  private conversationWindow: ConversationWindow;

  constructor(
    private loggerInstance: any = logger,
    private openaiService?: OpenAIService
  ) {
    this.openaiService = openaiService || new OpenAIService(this.loggerInstance);
    this.calendarService = new CalendarService(this.loggerInstance);
    this.userService = new UserService(this.loggerInstance);
    this.taskService = new TaskService(this.loggerInstance);
    this.performanceTracker = PerformanceTracker.getInstance();
    this.conversationWindow = ConversationWindow.getInstance();
  }

  /**
   * Send reminders for tasks that are due soon (both one-time and recurring)
   */
  async sendUpcomingReminders(): Promise<void> {
    try {

      // Get one-time reminders
      const oneTimeReminders = await this.getOneTimeReminders();

      // Group one-time reminders by user and time window
      const groupedOneTime = this.groupRemindersByTimeWindow(oneTimeReminders);

      // Send grouped one-time reminders
      for (const [key, tasks] of groupedOneTime) {
        try {
          // Phase 6: Filter reminders in DEBUG environment
          if (ENVIRONMENT === 'DEBUG' && tasks[0].phone !== DEBUG_PHONE_NUMBER) {
            continue;
          }
          
          const rawData = tasks.length === 1
            ? this.buildOneTimeReminderData(tasks[0])
            : this.buildCombinedOneTimeReminderData(tasks);
          
          const message = await this.enhanceMessageWithAI(rawData, tasks[0].phone);
          await sendWhatsAppMessage(tasks[0].phone, message);
          
          const taskTexts = tasks.map(t => t.text).join(', ');
          this.loggerInstance.info(`✅ Sent ${tasks.length} one-time reminder(s) to ${tasks[0].phone}: ${taskTexts}`);
          
          // Store reminder metadata in conversation window for reply context
          this.conversationWindow.addMessage(
            tasks[0].phone,
            'assistant',
            message,
            {
              reminderContext: {
                taskTexts: tasks.map(t => t.text),
                taskIds: tasks.map(t => t.id),
                reminderType: 'one-time',
                sentAt: new Date().toISOString()
              }
            }
          );
          
          // Clear next_reminder_at for all tasks in group
          for (const task of tasks) {
            await this.updateNextReminderAt(task.id, null);
            this.loggerInstance.info(`Cleared next_reminder_at for task ${task.id} (one-time reminder sent)`);
          }
        } catch (error) {
          this.loggerInstance.error(`Failed to send reminder group ${key}:`, error);
        }
      }

      // Get recurring reminders
      const recurringReminders = await this.getRecurringReminders();

      // Filter out tasks that should be skipped (ended recurrence, nudge limit reached)
      const validRecurringReminders: TaskWithUser[] = [];
      const tasksToDelete: string[] = [];

      for (const task of recurringReminders) {
        // Parse reminder_recurrence if it's a string
        let recurrence: ReminderRecurrence | null = null;
        if (task.reminder_recurrence) {
          if (typeof task.reminder_recurrence === 'string') {
            recurrence = JSON.parse(task.reminder_recurrence);
          } else {
            recurrence = task.reminder_recurrence as ReminderRecurrence;
          }
        }

        // Check if recurrence has ended
        if (recurrence && this.hasRecurrenceEnded(recurrence)) {
          this.loggerInstance.info(`Recurrence ended for task ${task.id}, skipping reminder`);
          continue;
        }

        // Check nudge limit for nudge-type reminders
        const nudgeCount = task.nudge_count || 0;
        if (recurrence?.type === 'nudge' && nudgeCount >= NUDGE_LIMIT) {
          this.loggerInstance.info(`Nudge limit (${NUDGE_LIMIT}) reached for task ${task.id}, auto-deleting: ${task.text}`);
          tasksToDelete.push(task.id);
          continue;
        }

        validRecurringReminders.push(task);
      }

      // Delete tasks that hit nudge limit
      for (const taskId of tasksToDelete) {
        await this.deleteTask(taskId);
      }

      // Group recurring reminders by user and time window
      const groupedRecurring = this.groupRemindersByTimeWindow(validRecurringReminders);

      // Send grouped recurring reminders and update next_reminder_at
      for (const [key, tasks] of groupedRecurring) {
        try {
          // Phase 6: Filter reminders in DEBUG environment
          if (ENVIRONMENT === 'DEBUG' && tasks[0].phone !== DEBUG_PHONE_NUMBER) {
            continue;
          }
          
          const rawData = tasks.length === 1
            ? this.buildRecurringReminderData(tasks[0])
            : this.buildCombinedRecurringReminderData(tasks);
          
          const message = await this.enhanceMessageWithAI(rawData, tasks[0].phone);
          await sendWhatsAppMessage(tasks[0].phone, message);
          
          const taskTexts = tasks.map(t => t.text).join(', ');
          this.loggerInstance.info(`✅ Sent ${tasks.length} recurring reminder(s) to ${tasks[0].phone}: ${taskTexts}`);

          // Store reminder metadata in conversation window for reply context
          let reminderType: 'one-time' | 'recurring' | 'nudge' = 'recurring';
          for (const task of tasks) {
            if (task.reminder_recurrence) {
              const rec = typeof task.reminder_recurrence === 'string' 
                ? JSON.parse(task.reminder_recurrence) 
                : task.reminder_recurrence;
              if (rec.type === 'nudge') {
                reminderType = 'nudge';
                break;
              }
            }
          }
          
          this.conversationWindow.addMessage(
            tasks[0].phone,
            'assistant',
            message,
            {
              reminderContext: {
                taskTexts: tasks.map(t => t.text),
                taskIds: tasks.map(t => t.id),
                reminderType: reminderType,
                sentAt: new Date().toISOString()
              }
            }
          );

          // Process each task in the group
          for (const task of tasks) {
            // Parse reminder_recurrence if it's a string
            let recurrence: ReminderRecurrence | null = null;
            if (task.reminder_recurrence) {
              if (typeof task.reminder_recurrence === 'string') {
                recurrence = JSON.parse(task.reminder_recurrence);
              } else {
                recurrence = task.reminder_recurrence as ReminderRecurrence;
              }
            }

            // Increment nudge count for nudge-type reminders
            if (recurrence?.type === 'nudge') {
              const newNudgeCount = await this.taskService.incrementNudgeCount(task.id);
              this.loggerInstance.info(`Incremented nudge count for task ${task.id}: ${newNudgeCount}/${NUDGE_LIMIT}`);
              
              // Check if we just hit the limit (15th nudge was sent)
              if (newNudgeCount >= NUDGE_LIMIT) {
                this.loggerInstance.info(`Nudge limit (${NUDGE_LIMIT}) reached after sending reminder, auto-deleting task ${task.id}: ${task.text}`);
                await this.deleteTask(task.id);
                continue; // Don't schedule next reminder
              }
            }

            // Calculate and update next_reminder_at (only if task wasn't deleted)
            if (recurrence) {
              const nextReminderAt = this.calculateNextRecurrence(recurrence, new Date(), task);
              await this.updateNextReminderAt(task.id, nextReminderAt.toISOString());
              this.loggerInstance.info(`Updated next_reminder_at for task ${task.id}: ${nextReminderAt.toISOString()}`);
            }
          }
        } catch (error) {
          this.loggerInstance.error(`Failed to send recurring reminder group ${key}:`, error);
        }
      }

    } catch (error) {
      this.loggerInstance.error('Error in sendUpcomingReminders:', error);
      throw error;
    }
  }

  /**
   * Send daily digest for a specific user (for debugging/testing)
   * Bypasses time check and sends immediately
   */
  async sendMorningDigestForUser(userPhone: string): Promise<void> {
    try {
      // Phase 6: Filter digests in DEBUG environment
      if (ENVIRONMENT === 'DEBUG' && userPhone !== DEBUG_PHONE_NUMBER) {
        return;
      }
      
      const userResult = await query(
        `SELECT id, whatsapp_number AS phone, COALESCE(timezone, 'Asia/Jerusalem') AS timezone, settings
         FROM users
         WHERE whatsapp_number = $1`,
        [userPhone]
      );

      if (userResult.rows.length === 0) {
        throw new Error(`User with phone ${userPhone} not found`);
      }

      const row = userResult.rows[0];
      const settings = typeof row.settings === 'object' && row.settings !== null ? row.settings : {};
      const rawName = settings.user_name;
      const userName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
      const user: User = {
        id: row.id,
        phone: row.phone,
        timezone: row.timezone,
        ...(userName !== undefined && { userName }),
      };
      
      const plannedTasks = await this.getTodaysTasks(user.id, user.timezone);
      const unplannedTasks = await this.getUnplannedTasks(user.id);
      const calendarEvents = await this.getTodaysCalendarEvents(user.id, user.timezone);
      
      let message: string;
      if (plannedTasks.length > 0 || unplannedTasks.length > 0 || calendarEvents.length > 0) {
        const rawData = this.buildDailyDigestData(plannedTasks, unplannedTasks, calendarEvents, user);
        message = await this.enhanceMessageWithAI(rawData, user.phone);
        await sendWhatsAppMessage(user.phone, message);
      } else {
        // No tasks or events - send empty digest message
        const rawData = this.buildEmptyDigestData(user);
        message = await this.enhanceMessageWithAI(rawData, user.phone);
        await sendWhatsAppMessage(user.phone, message);
      }
    } catch (error) {
      this.loggerInstance.error(`Failed to send morning digest to ${userPhone}:`, error);
      throw error;
    }
  }

  /**
   * Send daily digest for today's tasks at specified hour
   * Excludes recurring reminders (they have no due_date)
   */
  async sendMorningDigest(morningDigestHour: number = 8): Promise<void> {
    const startTime = Date.now();
    const sentToUsers: string[] = [];
    const skippedUsers: string[] = [];
    const failedUsers: string[] = [];
    
    try {
      this.loggerInstance.info(`📋 Sending morning digest (checking for hour ${morningDigestHour})...`);

      const users = await this.getAllUsers();
      this.loggerInstance.info(`📊 Found ${users.length} users to check for morning digest`);

      // Process users in parallel batches (max 5 concurrent) to reduce delays
      const batchSize = 5;
      const userBatches: User[][] = [];
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }

      for (const batch of userBatches) {
        // Process batch in parallel
        await Promise.all(batch.map(async (user) => {
          try {
            // Phase 6: Filter morning digest in DEBUG environment
            if (ENVIRONMENT === 'DEBUG' && user.phone !== DEBUG_PHONE_NUMBER) {
              skippedUsers.push(user.phone);
              return;
            }
            
            // Validate timezone before processing
            if (!this.isValidTimezone(user.timezone)) {
              this.loggerInstance.warn(`⚠️  Invalid timezone "${user.timezone}" for user ${user.phone}, using default Asia/Jerusalem`);
              user.timezone = 'Asia/Jerusalem';
            }
            
            // Check if it's the specified hour in user's timezone (FIXED: use direct hour/minute)
            const userTime = this.getCurrentTimeInTimezone(user.timezone);
            const hour = userTime.hour;
            const minute = userTime.minute;

            // Expanded time window: 0-15 minutes (was 0-10) to account for processing delays
            if (hour === morningDigestHour && minute < 15) {
              this.loggerInstance.info(`📧 Sending morning digest to ${user.phone} (${user.timezone}, local time: ${hour}:${String(minute).padStart(2, '0')})`);
              
              const success = await this.sendMorningDigestToUser(user, morningDigestHour);
              if (success) {
                sentToUsers.push(user.phone);
              } else {
                failedUsers.push(user.phone);
              }
            } else {
              this.loggerInstance.debug(`⏭️  Skipping ${user.phone} - not in digest window (local time: ${hour}:${String(minute).padStart(2, '0')}, target: ${morningDigestHour}:00-${morningDigestHour}:14)`);
              skippedUsers.push(user.phone);
            }
          } catch (error) {
            this.loggerInstance.error(`❌ Error processing morning digest for ${user.phone}:`, error);
            failedUsers.push(user.phone);
          }
        }));
      }

      const duration = Date.now() - startTime;
      this.loggerInstance.info(`✅ Morning digest completed in ${duration}ms`);
      this.loggerInstance.info(`📊 Summary: ${sentToUsers.length} sent, ${skippedUsers.length} skipped (not in window), ${failedUsers.length} failed`);
      
      if (sentToUsers.length > 0) {
        this.loggerInstance.info(`✅ Successfully sent to: ${sentToUsers.join(', ')}`);
      }
      if (failedUsers.length > 0) {
        this.loggerInstance.warn(`⚠️  Failed to send to: ${failedUsers.join(', ')}`);
      }
    } catch (error) {
      this.loggerInstance.error('❌ Error in sendMorningDigest:', error);
      throw error;
    }
  }

  /**
   * Get one-time reminders that need to be sent
   */
  private async getOneTimeReminders(): Promise<TaskWithUser[]> {
    const result = await query(
      `SELECT t.*, u.whatsapp_number AS phone, u.timezone
       FROM tasks t
       JOIN users u ON t.user_id = u.id
       WHERE t.due_date IS NOT NULL
         AND t.reminder IS NOT NULL
         AND t.reminder_recurrence IS NULL
         AND t.next_reminder_at IS NOT NULL
         AND t.completed = FALSE
         AND t.next_reminder_at <= NOW()
         AND t.next_reminder_at >= NOW() - INTERVAL '10 minutes'`
    );
    return result.rows;
  }

  /**
   * Get recurring reminders that need to be sent
   */
  private async getRecurringReminders(): Promise<TaskWithUser[]> {
    const result = await query(
      `SELECT t.*, u.whatsapp_number AS phone, u.timezone
       FROM tasks t
       JOIN users u ON t.user_id = u.id
       WHERE t.reminder_recurrence IS NOT NULL
         AND t.next_reminder_at IS NOT NULL
         AND t.completed = FALSE
         AND t.next_reminder_at <= NOW()
         AND t.next_reminder_at >= NOW() - INTERVAL '10 minutes'`
    );
    return result.rows;
  }

  /**
   * Get today's tasks for a user (excluding recurring reminders)
   * Recurring tasks have their own reminder system and should not appear in daily digest
   */
  private async getTodaysTasks(userId: string, timezone: string): Promise<Task[]> {
    const result = await query(
      `SELECT t.*
       FROM tasks t
       WHERE t.user_id = $1
         AND t.due_date IS NOT NULL
         AND t.reminder_recurrence IS NULL  -- Exclude recurring tasks (they have their own reminders)
         AND DATE(t.due_date AT TIME ZONE $2) = CURRENT_DATE
       ORDER BY t.due_date, t.category`,
      [userId, timezone]
    );
    return result.rows;
  }

  /**
   * Get unplanned tasks (no due date) for a user
   * These are tasks that haven't been scheduled yet
   */
  private async getUnplannedTasks(userId: string): Promise<Task[]> {
    const result = await query(
      `SELECT t.*
       FROM tasks t
       WHERE t.user_id = $1
         AND t.due_date IS NULL
         AND t.reminder_recurrence IS NULL  -- Exclude recurring tasks
         AND t.completed = FALSE
       ORDER BY t.created_at DESC, t.category`,
      [userId]
    );
    return result.rows;
  }

  /**
   * Get all users with their timezone and settings (for morning digest: userName from settings).
   */
  private async getAllUsers(): Promise<User[]> {
    const result = await query(
      `SELECT id, whatsapp_number AS phone, COALESCE(timezone, 'Asia/Jerusalem') AS timezone, settings FROM users`
    );
    return result.rows.map((row: { id: string; phone: string; timezone: string; settings?: Record<string, unknown> }) => {
      const settings = typeof row.settings === 'object' && row.settings !== null ? row.settings : {};
      const rawName = settings.user_name;
      const userName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
      return {
        id: row.id,
        phone: row.phone,
        timezone: row.timezone,
        ...(userName !== undefined && { userName }),
      };
    });
  }

  /**
   * Update next_reminder_at for reminders (can be null to clear)
   */
  private async updateNextReminderAt(taskId: string, nextReminderAt: string | null): Promise<void> {
    await query(
      'UPDATE tasks SET next_reminder_at = $1 WHERE id = $2',
      [nextReminderAt, taskId]
    );
  }

  /**
   * Delete a task (used for auto-deleting after nudge limit)
   */
  private async deleteTask(taskId: string): Promise<void> {
    await query('DELETE FROM tasks WHERE id = $1', [taskId]);
  }

  /**
   * Calculate next reminder time from recurrence pattern
   * Uses same logic as TaskService.calculateNextReminderAt
   */
  private calculateNextRecurrence(recurrence: ReminderRecurrence, currentTime: Date, task?: TaskWithUser): Date {
    const timezone = recurrence.timezone || 'Asia/Jerusalem';
    
    let nextDate = new Date(currentTime);
    
    switch (recurrence.type) {
      case 'nudge': {
        // Nudge: repeat after specified interval (default 10 minutes)
        const interval = recurrence.interval || '10 minutes';
        const minutes = this.parseIntervalToMinutes(interval);
        
        if (minutes < 1) {
          throw new Error('Nudge interval must be at least 1 minute');
        }
        
        // If task has dueDate, calculate from dueDate pattern (for future nudge reminders)
        if (task?.due_date) {
          const dueDate = new Date(task.due_date);
          const now = new Date(currentTime);
          
          // Calculate how many intervals have passed since dueDate
          const msSinceDueDate = now.getTime() - dueDate.getTime();
          const minutesSinceDueDate = Math.floor(msSinceDueDate / (1000 * 60));
          const intervalsPassed = Math.floor(minutesSinceDueDate / minutes);
          
          // Next reminder = dueDate + (intervalsPassed + 1) × interval
          const nextReminderDate = new Date(dueDate);
          nextReminderDate.setMinutes(dueDate.getMinutes() + (intervalsPassed + 1) * minutes);
          nextReminderDate.setSeconds(0, 0);
          
          // If calculated time is in the past (shouldn't happen, but safety check)
          if (nextReminderDate <= now) {
            nextReminderDate.setMinutes(nextReminderDate.getMinutes() + minutes);
          }
          
          nextDate = nextReminderDate;
        } else {
          // No dueDate: calculate from current time (existing behavior)
          currentTime.setSeconds(0, 0);
          nextDate.setSeconds(0, 0);
          
          // Add interval to current time
          nextDate.setMinutes(currentTime.getMinutes() + minutes);
        }
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
        if (nextDate <= currentTime) {
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
        const currentDay = currentTime.getDay(); // 0=Sunday, 6=Saturday
        let daysToAdd = 0;
        let found = false;
        
        // Check next 7 days
        for (let i = 0; i < 7; i++) {
          const checkDay = (currentDay + i) % 7;
          if (recurrence.days.includes(checkDay)) {
            nextDate.setDate(currentTime.getDate() + i);
            daysToAdd = i;
            found = true;
            break;
          }
        }
        
        if (!found) {
          // Next week
          const firstDay = Math.min(...recurrence.days);
          daysToAdd = 7 - currentDay + firstDay;
          nextDate.setDate(currentTime.getDate() + daysToAdd);
        } else {
          // If time has passed on the found day, set for next week
          if (daysToAdd === 0 && nextDate <= currentTime) {
            daysToAdd = 7;
            nextDate.setDate(currentTime.getDate() + daysToAdd);
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
        const maxDay = new Date(currentTime.getFullYear(), currentTime.getMonth() + 1, 0).getDate();
        const dayToSet = Math.min(recurrence.dayOfMonth, maxDay);
        nextDate.setDate(dayToSet);
        nextDate.setMonth(currentTime.getMonth());
        
        // If time/date has passed this month, set for next month
        if (nextDate <= currentTime) {
          nextDate.setMonth(currentTime.getMonth() + 1);
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
    
    return nextDate;
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

  /**
   * Check if recurrence has ended (until date reached)
   */
  private hasRecurrenceEnded(recurrence: ReminderRecurrence): boolean {
    if (!recurrence.until) {
      return false;
    }
    const untilDate = new Date(recurrence.until);
    const now = new Date();
    return now > untilDate;
  }

  /**
   * Enhance message using AI
   */
  private async enhanceMessageWithAI(rawData: string, userPhone?: string): Promise<string> {
    try {
      // For background jobs (reminders), create a requestId for tracking
      let requestId: string | undefined;
      
      if (userPhone) {
        // Create a requestId for background job tracking
        requestId = this.performanceTracker.startRequest(userPhone);
      }
      
      const response = await this.openaiService!.generateResponse(rawData, requestId, 'reminder-service');
      
      // End request if we created it
      if (requestId) {
        await this.performanceTracker.endRequest(requestId);
      }
      
      return response;
    } catch (error) {
      this.loggerInstance.error('Failed to enhance message with AI, using fallback:', error);
      // Return raw data as fallback
      return rawData;
    }
  }

  /**
   * Build data structure for one-time reminder
   */
  private buildOneTimeReminderData(task: TaskWithUser): string {
    const dueDate = task.due_date ? new Date(task.due_date).toLocaleString('en-US', {
      timeZone: task.timezone || 'Asia/Jerusalem',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) : 'N/A';
    
    let data = `Task: ${task.text}\nDue: ${dueDate}`;
    
    if (task.category) {
      data += `\nCategory: ${task.category}`;
    }
    
    return data;
  }

  /**
   * Build data structure for recurring reminder
   */
  private buildRecurringReminderData(task: TaskWithUser): string {
    let recurrenceInfo = 'Recurring reminder';
    
    if (task.reminder_recurrence) {
      let recurrence: ReminderRecurrence;
      if (typeof task.reminder_recurrence === 'string') {
        recurrence = JSON.parse(task.reminder_recurrence);
      } else {
        recurrence = task.reminder_recurrence as ReminderRecurrence;
      }
      
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      switch (recurrence.type) {
        case 'nudge':
          recurrenceInfo = `Nudging every ${recurrence.interval || '10 minutes'}`;
          break;
        case 'daily':
          recurrenceInfo = `Every day at ${recurrence.time}`;
          break;
        case 'weekly':
          if (recurrence.days && recurrence.days.length > 0) {
            const days = recurrence.days.map(d => dayNames[d]).join(', ');
            recurrenceInfo = `Every ${days} at ${recurrence.time}`;
          }
          break;
        case 'monthly':
          recurrenceInfo = `Every month on day ${recurrence.dayOfMonth} at ${recurrence.time}`;
          break;
      }
    }
    
    let data = `Task: ${task.text}\nRecurrence: ${recurrenceInfo}`;
    
    if (task.category) {
      data += `\nCategory: ${task.category}`;
    }
    
    return data;
  }

  /**
   * Group reminders by user phone and exact time (same timestamp)
   * Returns a Map with key format: "phone|exactTime" and value as array of tasks
   */
  private groupRemindersByTimeWindow(tasks: TaskWithUser[]): Map<string, TaskWithUser[]> {
    const groups = new Map<string, TaskWithUser[]>();

    for (const task of tasks) {
      if (!task.due_date) {
        // If no due_date, treat as separate group
        const key = `${task.phone}|no-date-${task.id}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(task);
        continue;
      }

      const dueDate = new Date(task.due_date);
      // Use exact timestamp (millisecond precision) for grouping
      const exactTime = dueDate.getTime();
      const key = `${task.phone}|${exactTime}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(task);
    }

    return groups;
  }

  /**
   * Build combined data structure for multiple one-time reminders
   */
  private buildCombinedOneTimeReminderData(tasks: TaskWithUser[]): string {
    if (tasks.length === 0) {
      return '';
    }

    // Use the first task's due date (they should all be in the same time window)
    const dueDate = tasks[0].due_date ? new Date(tasks[0].due_date).toLocaleString('en-US', {
      timeZone: tasks[0].timezone || 'Asia/Jerusalem',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) : 'N/A';

    // Combine all task texts
    const taskTexts = tasks.map((task, index) => {
      let text = `${index + 1}. ${task.text}`;
      if (task.category) {
        text += ` (${task.category})`;
      }
      return text;
    }).join('\n');

    let data = `Tasks:\n${taskTexts}\nDue: ${dueDate}`;

    return data;
  }

  /**
   * Build combined data structure for multiple recurring reminders
   */
  private buildCombinedRecurringReminderData(tasks: TaskWithUser[]): string {
    if (tasks.length === 0) {
      return '';
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Combine all task texts with their recurrence info
    const taskTexts = tasks.map((task, index) => {
      let recurrenceInfo = 'Recurring reminder';
      
      if (task.reminder_recurrence) {
        let recurrence: ReminderRecurrence;
        if (typeof task.reminder_recurrence === 'string') {
          recurrence = JSON.parse(task.reminder_recurrence);
        } else {
          recurrence = task.reminder_recurrence as ReminderRecurrence;
        }
        
        switch (recurrence.type) {
          case 'nudge':
            recurrenceInfo = `Nudging every ${recurrence.interval || '10 minutes'}`;
            break;
          case 'daily':
            recurrenceInfo = `Every day at ${recurrence.time}`;
            break;
          case 'weekly':
            if (recurrence.days && recurrence.days.length > 0) {
              const days = recurrence.days.map(d => dayNames[d]).join(', ');
              recurrenceInfo = `Every ${days} at ${recurrence.time}`;
            }
            break;
          case 'monthly':
            recurrenceInfo = `Every month on day ${recurrence.dayOfMonth} at ${recurrence.time}`;
            break;
        }
      }

      let text = `${index + 1}. ${task.text}`;
      if (task.category) {
        text += ` (${task.category})`;
      }
      text += `\n   Recurrence: ${recurrenceInfo}`;
      
      return text;
    }).join('\n\n');

    let data = `Tasks:\n${taskTexts}`;

    return data;
  }

  /**
   * Get today's calendar events for a user
   */
  private async getTodaysCalendarEvents(userId: string, timezone: string): Promise<any[]> {
    try {
      // Get user record and Google tokens
      const userRecord = await this.userService.findById(userId);
      if (!userRecord) {
        this.loggerInstance.warn(`User ${userId} not found for calendar events`);
        return [];
      }

      const googleTokens = await this.userService.getGoogleTokens(userId);
      if (!googleTokens || !googleTokens.access_token) {
        // User doesn't have Google Calendar connected
        return [];
      }

      // Calculate today's date range in user's timezone
      const now = new Date();
      const userDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      const startOfDay = new Date(userDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(userDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Convert to ISO strings
      const timeMin = startOfDay.toISOString();
      const timeMax = endOfDay.toISOString();

      // Build RequestUserContext
      const context: RequestUserContext = {
        user: userRecord,
        planType: userRecord.plan_type,
        whatsappNumber: userRecord.whatsapp_number,
        capabilities: {
          database: true,
          calendar: !!googleTokens,
          gmail: !!googleTokens
        },
        googleTokens: googleTokens,
        googleConnected: !!googleTokens
      };

      // Get calendar events (pass context directly)
      const eventsResponse = await this.calendarService.getEvents(context, {
        timeMin,
        timeMax
      });

      if (eventsResponse.success && eventsResponse.data?.events) {
        return eventsResponse.data.events;
      }

      return [];
    } catch (error) {
      this.loggerInstance.error(`Failed to get calendar events for user ${userId}:`, error);
      // Return empty array on error - don't block digest sending
      return [];
    }
  }

  /** Instruction so the digest AI always responds in Hebrew. */
  private static readonly DIGEST_LANGUAGE_INSTRUCTION =
    'Critical: The user\'s language is Hebrew. You MUST write the entire message in Hebrew only. Do not use English.\n\n';

  /**
   * Build data structure for daily digest with tasks and calendar events.
   * Greeting "בוקר טוב [name]" is prepended in code after AI response; here we only pass language instruction and content.
   */
  private buildDailyDigestData(plannedTasks: Task[], unplannedTasks: Task[], calendarEvents: any[], user: User): string {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: user.timezone || 'Asia/Jerusalem',
      dateStyle: 'long'
    });
    
    const incomplete = plannedTasks.filter(t => !t.completed);
    const completed = plannedTasks.filter(t => t.completed);
    
    let data = `${ReminderService.DIGEST_LANGUAGE_INSTRUCTION}Today's Schedule - ${today}\n\n`;
    
    // Calendar Events
    if (calendarEvents.length > 0) {
      data += `Calendar Events:\n`;
      calendarEvents.forEach(event => {
        const startTime = event.start ? new Date(event.start).toLocaleTimeString('en-US', {
          timeZone: user.timezone || 'Asia/Jerusalem',
          timeStyle: 'short'
        }) : '';
        const endTime = event.end ? new Date(event.end).toLocaleTimeString('en-US', {
          timeZone: user.timezone || 'Asia/Jerusalem',
          timeStyle: 'short'
        }) : '';
        data += `- ${event.summary || 'Untitled Event'}${startTime ? ` from ${startTime}` : ''}${endTime ? ` to ${endTime}` : ''}\n`;
        if (event.location) {
          data += `  Location: ${event.location}\n`;
        }
      });
      data += `\n`;
    }
    
    // Planned tasks (with due date)
    if (incomplete.length > 0 || completed.length > 0) {
      data += `Tasks:\n`;
      
      if (incomplete.length > 0) {
        data += `Incomplete:\n`;
        incomplete.forEach(task => {
          const time = task.due_date ? new Date(task.due_date).toLocaleTimeString('en-US', {
            timeZone: user.timezone || 'Asia/Jerusalem',
            timeStyle: 'short'
          }) : '';
          data += `- ${task.text}${time ? ` at ${time}` : ''}\n`;
        });
        data += `\n`;
      }
      
      if (completed.length > 0) {
        data += `Completed:\n`;
        completed.forEach(task => {
          data += `- ${task.text}\n`;
        });
        data += `\n`;
      }
      
      data += `Total: ${incomplete.length} incomplete, ${completed.length} completed\n\n`;
    }
    
    // Unplanned tasks (no due date)
    if (unplannedTasks.length > 0) {
      data += `Unplanned Tasks (these are tasks you didn't plan):\n`;
      unplannedTasks.forEach(task => {
        data += `- ${task.text}\n`;
      });
    }
    
    return data;
  }

  /**
   * Build data structure for empty daily digest.
   * Greeting "בוקר טוב [name]" is prepended in code after AI response; message must be in Hebrew.
   */
  private buildEmptyDigestData(user: User): string {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: user.timezone || 'Asia/Jerusalem',
      dateStyle: 'long'
    });
    return `${ReminderService.DIGEST_LANGUAGE_INSTRUCTION}Today's Schedule - ${today}\n\nNo tasks or events scheduled for today. Write a short, friendly message in Hebrew only (e.g. that there are no tasks or events today). and if he / she wants - Donna is here to help plan the day`;
  }

  /**
   * Get current time in user's timezone
   * Returns hour and minute directly from the user's timezone (FIXED: no longer returns Date object)
   */
  private getCurrentTimeInTimezone(timezone: string): { hour: number; minute: number; second: number } {
    // Get current UTC time
    const now = new Date();
    // Format in the user's timezone to get local components
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
    const minute = parseInt(parts.find(p => p.type === 'minute')!.value);
    const second = parseInt(parts.find(p => p.type === 'second')!.value);

    // Return hour and minute directly (FIXED: no Date object conversion)
    return { hour, minute, second };
  }

  /**
   * Validate timezone string
   * Returns true if timezone is valid, false otherwise
   */
  private isValidTimezone(timezone: string): boolean {
    try {
      // Try to create a formatter with the timezone to validate it
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      // If formatter was created successfully, timezone is valid
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Send morning digest to a single user with retry logic
   */
  private async sendMorningDigestToUser(user: User, morningDigestHour: number, retries: number = 2): Promise<boolean> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const plannedTasks = await this.getTodaysTasks(user.id, user.timezone);
        const unplannedTasks = await this.getUnplannedTasks(user.id);
        const calendarEvents = await this.getTodaysCalendarEvents(user.id, user.timezone);
        
        let message: string;
        if (plannedTasks.length > 0 || unplannedTasks.length > 0 || calendarEvents.length > 0) {
          const rawData = this.buildDailyDigestData(plannedTasks, unplannedTasks, calendarEvents, user);
          message = await this.enhanceMessageWithAI(rawData, user.phone);
        } else {
          // No tasks or events - send empty digest message
          const rawData = this.buildEmptyDigestData(user);
          message = await this.enhanceMessageWithAI(rawData, user.phone);
        }
        // Always start morning digest with "בוקר טוב [user_name]!" (or "בוקר טוב!" if no name)
        const greeting = user.userName
          ? `בוקר טוב ${user.userName} ☀️\n\n`
          : 'בוקר טוב ☀️\n\n';
        message = greeting + message;
        await sendWhatsAppMessage(user.phone, message);
        this.loggerInstance.info(`✅ Morning digest sent successfully to ${user.phone} (attempt ${attempt + 1})`);
        return true;
      } catch (error) {
        if (attempt < retries) {
          this.loggerInstance.warn(`⚠️  Failed to send morning digest to ${user.phone} (attempt ${attempt + 1}/${retries + 1}), retrying...`, error);
          // Wait before retry (exponential backoff: 1s, 2s)
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        } else {
          this.loggerInstance.error(`❌ Failed to send morning digest to ${user.phone} after ${retries + 1} attempts:`, error);
          return false;
        }
      }
    }
    return false;
  }
}

