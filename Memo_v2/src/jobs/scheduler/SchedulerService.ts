import cron from 'node-cron';
import { logger } from '../../legacy/utils/logger';
import { ReminderService } from '../reminder/ReminderService';

export class SchedulerService {
  private reminderService: ReminderService;
  private isRunning: boolean = false;
  private morningDigestHour: number;

  constructor(reminderService?: ReminderService, morningDigestHour: number = 8) {
    this.reminderService = reminderService || new ReminderService();
    this.morningDigestHour = morningDigestHour;
  }

  /**
   * Start all scheduled jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('⚠️  Scheduler is already running');
      return;
    }

    logger.info('📅 Starting reminder scheduler...');

    // Run reminder checks every 1 minutes
    cron.schedule('*/1 * * * *', async () => {
      try {
        await this.reminderService.sendUpcomingReminders();
      } catch (error) {
        logger.error('❌ Error in scheduled reminder check:', error);
        // Continue running - don't let one failure stop the scheduler
      }
    });

    logger.info('✅ Scheduled reminder checks every 5 minutes');

    // Run daily digest check every hour
    // The ReminderService.sendMorningDigest() method handles timezone filtering
    // It checks if it's the configured hour for each user's timezone
    cron.schedule('0 * * * *', async () => {
      try {
        await this.reminderService.sendMorningDigest(this.morningDigestHour);
      } catch (error) {
        logger.error('❌ Error in scheduled morning digest:', error);
      }
    });

    logger.info(`✅ Scheduled daily digest checks every hour (per-user preferred time, fallback: ${this.morningDigestHour}:00)`);

    this.isRunning = true;
    logger.info('✅ Reminder scheduler started successfully');
  }

  /**
   * Stop all scheduled jobs (for testing/cleanup)
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn('⚠️  Scheduler is not running');
      return;
    }
    
    // Note: node-cron doesn't have a built-in stop method for all tasks
    // This is mainly for tracking state
    this.isRunning = false;
    logger.info('🛑 Scheduler stopped');
  }

  /**
   * Manually trigger reminder check (for testing)
   */
  async triggerReminderCheck(): Promise<void> {
    logger.info('🔔 Manually triggering reminder check...');
    await this.reminderService.sendUpcomingReminders();
  }

  /**
   * Manually trigger morning digest (for testing)
   */
  async triggerMorningDigest(): Promise<void> {
    logger.info('📋 Manually triggering morning digest...');
    await this.reminderService.sendMorningDigest(this.morningDigestHour);
  }

  /**
   * Set morning digest hour
   */
  setMorningDigestHour(hour: number): void {
    if (hour < 0 || hour > 23) {
      throw new Error('Morning digest hour must be between 0 and 23');
    }
    this.morningDigestHour = hour;
    logger.info(`📅 Morning digest hour updated to ${hour}:00`);
  }

  /**
   * Get morning digest hour
   */
  getMorningDigestHour(): number {
    return this.morningDigestHour;
  }

  /**
   * Get scheduler status
   */
  getStatus(): { isRunning: boolean } {
    return {
      isRunning: this.isRunning
    };
  }
}

