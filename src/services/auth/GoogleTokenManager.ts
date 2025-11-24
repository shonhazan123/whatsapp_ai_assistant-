import { google } from 'googleapis';
import { logger } from '../../utils/logger';
import { UserGoogleToken, UserRecord, UserService } from '../database/UserService';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  (process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback` : undefined);

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export interface TokenCheckResult {
  tokens: UserGoogleToken | null;
  googleConnected: boolean;
  needsReauth: boolean;
}

export class GoogleTokenManager {
  constructor(
    private userService: UserService = new UserService(),
    private log = logger
  ) {}

  async ensureFreshTokens(
    user: UserRecord,
    tokens: UserGoogleToken | null,
    options: { forceRefresh?: boolean } = {}
  ): Promise<TokenCheckResult> {
    if (!tokens) {
      return { tokens: null, googleConnected: false, needsReauth: false };
    }

    if (!tokens.refresh_token) {
      this.log.warn(`Google tokens missing refresh token for user ${user.id}`);
      await this.clearTokens(user.id);
      return { tokens: null, googleConnected: false, needsReauth: true };
    }

    const expiresAt = tokens.expires_at ? new Date(tokens.expires_at).getTime() : null;
    const shouldRefresh =
      options.forceRefresh || !expiresAt || expiresAt <= Date.now() + TOKEN_REFRESH_BUFFER_MS;

    if (!shouldRefresh) {
      return { tokens, googleConnected: true, needsReauth: false };
    }

    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      this.log.error('Google OAuth environment variables are not configured; cannot refresh tokens');
      return { tokens, googleConnected: true, needsReauth: false };
    }

    try {
      const oauthClient = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      oauthClient.setCredentials({
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token
      });

      const { credentials } = await oauthClient.refreshAccessToken();
      const updatedTokens = await this.userService.upsertGoogleTokens(user.id, {
        accessToken: credentials.access_token ?? tokens.access_token ?? null,
        refreshToken: credentials.refresh_token ?? tokens.refresh_token ?? null,
        expiresAt: credentials.expiry_date ?? null,
        scope: credentials.scope
          ? Array.isArray(credentials.scope)
            ? credentials.scope
            : credentials.scope.split(' ')
          : tokens.scope ?? null,
        tokenType: credentials.token_type ?? tokens.token_type ?? null
      });

      this.log.info(`Refreshed Google access token for user ${user.id}`);
      return { tokens: updatedTokens, googleConnected: true, needsReauth: false };
    } catch (error: any) {
      if (this.isInvalidGrantError(error)) {
        this.log.warn(`Google refresh token invalid for user ${user.id}; clearing tokens`);
        await this.clearTokens(user.id);
        return { tokens: null, googleConnected: false, needsReauth: true };
      }

      this.log.error('Unexpected error refreshing Google tokens', error);
      throw error;
    }
  }

  private async clearTokens(userId: string): Promise<void> {
    await this.userService.deleteGoogleTokens(userId);
  }

  private isInvalidGrantError(error: any): boolean {
    const code = error?.code || error?.response?.status;
    if (code === 401) {
      return true;
    }
    const errorDescription =
      error?.response?.data?.error ||
      error?.response?.data?.error_description ||
      error?.message ||
      '';
    return typeof errorDescription === 'string' && errorDescription.toLowerCase().includes('invalid_grant');
  }
}

