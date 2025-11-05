import cron from 'node-cron';
import { logger } from '../../utils/logger';
import { ReminderService } from '../reminder/ReminderService';

export class SchedulerService {
  private reminderService: ReminderService;
  private isRunning: boolean = false;

  constructor(reminderService?: ReminderService) {
    this.reminderService = reminderService || new ReminderService();
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

    // Run reminder checks every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      try {
        logger.debug('⏰ Running scheduled reminder check...');
        await this.reminderService.sendUpcomingReminders();
      } catch (error) {
        logger.error('❌ Error in scheduled reminder check:', error);
        // Continue running - don't let one failure stop the scheduler
      }
    });

    logger.info('✅ Scheduled reminder checks every 5 minutes');

    // Run daily digest at multiple UTC times to cover different timezones
    // The ReminderService.sendMorningDigest() method handles timezone filtering
    // Run at 5, 6, 7, 8, 9, 10, 11 UTC to cover timezones from UTC-3 to UTC+3 (including Asia/Jerusalem at UTC+2/+3)
    const digestHours = [5, 6, 7, 8, 9, 10, 11];
    
    digestHours.forEach(hour => {
      cron.schedule(`0 ${hour} * * *`, async () => {
        try {
          logger.debug(`⏰ Running scheduled morning digest check at ${hour}:00 UTC...`);
          await this.reminderService.sendMorningDigest();
        } catch (error) {
          logger.error(`❌ Error in scheduled morning digest at ${hour}:00 UTC:`, error);
          // Continue running - don't let one failure stop the scheduler
        }
      });
    });

    logger.info(`✅ Scheduled daily digest checks at ${digestHours.join(', ')}:00 UTC`);

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
    await this.reminderService.sendMorningDigest();
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

