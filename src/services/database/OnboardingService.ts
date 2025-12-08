import { logger as defaultLogger } from '../../utils/logger';
import { BaseService } from './BaseService';

export type OnboardingStep = 'start' | 'google_connect' | 'iphone_calendar_sync' | 'calendar_practice' | 'reminder_practice' | 'memory_practice' | 'done';

export interface OnboardingProgress {
  user_id: string;
  step: OnboardingStep;
  completed: boolean;
  updated_at: string;
}

export class OnboardingService extends BaseService {
  constructor(loggerInstance: any = defaultLogger) {
    super(loggerInstance);
  }

  /**
   * Get onboarding progress for a user
   * Creates a new record with default 'start' step if none exists
   */
  async getOnboardingProgress(userId: string): Promise<OnboardingProgress> {
    let row = await this.executeSingleQuery<OnboardingProgress>(
      `SELECT user_id, step, completed, updated_at
       FROM user_onboarding_progress
       WHERE user_id = $1`,
      [userId]
    );

    // If no record exists, create one with default 'start' step
    if (!row) {
      row = await this.executeSingleQuery<OnboardingProgress>(
        `INSERT INTO user_onboarding_progress (user_id, step, completed)
         VALUES ($1, 'start', FALSE)
         RETURNING user_id, step, completed, updated_at`,
        [userId]
      );
      
      if (!row) {
        throw new Error('Failed to create onboarding progress record');
      }
    }

    return row;
  }

  /**
   * Update onboarding progress
   */
  async updateOnboardingProgress(
    userId: string,
    step: OnboardingStep,
    completed: boolean = false
  ): Promise<OnboardingProgress> {
    const row = await this.executeSingleQuery<OnboardingProgress>(
      `INSERT INTO user_onboarding_progress (user_id, step, completed)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) 
       DO UPDATE SET step = $2, completed = $3, updated_at = NOW()
       RETURNING user_id, step, completed, updated_at`,
      [userId, step, completed]
    );

    if (!row) {
      throw new Error('Failed to update onboarding progress');
    }

    return row;
  }

  /**
   * Check if onboarding is complete
   */
  async isOnboardingComplete(userId: string): Promise<boolean> {
    const progress = await this.getOnboardingProgress(userId);
    return progress.step === 'done' && progress.completed === true;
  }

  /**
   * Reset onboarding to start (for testing)
   */
  async resetOnboarding(userId: string): Promise<void> {
    await this.executeQuery(
      `UPDATE user_onboarding_progress
       SET step = 'start', completed = FALSE, updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  }
}

