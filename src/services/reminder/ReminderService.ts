import { query } from '../../config/database';
import { RequestContext } from '../../core/context/RequestContext';
import { RequestUserContext } from '../../types/UserContext';
import { logger } from '../../utils/logger';
import { OpenAIService } from '../ai/OpenAIService';
import { CalendarService } from '../calendar/CalendarService';
import { ReminderRecurrence, Task } from '../database/TaskService';
import { UserService } from '../database/UserService';
import { PerformanceTracker } from '../performance/PerformanceTracker';
import { sendWhatsAppMessage } from '../whatsapp';

interface User {
  id: string;
  phone: string;
  timezone: string;
}

interface TaskWithUser extends Task {
  phone: string;
  timezone: string;
}

export class ReminderService {
  private calendarService: CalendarService;
  private userService: UserService;
  private performanceTracker: PerformanceTracker;

  constructor(
    private loggerInstance: any = logger,
    private openaiService?: OpenAIService
  ) {
    this.openaiService = openaiService || new OpenAIService(this.loggerInstance);
    this.calendarService = new CalendarService(this.loggerInstance);
    this.userService = new UserService(this.loggerInstance);
    this.performanceTracker = PerformanceTracker.getInstance();
  }

  /**
   * Send reminders for tasks that are due soon (both one-time and recurring)
   */
  async sendUpcomingReminders(): Promise<void> {
    try {

      // Get one-time reminders
      const oneTimeReminders = await this.getOneTimeReminders();

      // Send one-time reminders
      for (const task of oneTimeReminders) {
        try {
          const rawData = this.buildOneTimeReminderData(task);
          const message = await this.enhanceMessageWithAI(rawData, task.phone);
          await sendWhatsAppMessage(task.phone, message);
          this.loggerInstance.info(`✅ Sent one-time reminder to ${task.phone}: ${task.text}`);
          
          // Clear next_reminder_at to prevent duplicate reminders
          await this.updateNextReminderAt(task.id, null);
          this.loggerInstance.info(`Cleared next_reminder_at for task ${task.id} (one-time reminder sent)`);
        } catch (error) {
          this.loggerInstance.error(`Failed to send reminder for task ${task.id}:`, error);
        }
      }

      // Get recurring reminders
      const recurringReminders = await this.getRecurringReminders();

      // Send recurring reminders and update next_reminder_at
      for (const task of recurringReminders) {
        try {
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
            // Delete or mark task as inactive - for now, just log
            this.loggerInstance.info(`Recurrence ended for task ${task.id}, skipping reminder`);
            continue;
          }

          // Send reminder
          const rawData = this.buildRecurringReminderData(task);
          const message = await this.enhanceMessageWithAI(rawData, task.phone);
          await sendWhatsAppMessage(task.phone, message);
          this.loggerInstance.info(`✅ Sent recurring reminder to ${task.phone}: ${task.text}`);

          // Calculate and update next_reminder_at
          if (recurrence) {
            const nextReminderAt = this.calculateNextRecurrence(recurrence, new Date());
            await this.updateNextReminderAt(task.id, nextReminderAt.toISOString());
            this.loggerInstance.info(`Updated next_reminder_at for task ${task.id}: ${nextReminderAt.toISOString()}`);
          }
        } catch (error) {
          this.loggerInstance.error(`Failed to send recurring reminder for task ${task.id}:`, error);
        }
      }

    } catch (error) {
      this.loggerInstance.error('Error in sendUpcomingReminders:', error);
      throw error;
    }
  }

  /**
   * Send daily digest for today's tasks at specified hour
   * Excludes recurring reminders (they have no due_date)
   */
  async sendMorningDigest(morningDigestHour: number = 8): Promise<void> {
    try {
      this.loggerInstance.info(`📋 Sending morning digest (checking for hour ${morningDigestHour})...`);

      const users = await this.getAllUsers();

      for (const user of users) {
        try {
          // Check if it's the specified hour in user's timezone
          const userTime = this.getCurrentTimeInTimezone(user.timezone);
          const hour = userTime.getHours();
          const minute = userTime.getMinutes();

          // Only send if it's the specified hour (within 0-10 minute window)
          if (hour === morningDigestHour && minute < 10) {
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
          }
        } catch (error) {
          this.loggerInstance.error(`Failed to send morning digest to ${user.phone}:`, error);
        }
      }
    } catch (error) {
      this.loggerInstance.error('Error in sendMorningDigest:', error);
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
   * Get all users with their timezone info
   */
  private async getAllUsers(): Promise<User[]> {
    const result = await query(
      'SELECT id, whatsapp_number AS phone, COALESCE(timezone, \'Asia/Jerusalem\') as timezone FROM users'
    );
    return result.rows;
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
   * Calculate next reminder time from recurrence pattern
   * Uses same logic as TaskService.calculateNextReminderAt
   */
  private calculateNextRecurrence(recurrence: ReminderRecurrence, currentTime: Date): Date {
    const timezone = recurrence.timezone || 'Asia/Jerusalem';
    
    // Parse time string (HH:mm)
    const [hours, minutes] = recurrence.time.split(':').map(Number);
    
    let nextDate = new Date(currentTime);
    
    // Set time
    nextDate.setHours(hours, minutes, 0, 0);
    
    switch (recurrence.type) {
      case 'daily': {
        // If time has passed today, set for tomorrow
        if (nextDate <= currentTime) {
          nextDate.setDate(nextDate.getDate() + 1);
        }
        break;
      }
      
      case 'weekly': {
        if (!recurrence.days || recurrence.days.length === 0) {
          throw new Error('Weekly recurrence requires days array');
        }
        
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
        if (!recurrence.dayOfMonth) {
          throw new Error('Monthly recurrence requires dayOfMonth');
        }
        
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
      // For background jobs (reminders), create a requestId if not in context
      const requestContext = RequestContext.get();
      let requestId = requestContext?.performanceRequestId;
      
      if (!requestId && userPhone) {
        // Create a requestId for background job tracking
        requestId = this.performanceTracker.startRequest(userPhone);
      }
      
      const response = await this.openaiService!.generateResponse(rawData, requestId, 'reminder-service');
      
      // End request if we created it
      if (requestId && !requestContext?.performanceRequestId) {
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

      // Get calendar events within RequestContext
      const eventsResponse = await RequestContext.run(context, async () => {
        return await this.calendarService.getEvents({
          timeMin,
          timeMax
        });
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

  /**
   * Build data structure for daily digest with tasks and calendar events
   */
  private buildDailyDigestData(plannedTasks: Task[], unplannedTasks: Task[], calendarEvents: any[], user: User): string {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: user.timezone || 'Asia/Jerusalem',
      dateStyle: 'long'
    });
    
    const incomplete = plannedTasks.filter(t => !t.completed);
    const completed = plannedTasks.filter(t => t.completed);
    
    let data = `Today's Schedule - ${today}\n\n`;
    
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
   * Build data structure for empty daily digest
   */
  private buildEmptyDigestData(user: User): string {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: user.timezone || 'Asia/Jerusalem',
      dateStyle: 'long'
    });
    
    return `Today's Schedule - ${today}\n\nNo tasks or events scheduled for today.`;
  }

  /**
   * Get current time in user's timezone
   * Returns a date object representing the current time as it would be in the user's timezone
   */
  private getCurrentTimeInTimezone(timezone: string): Date {
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
    const year = parseInt(parts.find(p => p.type === 'year')!.value);
    const month = parseInt(parts.find(p => p.type === 'month')!.value) - 1; // 0-indexed
    const day = parseInt(parts.find(p => p.type === 'day')!.value);
    const hour = parseInt(parts.find(p => p.type === 'hour')!.value);
    const minute = parseInt(parts.find(p => p.type === 'minute')!.value);
    const second = parseInt(parts.find(p => p.type === 'second')!.value);

    // Create date object in UTC but representing the user's local time
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }
}

