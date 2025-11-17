import { logger as defaultLogger } from '../../utils/logger';
import { BaseService } from './BaseService';

export type UserPlanType = 'free' | 'standard' | 'pro';

export interface UserRecord {
  id: string;
  whatsapp_number: string;
  plan_type: UserPlanType;
  timezone: string | null;
  settings: Record<string, any>;
  google_email: string | null;
  onboarding_complete: boolean;
  onboarding_last_prompt_at: string | null;
  created_at: string;
  updated_at: string;
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

export class UserService extends BaseService {
  constructor(loggerInstance: any = defaultLogger) {
    super(loggerInstance);
  }

  async findById(userId: string): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `SELECT id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    return row ? this.mapUser(row) : null;
  }

  async findByWhatsappNumber(whatsappNumber: string): Promise<UserRecord | null> {
    const row = await this.executeSingleQuery<any>(
      `SELECT id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, created_at, updated_at
       FROM users
       WHERE whatsapp_number = $1`,
      [whatsappNumber]
    );

    return row ? this.mapUser(row) : null;
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
       RETURNING id, whatsapp_number, plan_type, timezone, settings, google_email, onboarding_complete, onboarding_last_prompt_at, created_at, updated_at`,
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
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

