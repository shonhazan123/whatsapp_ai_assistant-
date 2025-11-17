import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { logger } from '../../utils/logger';
import { UserGoogleToken, UserRecord, UserService } from '../database/UserService';

export interface OAuthStatePayload {
  userId: string;
  planType?: string;
  redirectPath?: string;
  issuedAt: number;
  nonce?: string;
}

export interface OAuthCallbackResult {
  user: UserRecord;
  profile: {
    email: string | null | undefined;
    name: string | null | undefined;
    picture: string | null | undefined;
  };
  tokens: UserGoogleToken;
  state: OAuthStatePayload;
}

export class GoogleOAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private defaultScopes: string[];
  private jwtSecret: string;

  constructor(
    private userService: UserService = new UserService(),
    private log = logger
  ) {
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    this.redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      `${process.env.APP_PUBLIC_URL || ''}/auth/google/callback`;

    const scopesFromEnv = process.env.GOOGLE_OAUTH_SCOPES
      ? process.env.GOOGLE_OAUTH_SCOPES.split(',').map(scope => scope.trim()).filter(Boolean)
      : [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/gmail.modify',
          'openid',
          'email',
          'profile'
        ];

    this.defaultScopes = Array.from(new Set(scopesFromEnv));

    this.jwtSecret = process.env.JWT_SECRET || '';

    if (!this.clientId || !this.clientSecret || !this.redirectUri) {
      throw new Error('Google OAuth environment variables are not fully configured');
    }
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is required for OAuth state signing');
    }
  }

  /**
   * Generate a signed state token that encodes the user context for the OAuth flow.
   */
  createStateToken(payload: { userId: string; planType?: string; redirectPath?: string }): string {
    const statePayload: OAuthStatePayload = {
      userId: payload.userId,
      planType: payload.planType,
      redirectPath: payload.redirectPath,
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(8).toString('hex')
    };

    const serialized = JSON.stringify(statePayload);
    const encoded = this.base64UrlEncode(Buffer.from(serialized, 'utf8'));
    const signature = this.signPayload(encoded);
    return `${encoded}.${signature}`;
  }

  /**
   * Generate the Google OAuth authorization URL.
   */
  async getAuthorizationUrl(stateToken: string): Promise<string> {
    const state = this.verifyStateToken(stateToken);
    const user = await this.userService.findById(state.userId);

    if (!user) {
      throw new Error('User not found for authorization request');
    }

    const scopes = this.getScopesForPlan(user.plan_type);
    if (scopes.length === 0) {
      throw new Error('User plan does not permit Google integrations');
    }

    const oauthClient = this.createOAuthClient();

    const url = oauthClient.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: scopes,
      state: stateToken
    });

    this.log.info(`Generated Google OAuth URL for user ${user.id} with scopes: ${scopes.join(', ')}`);
    return url;
  }

  /**
   * Handle Google OAuth callback, exchange code for tokens, and persist credentials.
   */
  async handleOAuthCallback(code: string, stateToken: string): Promise<OAuthCallbackResult> {
    const state = this.verifyStateToken(stateToken);
    const user = await this.userService.findById(state.userId);

    if (!user) {
      throw new Error('User not found for OAuth callback');
    }

    const oauthClient = this.createOAuthClient();
    const { tokens } = await oauthClient.getToken(code);

    this.log.info(`Received Google OAuth tokens for user ${user.id}`);

    oauthClient.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauthClient });
    const profileResponse = await oauth2.userinfo.get();

    const existingTokens = await this.userService.getGoogleTokens(user.id);

    const normalizedScopes = tokens.scope
      ? this.normalizeScopes(tokens.scope)
      : this.getScopesForPlan(user.plan_type);

    const upsertedTokens = await this.userService.upsertGoogleTokens(user.id, {
      accessToken: tokens.access_token ?? existingTokens?.access_token ?? null,
      refreshToken: tokens.refresh_token ?? existingTokens?.refresh_token ?? null,
      expiresAt: tokens.expiry_date ?? null,
      scope: normalizedScopes,
      tokenType: tokens.token_type ?? existingTokens?.token_type ?? null
    });

    const userEmail = profileResponse.data?.email || null;
    await this.userService.updateGoogleEmail(user.id, userEmail);
    await this.userService.setOnboardingComplete(user.id, true);

    return {
      user,
      profile: {
        email: userEmail,
        name: profileResponse.data?.name,
        picture: profileResponse.data?.picture
      },
      tokens: upsertedTokens,
      state
    };
  }

  /**
   * Validate and decode the state token.
   */
  verifyStateToken(stateToken: string): OAuthStatePayload {
    const [encoded, signature] = stateToken.split('.');
    if (!encoded || !signature) {
      throw new Error('Invalid OAuth state format');
    }

    const expectedSignature = this.signPayload(encoded);
    if (!this.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      throw new Error('Invalid OAuth state signature');
    }

    const payloadBuffer = this.base64UrlDecode(encoded);
    const payload = JSON.parse(payloadBuffer.toString('utf8')) as OAuthStatePayload;

    // Optional: enforce expiry (e.g., 30 minutes)
    const maxAgeMs = 30 * 60 * 1000;
    if (Date.now() - payload.issuedAt > maxAgeMs) {
      throw new Error('OAuth state has expired');
    }

    return payload;
  }

  /**
   * Determine Google scopes based on the user's plan.
   */
  getScopesForPlan(planType: UserRecord['plan_type']): string[] {
    const calendarScope = 'https://www.googleapis.com/auth/calendar';
    const gmailScope = 'https://www.googleapis.com/auth/gmail.modify';
    const baseScopes = ['openid', 'email', 'profile'];

    switch (planType) {
      case 'pro':
        return Array.from(new Set([...baseScopes, calendarScope, gmailScope]));
      case 'standard':
        return Array.from(new Set([...baseScopes, calendarScope]));
      case 'free':
      default:
        return baseScopes;
    }
  }

  private createOAuthClient(): OAuth2Client {
    return new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
  }

  private normalizeScopes(scope: string | string[]): string[] {
    if (Array.isArray(scope)) {
      return scope;
    }
    return scope
      .split(/\s+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  private signPayload(encodedPayload: string): string {
    const hmac = crypto.createHmac('sha256', this.jwtSecret);
    hmac.update(encodedPayload);
    return this.base64UrlEncode(hmac.digest());
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private base64UrlDecode(input: string): Buffer {
    const padded = input.padEnd(input.length + (4 - (input.length % 4)) % 4, '=');
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64');
  }

  private timingSafeEqual(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  }
}

export const googleOAuthService = new GoogleOAuthService();

