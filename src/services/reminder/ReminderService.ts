import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import { ReminderRecurrence, Task } from '../database/TaskService';
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
  constructor(private loggerInstance: any = logger) {}

  /**
   * Send reminders for tasks that are due soon (both one-time and recurring)
   */
  async sendUpcomingReminders(): Promise<void> {
    try {
      this.loggerInstance.info('🔔 Checking for upcoming reminders...');

      // Get one-time reminders
      const oneTimeReminders = await this.getOneTimeReminders();
      this.loggerInstance.info(`Found ${oneTimeReminders.length} one-time reminders to send`);

      // Send one-time reminders
      for (const task of oneTimeReminders) {
        try {
          const message = this.formatReminderMessage(task);
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
      this.loggerInstance.info(`Found ${recurringReminders.length} recurring reminders to send`);

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
          const message = this.formatRecurringReminderMessage(task);
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

      this.loggerInstance.info(`✅ Reminder check complete. Sent ${oneTimeReminders.length + recurringReminders.length} reminders`);
    } catch (error) {
      this.loggerInstance.error('Error in sendUpcomingReminders:', error);
      throw error;
    }
  }

  /**
   * Send daily digest for today's tasks at 8:00 AM
   * Excludes recurring reminders (they have no due_date)
   */
  async sendMorningDigest(): Promise<void> {
    try {
      this.loggerInstance.info('📋 Sending morning digest...');

      const users = await this.getAllUsers();

      for (const user of users) {
        try {
          // Check if it's 8 AM in user's timezone
          const userTime = this.getCurrentTimeInTimezone(user.timezone);
          const hour = userTime.getHours();
          const minute = userTime.getMinutes();

          // Only send if it's 8 AM (within 0-10 minute window)
          if (hour === 8 && minute < 10) {
            const tasks = await this.getTodaysTasks(user.id, user.timezone);
            
            if (tasks.length > 0) {
              const message = this.formatDailyDigest(tasks, user);
              await sendWhatsAppMessage(user.phone, message);
              this.loggerInstance.info(`✅ Sent morning digest to ${user.phone} with ${tasks.length} tasks`);
            } else {
              this.loggerInstance.debug(`No tasks for today for user ${user.phone}`);
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
      `SELECT t.*, u.phone, u.timezone
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
      `SELECT t.*, u.phone, u.timezone
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
   */
  private async getTodaysTasks(userId: string, timezone: string): Promise<Task[]> {
    const result = await query(
      `SELECT t.*
       FROM tasks t
       WHERE t.user_id = $1
         AND t.due_date IS NOT NULL
         AND t.reminder_recurrence IS NULL
         AND DATE(t.due_date AT TIME ZONE $2) = CURRENT_DATE
       ORDER BY t.due_date, t.category`,
      [userId, timezone]
    );
    return result.rows;
  }

  /**
   * Get all users with their timezone info
   */
  private async getAllUsers(): Promise<User[]> {
    const result = await query(
      'SELECT id, phone, COALESCE(timezone, \'Asia/Jerusalem\') as timezone FROM users'
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
   * Format one-time reminder message
   */
  private formatReminderMessage(task: TaskWithUser): string {
    const dueDate = task.due_date ? new Date(task.due_date).toLocaleString('en-US', {
      timeZone: task.timezone || 'Asia/Jerusalem',
      dateStyle: 'medium',
      timeStyle: 'short'
    }) : 'N/A';
    
    let message = `🔔 Reminder\n\nTask: ${task.text}\nDue: ${dueDate}`;
    
    if (task.category) {
      message += `\nCategory: ${task.category}`;
    }
    
    return message;
  }

  /**
   * Format recurring reminder message
   */
  private formatRecurringReminderMessage(task: TaskWithUser): string {
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
    
    let message = `🔔 Reminder\n\n${task.text}\n${recurrenceInfo}`;
    
    if (task.category) {
      message += `\nCategory: ${task.category}`;
    }
    
    return message;
  }

  /**
   * Format daily digest message
   */
  private formatDailyDigest(tasks: Task[], user: User): string {
    const today = new Date().toLocaleDateString('en-US', {
      timeZone: user.timezone || 'Asia/Jerusalem',
      dateStyle: 'long'
    });
    
    const incomplete = tasks.filter(t => !t.completed);
    const completed = tasks.filter(t => t.completed);
    
    let message = `📋 Your Tasks for Today (${today})\n\n`;
    
    if (incomplete.length > 0) {
      message += `📌 Incomplete:\n`;
      incomplete.forEach(task => {
        const time = task.due_date ? new Date(task.due_date).toLocaleTimeString('en-US', {
          timeZone: user.timezone || 'Asia/Jerusalem',
          timeStyle: 'short'
        }) : '';
        message += `- ${task.text}${time ? ` at ${time}` : ''}\n`;
      });
      message += `\n`;
    }
    
    if (completed.length > 0) {
      message += `✅ Completed:\n`;
      completed.forEach(task => {
        message += `- ${task.text}\n`;
      });
      message += `\n`;
    }
    
    message += `Total: ${incomplete.length} incomplete, ${completed.length} completed`;
    
    return message;
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

