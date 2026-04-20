import { logger as defaultLogger } from '../../utils/logger';
import { BaseService } from './BaseService';

export type UserPlanType = 'free' | 'standard' | 'pro';

/** Subscription status from billing (e.g. Stripe). 'active' = can use paid features. */
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'unpaid' | null;

export interface UserRecord {
  id: string;
  whatsapp_number: string;
  plan_type: UserPlanType;
  timezone: string | null;
  settings: Record<string, any>;
  google_email: string | null;
  onboarding_complete: boolean;
  onboarding_last_prompt_at: string | null;
  /** Local time for morning digest in HH:MM:SS format, interpreted in user's timezone. */
  morning_brief_time: string;
  created_at: string;
  updated_at: string;
  /** Billing subscription status. When not 'active', user is considered inactive and prompted to rejoin. */
  subscription_status: SubscriptionStatus;
  subscription_period_end: string | null;
  cancel_at_period_end: boolean;
}

export interface UserGoogleToken {
  id: string;
  user_id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  scope: string[] | null;
  token_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertGoogleTokenPayload {
  provider?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | string | number | null;
  scope?: string[] | null;
  tokenType?: string | null;
}

export interface UserAndGoogleTokensResult {
  user: UserRecord;
  googleTokens: UserGoogleToken | null;
}

export class UserService extends BaseService {
  constructor(loggerInstance: any = defaultLogger) {
    super(loggerInstance);
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `SELECT id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, morning_brief_time, created_at, updated_at,
              subscription_status, subscription_period_end, cancel_at_period_end
       FROM users
       WHERE id = $1`,
      [userId]
    );

    return row ? this.mapUser(row) : null;
  }

  async findByWhatsappNumber(whatsappNumber: string): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `SELECT id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, morning_brief_time, created_at, updated_at,
              subscription_status, subscription_period_end, cancel_at_period_end
       FROM users
       WHERE whatsapp_number = $1`,
      [whatsappNumber]
    );

    return row ? this.mapUser(row) : null;
  }

  async getUserAndGoogleTokensByPhone(
    whatsappNumber: string,
    provider: string = 'google'
  ): Promise<UserAndGoogleTokensResult | null> {
    const row = await this.executeSingleQuery<any>(
      `SELECT
         u.id AS user_id,
         u.whatsapp_number,
         u.plan_type,
         u.timezone,
         u.settings,
         u.google_email,
         u.onboarding_complete,
         u.onboarding_last_prompt_at,
         u.morning_brief_time,
         u.created_at AS user_created_at,
         u.updated_at AS user_updated_at,
         u.subscription_status,
         u.subscription_period_end,
         u.cancel_at_period_end,
         t.id AS token_id,
         t.user_id AS token_user_id,
         t.provider AS token_provider,
         t.access_token,
         t.refresh_token,
         t.expires_at,
         t.scope,
         t.token_type,
         t.created_at AS token_created_at,
         t.updated_at AS token_updated_at
       FROM users u
       LEFT JOIN user_google_tokens t
         ON t.user_id = u.id AND t.provider = $2
       WHERE u.whatsapp_number = $1`,
      [whatsappNumber, provider]
    );

    if (!row) {
      return null;
    }

    const user: UserRecord = this.mapUser({
      id: row.user_id,
      whatsapp_number: row.whatsapp_number,
      plan_type: row.plan_type,
      timezone: row.timezone,
      settings: row.settings,
      google_email: row.google_email,
      onboarding_complete: row.onboarding_complete,
      onboarding_last_prompt_at: row.onboarding_last_prompt_at,
      morning_brief_time: row.morning_brief_time,
      created_at: row.user_created_at,
      updated_at: row.user_updated_at,
      subscription_status: row.subscription_status,
      subscription_period_end: row.subscription_period_end,
      cancel_at_period_end: row.cancel_at_period_end,
    });

    const googleTokens: UserGoogleToken | null = row.token_id
      ? {
          id: row.token_id,
          user_id: row.token_user_id,
          provider: row.token_provider,
          access_token: row.access_token,
          refresh_token: row.refresh_token,
          expires_at: row.expires_at,
          scope: row.scope ?? null,
          token_type: row.token_type,
          created_at: row.token_created_at,
          updated_at: row.token_updated_at,
        }
      : null;

    return { user, googleTokens };
  }

  async findOrCreateByWhatsappNumber(whatsappNumber: string): Promise<UserRecord> {
    // Ensure user exists via database helper
    await this.executeSingleQuery(
      `SELECT get_or_create_user($1)`,
      [whatsappNumber]
    );

    const user = await this.findByWhatsappNumber(whatsappNumber);
    if (!user) {
      throw new Error('Failed to create or retrieve user record');
    }
    return user;
  }

  async updatePlanType(userId: string, planType: UserPlanType): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `UPDATE users
       SET plan_type = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, morning_brief_time, created_at, updated_at,
               subscription_status, subscription_period_end, cancel_at_period_end`,
      [userId, planType]
    );

    return row ? this.mapUser(row) : null;
  }

  async setOnboardingComplete(userId: string, complete: boolean = true): Promise<void> {
    await this.executeQuery(
      `UPDATE users
       SET onboarding_complete = $2, updated_at = NOW()
       WHERE id = $1`,
      [userId, complete]
    );
  }

  async updateGoogleEmail(userId: string, email: string | null): Promise<void> {
    await this.executeQuery(
      `UPDATE users
       SET google_email = $2, updated_at = NOW()
       WHERE id = $1`,
      [userId, email]
    );
  }

  async markOnboardingPrompted(userId: string): Promise<void> {
    await this.executeQuery(
      `UPDATE users
       SET onboarding_last_prompt_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
  }

  async upsertGoogleTokens(userId: string, payload: UpsertGoogleTokenPayload): Promise<UserGoogleToken> {
    const provider = payload.provider ?? 'google';
    const expiresAtValue = payload.expiresAt !== undefined && payload.expiresAt !== null
      ? this.normalizeDate(payload.expiresAt)
      : null;

    const row = await this.executeSingleQuery<UserGoogleToken>(
      `INSERT INTO user_google_tokens (user_id, provider, access_token, refresh_token, expires_at, scope, token_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         scope = EXCLUDED.scope,
         token_type = EXCLUDED.token_type,
         updated_at = NOW()
       RETURNING id, user_id, provider, access_token, refresh_token, expires_at, scope, token_type, created_at, updated_at`,
      [
        userId,
        provider,
        payload.accessToken ?? null,
        payload.refreshToken ?? null,
        expiresAtValue,
        payload.scope ?? null,
        payload.tokenType ?? null
      ]
    );

    if (!row) {
      throw new Error('Failed to persist Google tokens');
    }

    // Ensure scope is an array when returned
    return {
      ...row,
      scope: row.scope ?? null
    };
  }

  async getGoogleTokens(userId: string, provider: string = 'google'): Promise<UserGoogleToken | null> {
    const row = await this.executeSingleQuery<UserGoogleToken>(
      `SELECT id, user_id, provider, access_token, refresh_token, expires_at, scope, token_type, created_at, updated_at
       FROM user_google_tokens
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );

    if (!row) {
      return null;
    }

    return {
      ...row,
      scope: row.scope ?? null
    };
  }

  async deleteGoogleTokens(userId: string, provider: string = 'google'): Promise<void> {
    await this.executeQuery(
      `DELETE FROM user_google_tokens
       WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
  }

  private normalizeDate(value: Date | string | number): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }
    return new Date(value).toISOString();
  }

  async updateMorningBriefTime(userId: string, time: string): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `UPDATE users
       SET morning_brief_time = $2::TIME, updated_at = NOW()
       WHERE id = $1
       RETURNING id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, morning_brief_time, created_at, updated_at,
               subscription_status, subscription_period_end, cancel_at_period_end`,
      [userId, time]
    );

    return row ? this.mapUser(row) : null;
  }

  private mapUser(row: any): UserRecord {
    return {
      id: row.id,
      whatsapp_number: row.whatsapp_number,
      plan_type: row.plan_type,
      timezone: row.timezone ?? null,
      settings: typeof row.settings === 'object' && row.settings !== null ? row.settings : {},
      google_email: row.google_email ?? null,
      onboarding_complete: row.onboarding_complete ?? false,
      onboarding_last_prompt_at: row.onboarding_last_prompt_at ?? null,
      morning_brief_time: row.morning_brief_time ?? '08:00:00',
      created_at: row.created_at,
      updated_at: row.updated_at,
      subscription_status: row.subscription_status ?? null,
      subscription_period_end: row.subscription_period_end ?? null,
      cancel_at_period_end: row.cancel_at_period_end === true,
    };
  }
}

