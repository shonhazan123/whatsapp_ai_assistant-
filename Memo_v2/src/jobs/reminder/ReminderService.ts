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
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage } from '../../services/whatsapp';
import { getDatePartsInTimezone, buildDateTimeISOInZone } from '../../utils/userTimezone.js';

interface User {
  id: string;
  phone: string;
  timezone: string;
  /** From users.settings.user_name; used only for morning digest greeting. */
  userName?: string;
  /** Hour component of the user's preferred morning brief time (0-23). Defaults to 8. */
  morningBriefHour: number;
  /** Minute component of the user's preferred morning brief time (0-59). Defaults to 0. */
  morningBriefMinute: number;
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
        `SELECT id, whatsapp_number AS phone, COALESCE(timezone, 'Asia/Jerusalem') AS timezone, settings, morning_brief_time
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
      const { hour: briefHour, minute: briefMinute } = this.parseBriefTime(row.morning_brief_time);
      const user: User = {
        id: row.id,
        phone: row.phone,
        timezone: row.timezone,
        morningBriefHour: briefHour,
        morningBriefMinute: briefMinute,
        ...(userName !== undefined && { userName }),
      };
      
      const plannedTasks = await this.getTodaysTasks(user.id, user.timezone);
      const unplannedTasks = await this.getUnplannedTasks(user.id);
      const calendarEvents = await this.getTodaysCalendarEvents(user.id, user.timezone);
      
      let digestBody: string;
      if (plannedTasks.length > 0 || unplannedTasks.length > 0 || calendarEvents.length > 0) {
        const rawData = this.buildDailyDigestData(plannedTasks, unplannedTasks, calendarEvents, user);
        digestBody = await this.enhanceMessageWithAI(rawData, user.phone);
      } else {
        const rawData = this.buildEmptyDigestData(user);
        digestBody = await this.enhanceMessageWithAI(rawData, user.phone);
      }
      // Debug path: same WhatsApp send as production, but do not add ConversationWindow briefContext
      // (previous behavior: only sendWhatsAppMessage + memory from that path).
      await this.sendMorningDigestToWhatsApp(user, digestBody, {
        recordConversationWindow: false,
      });
    } catch (error) {
      this.loggerInstance.error(`Failed to send morning digest to ${userPhone}:`, error);
      throw error;
    }
  }

  /**
   * Send daily digest for today's tasks using each user's preferred brief time.
   * The fallbackHour is only used if a user somehow has no morning_brief_time in DB (shouldn't happen with the NOT NULL default).
   */
  async sendMorningDigest(fallbackHour: number = 8): Promise<void> {
    try {
      const users = await this.getAllUsers();

      const batchSize = 5;
      const userBatches: User[][] = [];
      for (let i = 0; i < users.length; i += batchSize) {
        userBatches.push(users.slice(i, i + batchSize));
      }

      for (const batch of userBatches) {
        await Promise.all(batch.map(async (user) => {
          try {
            if (ENVIRONMENT === 'DEBUG' && user.phone !== DEBUG_PHONE_NUMBER) {
              return;
            }
            
            if (!this.isValidTimezone(user.timezone)) {
              this.loggerInstance.warn(`⚠️  Invalid timezone "${user.timezone}" for user ${user.phone}, using default Asia/Jerusalem`);
              user.timezone = 'Asia/Jerusalem';
            }
            
            const userTime = this.getCurrentTimeInTimezone(user.timezone);
            const localTotalMin = userTime.hour * 60 + userTime.minute;
            const targetTotalMin = user.morningBriefHour * 60 + user.morningBriefMinute;

            if (localTotalMin >= targetTotalMin && localTotalMin < targetTotalMin + 15) {
              this.loggerInstance.info(`📧 Sending morning digest to ${user.phone} (${user.timezone}, target: ${String(user.morningBriefHour).padStart(2, '0')}:${String(user.morningBriefMinute).padStart(2, '0')})`);
              
              const success = await this.sendMorningDigestToUser(user, user.morningBriefHour);
              if (!success) {
                this.loggerInstance.error(`❌ Failed to send morning digest to ${user.phone}`);
              }
            }
          } catch (error) {
            this.loggerInstance.error(`❌ Error processing morning digest for ${user.phone}:`, error);
          }
        }));
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
   * Get all users with their timezone, settings, and morning brief time preference.
   */
  private async getAllUsers(): Promise<User[]> {
    const result = await query(
      `SELECT id, whatsapp_number AS phone, COALESCE(timezone, 'Asia/Jerusalem') AS timezone, settings, morning_brief_time FROM users`
    );
    return result.rows.map((row: { id: string; phone: string; timezone: string; settings?: Record<string, unknown>; morning_brief_time?: string }) => {
      const settings = typeof row.settings === 'object' && row.settings !== null ? row.settings : {};
      const rawName = settings.user_name;
      const userName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
      const { hour: briefHour, minute: briefMinute } = this.parseBriefTime(row.morning_brief_time);
      return {
        id: row.id,
        phone: row.phone,
        timezone: row.timezone,
        morningBriefHour: briefHour,
        morningBriefMinute: briefMinute,
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
    const tz = recurrence.timezone || 'Asia/Jerusalem';
    const p = getDatePartsInTimezone(tz, currentTime);
    const fmtDate = (yr: number, mo: number, dy: number) =>
      `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;

    let resultISO: string;

    switch (recurrence.type) {
      case 'nudge': {
        const interval = recurrence.interval || '10 minutes';
        const minutes = this.parseIntervalToMinutes(interval);
        if (minutes < 1) throw new Error('Nudge interval must be at least 1 minute');

        if (task?.due_date) {
          const dueDate = new Date(task.due_date);
          const msSinceDueDate = currentTime.getTime() - dueDate.getTime();
          const minutesSinceDueDate = Math.floor(msSinceDueDate / (1000 * 60));
          const intervalsPassed = Math.floor(minutesSinceDueDate / minutes);
          const nextMs = dueDate.getTime() + (intervalsPassed + 1) * minutes * 60_000;
          let nextD = new Date(nextMs);
          if (nextD <= currentTime) nextD = new Date(nextD.getTime() + minutes * 60_000);
          const np = getDatePartsInTimezone(tz, nextD);
          resultISO = buildDateTimeISOInZone(
            fmtDate(np.year, np.month, np.day),
            `${String(np.hour).padStart(2, '0')}:${String(np.minute).padStart(2, '0')}`, tz
          );
        } else {
          const total = p.hour * 60 + p.minute + minutes;
          const nH = Math.floor(total / 60) % 24;
          const nM = total % 60;
          let dateStr = fmtDate(p.year, p.month, p.day);
          if (total >= 1440) {
            const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
            const np = getDatePartsInTimezone(tz, d);
            dateStr = fmtDate(np.year, np.month, np.day);
          }
          resultISO = buildDateTimeISOInZone(dateStr, `${String(nH).padStart(2, '0')}:${String(nM).padStart(2, '0')}`, tz);
        }
        break;
      }

      case 'daily': {
        if (!recurrence.time) throw new Error('Daily recurrence requires time');
        const [rH, rM] = recurrence.time.split(':').map(Number);
        const userMin = p.hour * 60 + p.minute;
        const targetMin = rH * 60 + rM;
        let dateStr = fmtDate(p.year, p.month, p.day);
        if (targetMin <= userMin) {
          const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
          const tp = getDatePartsInTimezone(tz, tomorrow);
          dateStr = fmtDate(tp.year, tp.month, tp.day);
        }
        resultISO = buildDateTimeISOInZone(dateStr, recurrence.time, tz);
        break;
      }

      case 'weekly': {
        if (!recurrence.time) throw new Error('Weekly recurrence requires time');
        if (!recurrence.days || recurrence.days.length === 0) throw new Error('Weekly recurrence requires days array');
        const [rH, rM] = recurrence.time.split(':').map(Number);
        const userMin = p.hour * 60 + p.minute;
        const targetMin = rH * 60 + rM;
        const todayIsMatch = recurrence.days.includes(p.dayOfWeek);
        const timeStillAhead = targetMin > userMin;

        if (todayIsMatch && timeStillAhead) {
          resultISO = buildDateTimeISOInZone(fmtDate(p.year, p.month, p.day), recurrence.time, tz);
          break;
        }

        let found = false;
        for (let i = 1; i <= 7; i++) {
          const futureDate = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
          const fp = getDatePartsInTimezone(tz, futureDate);
          if (recurrence.days.includes(fp.dayOfWeek)) {
            resultISO = buildDateTimeISOInZone(fmtDate(fp.year, fp.month, fp.day), recurrence.time, tz);
            found = true;
            break;
          }
        }
        if (!found) throw new Error('Could not find next weekly occurrence');
        break;
      }

      case 'monthly': {
        if (!recurrence.time) throw new Error('Monthly recurrence requires time');
        if (!recurrence.dayOfMonth) throw new Error('Monthly recurrence requires dayOfMonth');
        const [rH, rM] = recurrence.time.split(':').map(Number);
        const userMin = p.hour * 60 + p.minute;
        const targetMin = rH * 60 + rM;
        const maxDay = new Date(p.year, p.month, 0).getDate();
        const dayToSet = Math.min(recurrence.dayOfMonth, maxDay);
        const todayIsDay = p.day === dayToSet;

        if (todayIsDay && targetMin > userMin) {
          resultISO = buildDateTimeISOInZone(fmtDate(p.year, p.month, dayToSet), recurrence.time, tz);
          break;
        }
        if (!todayIsDay && p.day < dayToSet) {
          resultISO = buildDateTimeISOInZone(fmtDate(p.year, p.month, dayToSet), recurrence.time, tz);
          break;
        }

        let nextMonth = p.month + 1;
        let nextYear = p.year;
        if (nextMonth > 12) { nextMonth = 1; nextYear++; }
        const nextMaxDay = new Date(nextYear, nextMonth, 0).getDate();
        const nextDayToSet = Math.min(recurrence.dayOfMonth, nextMaxDay);
        resultISO = buildDateTimeISOInZone(fmtDate(nextYear, nextMonth, nextDayToSet), recurrence.time, tz);
        break;
      }

      default:
        throw new Error(`Unknown recurrence type: ${recurrence.type}`);
    }

    if (recurrence.until) {
      const untilDate = new Date(recurrence.until);
      if (new Date(resultISO!) > untilDate) {
        throw new Error('Next reminder time exceeds until date');
      }
    }

    return new Date(resultISO!);
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
        data += `- ${event.summary }${startTime ? ` from ${startTime}` : ''}${endTime ? ` to ${endTime}` : ''}\n`;
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
   * Full message text for memory / conversation window (matches non-template send).
   * Template in Meta should use: בוקר טוב{{1}}! ☀️ with {{1}} = name slot (space + name or empty).
   */
  private buildMorningDigestDisplay(user: User, digestBody: string): string {
    const greeting = user.userName
      ? `בוקר טוב ${user.userName} ☀️\n\n`
      : 'בוקר טוב ☀️\n\n';
    return greeting + digestBody;
  }

  /**
   * Sends morning digest: **plain text by default** (`sendWhatsAppMessage`).
   * Uses `sendWhatsAppTemplateMessage` only when `WHATSAPP_TEMPLATE_HE_MORNING` is set (proactive / outside-session policy).
   * Graph agent replies are not sent from here.
   *
   * @param recordConversationWindow — When true (scheduled digest), append to ConversationWindow with briefContext.
   *   When false (sendMorningDigestForUser debug), match legacy behavior: send only, no brief row in ConversationWindow.
   */
  private async sendMorningDigestToWhatsApp(
    user: User,
    digestBody: string,
    options?: { recordConversationWindow?: boolean },
  ): Promise<void> {
    const recordConversationWindow = options?.recordConversationWindow !== false;
    const templateName = process.env.WHATSAPP_TEMPLATE_HE_MORNING?.trim();
    const lang = process.env.WHATSAPP_TEMPLATE_LANG_HE || 'he';
    const display = this.buildMorningDigestDisplay(user, digestBody);
    if (templateName) {
      const nameSlot = user.userName ? ` ${user.userName}` : '';
      await sendWhatsAppTemplateMessage(
        user.phone,
        templateName,
        lang,
        [nameSlot, digestBody],
        { memoryText: display },
      );
    } else {
      await sendWhatsAppMessage(user.phone, display);
    }
    if (recordConversationWindow) {
      this.conversationWindow.addMessage(
        user.phone,
        'assistant',
        display,
        {
          briefContext: {
            type: 'morning_digest',
            sentAt: new Date().toISOString(),
          },
        },
      );
    }
  }

  /**
   * Parse a Postgres TIME value (e.g. "08:00:00" or "07:30:00") into hour and minute.
   * Falls back to 8:00 if the value is null/undefined or unparseable.
   */
  private parseBriefTime(timeValue: string | null | undefined): { hour: number; minute: number } {
    if (!timeValue) return { hour: 8, minute: 0 };
    const parts = timeValue.split(':');
    const hour = parseInt(parts[0], 10);
    const minute = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (isNaN(hour) || hour < 0 || hour > 23) return { hour: 8, minute: 0 };
    if (isNaN(minute) || minute < 0 || minute > 59) return { hour, minute: 0 };
    return { hour, minute };
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
        
        let digestBody: string;
        if (plannedTasks.length > 0 || unplannedTasks.length > 0 || calendarEvents.length > 0) {
          const rawData = this.buildDailyDigestData(plannedTasks, unplannedTasks, calendarEvents, user);
          digestBody = await this.enhanceMessageWithAI(rawData, user.phone);
        } else {
          const rawData = this.buildEmptyDigestData(user);
          digestBody = await this.enhanceMessageWithAI(rawData, user.phone);
        }
        await this.sendMorningDigestToWhatsApp(user, digestBody);
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

