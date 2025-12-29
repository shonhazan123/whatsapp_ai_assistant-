# Backend Implementation Instructions: Google OAuth & User Database Management

## Overview

This document explains the complete backend logic for Google OAuth authentication and user database management as implemented in this system.

---

## Part 1: User Database Management

### How Users Are Created/Retrieved

The system uses a **database function** approach to ensure users exist before any operation. This is the standard pattern used throughout the codebase.

#### Database Function: `get_or_create_user`

**Location**: Defined in database migration scripts (e.g., `scripts/COMPLETE-DATABASE-SETUP.sql`)

**SQL Function**:

```sql
CREATE OR REPLACE FUNCTION get_or_create_user(phone_number TEXT)
RETURNS UUID AS $$
DECLARE
    user_uuid UUID;
BEGIN
    -- Try to find existing user
    SELECT id INTO user_uuid FROM users WHERE whatsapp_number = phone_number;

    -- If not found, create new user
    IF user_uuid IS NULL THEN
        INSERT INTO users (whatsapp_number) VALUES (phone_number) RETURNING id INTO user_uuid;
    END IF;

    RETURN user_uuid;
END;
$$ LANGUAGE plpgsql;
```

**How It Works**:

1. Takes a WhatsApp number (phone_number) as input
2. Searches for existing user with that number
3. If found → returns existing UUID
4. If not found → creates new user with default values and returns new UUID
5. Always returns a UUID (never null)

**Actual Schema (from Supabase)**:

```sql
CREATE TABLE public.users (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  whatsapp_number TEXT NOT NULL,
  timezone TEXT NULL DEFAULT 'Asia/Jerusalem',
  settings JSONB NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NULL DEFAULT now(),
  plan_type TEXT NOT NULL DEFAULT 'standard',
  google_email TEXT NULL,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  onboarding_last_prompt_at TIMESTAMP WITH TIME ZONE NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_whatsapp_number_unique UNIQUE (whatsapp_number),
  CONSTRAINT users_plan_type_check CHECK (
    plan_type = ANY(ARRAY['free'::text, 'standard'::text, 'pro'::text])
  )
);
```

**Default Values on Creation**:

- `id`: Auto-generated UUID
- `plan_type`: `'standard'` (NOT NULL, from table default)
- `timezone`: `'Asia/Jerusalem'` (nullable, from table default)
- `settings`: `'{}'` (nullable, empty JSONB object)
- `onboarding_complete`: `false` (NOT NULL)
- `google_email`: `NULL` (nullable)
- `created_at`: `now()` (nullable, from table default)
- `updated_at`: `now()` (NOT NULL, from table default)
- `onboarding_last_prompt_at`: `NULL` (nullable)

**Constraints**:

- Primary key on `id`
- Unique constraint on `whatsapp_number` (enforced by `users_whatsapp_number_unique`)
- Check constraint on `plan_type` (must be 'free', 'standard', or 'pro')
- Trigger: `set_users_updated_at` - Auto-updates `updated_at` on UPDATE

#### TypeScript Service Method: `findOrCreateByWhatsappNumber`

**Location**: `src/services/database/UserService.ts`

**Method**:

```typescript
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
```

**Usage Pattern**:

```typescript
import { UserService } from "../services/database/UserService";

const userService = new UserService();
const user = await userService.findOrCreateByWhatsappNumber("+1234567890");
// user is guaranteed to exist after this call
```

**Important Notes**:

- This is the **ONLY** way users should be created in the system
- Always use this method, never direct INSERT statements
- The method is idempotent - safe to call multiple times
- Returns a `UserRecord` object with all user fields

---

## Part 2: Google OAuth Flow - Complete Backend Logic

### Overview

The OAuth flow consists of 3 main steps:

1. **Initiation**: Generate state token and redirect URL
2. **Authorization**: User authorizes on Google (handled by Google)
3. **Callback**: Exchange code for tokens and store in database

### Step 1: OAuth Initiation (Starting the Flow)

**Service**: `GoogleOAuthService` (`src/services/auth/GoogleOAuthService.ts`)

**Required Steps**:

1. **Get or Create User**:

```typescript
import { UserService } from "../services/database/UserService";
import { googleOAuthService } from "../services/auth/GoogleOAuthService";

const userService = new UserService();
const whatsappNumber = req.query.phone as string; // or from session/token

// CRITICAL: Use findOrCreateByWhatsappNumber - this is the system pattern
const user = await userService.findOrCreateByWhatsappNumber(whatsappNumber);
```

2. **Generate State Token**:

```typescript
const stateToken = googleOAuthService.createStateToken({
	userId: user.id, // Required: UUID from database
	planType: user.plan_type, // Optional: 'free' | 'standard' | 'pro'
	redirectPath: "/success", // Optional: where to redirect after OAuth
});
```

**What `createStateToken` Does**:

- Creates a payload: `{ userId, planType?, redirectPath?, issuedAt, nonce }`
- Base64URL encodes the payload
- Signs it with HMAC-SHA256 using `JWT_SECRET`
- Returns: `"<encoded_payload>.<signature>"`
- **Security**: State token expires after 30 minutes

3. **Get Authorization URL**:

```typescript
const authUrl = await googleOAuthService.getAuthorizationUrl(stateToken);
// Redirect user to this URL
res.redirect(authUrl);
```

**What `getAuthorizationUrl` Does**:

- Verifies the state token (signature + expiry)
- Retrieves user from database using `userId` from state
- Determines scopes based on user's plan type:
  - `'pro'` → Calendar + Gmail + base scopes
  - `'standard'` → Calendar + base scopes
  - `'free'` → Base scopes only
- Generates Google OAuth URL with:
  - `access_type: 'offline'` (to get refresh token)
  - `prompt: 'consent'` (to force consent screen)
  - `include_granted_scopes: true`
  - `scope`: Array of required scopes
  - `state`: The state token (for verification on callback)

**Required Scopes** (for Calendar + Gmail):

- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`
- `openid`
- `email`
- `profile`

### Step 2: OAuth Callback (After User Authorizes)

**Route**: `GET /auth/google/callback`

**Query Parameters**:

- `code`: Authorization code from Google
- `state`: The state token from Step 1

**Implementation**:

```typescript
import { googleOAuthService } from "../services/auth/GoogleOAuthService";

const code = req.query.code as string;
const stateToken = req.query.state as string;

// Validate inputs
if (!code || !stateToken) {
	return res.status(400).send("Missing authorization code or state");
}

try {
	// Handle OAuth callback - this does everything
	const result = await googleOAuthService.handleOAuthCallback(code, stateToken);

	// result contains:
	// - result.user: UserRecord
	// - result.profile: { email, name, picture }
	// - result.tokens: UserGoogleToken
	// - result.state: OAuthStatePayload

	// Show success page or redirect
	res.send(renderSuccessPage(result.profile.email));
} catch (error) {
	// Handle errors
	res.status(500).send(renderErrorPage("Connection failed"));
}
```

**What `handleOAuthCallback` Does** (in order):

1. **Verify State Token**:

   - Splits token into encoded payload and signature
   - Verifies HMAC signature using `JWT_SECRET`
   - Checks expiry (30 minutes)
   - Extracts `userId` from payload

2. **Get User from Database**:

```typescript
const user = await this.userService.findById(state.userId);
if (!user) {
	throw new Error("User not found for OAuth callback");
}
```

3. **Exchange Code for Tokens**:

```typescript
const oauthClient = new google.auth.OAuth2(
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET,
	GOOGLE_REDIRECT_URI
);
const { tokens } = await oauthClient.getToken(code);
// tokens contains: access_token, refresh_token, expiry_date, token_type, scope
```

4. **Get User Profile**:

```typescript
oauthClient.setCredentials(tokens);
const oauth2 = google.oauth2({ version: "v2", auth: oauthClient });
const profileResponse = await oauth2.userinfo.get();
// profileResponse.data contains: email, name, picture
```

5. **Normalize Scopes**:

```typescript
const normalizedScopes = tokens.scope
	? this.normalizeScopes(tokens.scope) // Convert string/array to array
	: this.getScopesForPlan(user.plan_type); // Fallback to plan-based scopes
```

6. **Store Tokens in Database**:

```typescript
const existingTokens = await this.userService.getGoogleTokens(user.id);

const upsertedTokens = await this.userService.upsertGoogleTokens(user.id, {
	accessToken: tokens.access_token ?? existingTokens?.access_token ?? null,
	refreshToken: tokens.refresh_token ?? existingTokens?.refresh_token ?? null,
	expiresAt: tokens.expiry_date ?? null, // Unix timestamp in milliseconds
	scope: normalizedScopes, // Array of scope strings
	tokenType: tokens.token_type ?? existingTokens?.token_type ?? null,
});
```

**What `upsertGoogleTokens` Does**:

- Uses PostgreSQL `ON CONFLICT` to update if exists, insert if not
- Stores in `user_google_tokens` table
- `provider` defaults to `'google'`
- `UNIQUE` constraint on `(user_id, provider)` ensures one token record per user
- Returns the stored `UserGoogleToken` record

7. **Update User Email**:

```typescript
const userEmail = profileResponse.data?.email || null;
await this.userService.updateGoogleEmail(user.id, userEmail);
// Updates users.google_email field
```

8. **Mark Onboarding Complete**:

```typescript
await this.userService.setOnboardingComplete(user.id, true);
// Sets users.onboarding_complete = true
```

### Step 3: Token Storage Schema

**Table**: `user_google_tokens`

**Actual Schema (from Supabase)**:

```sql
CREATE TABLE public.user_google_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  access_token TEXT NULL,
  refresh_token TEXT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NULL,
  scope TEXT[] NULL,
  token_type TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT user_google_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT user_google_tokens_user_id_provider_key UNIQUE (user_id, provider),
  CONSTRAINT user_google_tokens_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns**:

- `id`: UUID (primary key, auto-generated)
- `user_id`: UUID (NOT NULL, foreign key to `users.id`, ON DELETE CASCADE)
- `provider`: TEXT (NOT NULL, typically `'google'`)
- `access_token`: TEXT (nullable) - **CRITICAL**: Needed for API calls
- `refresh_token`: TEXT (nullable) - **CRITICAL**: Permanent token for refresh
- `expires_at`: TIMESTAMP WITH TIME ZONE (nullable) - When access_token expires
- `scope`: TEXT[] (array of scope strings, nullable)
- `token_type`: TEXT (nullable, usually `'Bearer'`)
- `created_at`: TIMESTAMP WITH TIME ZONE (NOT NULL, default now())
- `updated_at`: TIMESTAMP WITH TIME ZONE (NOT NULL, default now())

**Constraints**:

- Primary key on `id`
- Unique constraint on `(user_id, provider)` - One token record per user per provider
- Foreign key constraint: `user_id` references `users(id)` with CASCADE delete
- Trigger: `set_user_google_tokens_updated_at` - Auto-updates `updated_at` on UPDATE

**Important Notes**:

- `refresh_token` is **permanent** (doesn't expire) - store it securely
- `access_token` expires (usually 1 hour) - must be refreshed
- Always use `upsertGoogleTokens` - handles both insert and update
- If user reconnects, existing tokens are updated (not duplicated)

---

## Part 3: Token Validation & Usage (How System Validates on Future Messages)

### How Tokens Are Retrieved and Validated

**Location**: `src/services/onboarding/UserOnboardingHandler.ts` (method: `handleUserMessage`)

**Flow When User Sends WhatsApp Message**:

1. **Get User**:

```typescript
const user = await userService.findOrCreateByWhatsappNumber(userPhone);
```

2. **Get Stored Tokens**:

```typescript
let tokens = await userService.getGoogleTokens(user.id);
// Returns UserGoogleToken | null
```

3. **Ensure Tokens Are Fresh** (using `GoogleTokenManager`):

```typescript
import { GoogleTokenManager } from "../auth/GoogleTokenManager";

const googleTokenManager = new GoogleTokenManager();
const tokenResult = await googleTokenManager.ensureFreshTokens(user, tokens, {
	forceRefresh: true,
});

// tokenResult contains:
// - tokens: UserGoogleToken | null (updated if refreshed)
// - googleConnected: boolean
// - needsReauth: boolean (true if refresh failed)
```

**What `ensureFreshTokens` Does**:

1. **Check if tokens exist**:

```typescript
if (!tokens) {
	return { tokens: null, googleConnected: false, needsReauth: false };
}
```

2. **Check if refresh_token exists**:

```typescript
if (!tokens.refresh_token) {
	await this.clearTokens(user.id); // Delete invalid tokens
	return { tokens: null, googleConnected: false, needsReauth: true };
}
```

3. **Check if token needs refresh**:

```typescript
const expiresAt = tokens.expires_at
	? new Date(tokens.expires_at).getTime()
	: null;
const shouldRefresh =
	options.forceRefresh ||
	!expiresAt ||
	expiresAt <= Date.now() + TOKEN_REFRESH_BUFFER_MS; // 5 minutes buffer
```

4. **Refresh if needed**:

```typescript
const oauthClient = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);
oauthClient.setCredentials({
  refresh_token: tokens.refresh_token,
  access_token: tokens.access_token
});

const { credentials } = await oauthClient.refreshAccessToken();
// credentials contains new access_token and expiry_date

// Update database with new tokens
const updatedTokens = await this.userService.upsertGoogleTokens(user.id, {
  accessToken: credentials.access_token ?? tokens.access_token ?? null,
  refreshToken: credentials.refresh_token ?? tokens.refresh_token ?? null,
  expiresAt: credentials.expiry_date ?? null,
  scope: credentials.scope ? ... : tokens.scope ?? null,
  tokenType: credentials.token_type ?? tokens.token_type ?? null
});
```

5. **Handle Refresh Errors**:

```typescript
catch (error) {
  if (this.isInvalidGrantError(error)) {
    // Refresh token is invalid (user revoked access)
    await this.clearTokens(user.id);
    return { tokens: null, googleConnected: false, needsReauth: true };
  }
  throw error;
}
```

4. **Build Request Context**:

```typescript
const requestContext: RequestUserContext = {
	user: userRecord,
	planType: userRecord.plan_type,
	whatsappNumber: userRecord.whatsapp_number,
	capabilities: {
		database: true, // Always available
		calendar: tokenResult.googleConnected && hasCalendarScope,
		gmail: tokenResult.googleConnected && hasGmailScope,
	},
	googleTokens: tokenResult.tokens,
	googleConnected: tokenResult.googleConnected,
};
```

5. **Use Context in Agents**:

```typescript
// In CalendarService or GmailService
const context = RequestContext.get();
if (!context?.googleConnected || !context.googleTokens) {
  throw new Error('Google account is not connected');
}

// Build OAuth client with tokens
const oauthClient = new google.auth.OAuth2(...);
oauthClient.setCredentials({
  access_token: context.googleTokens.access_token,
  refresh_token: context.googleTokens.refresh_token,
  expiry_date: context.googleTokens.expires_at
    ? new Date(context.googleTokens.expires_at).getTime()
    : undefined
});
```

---

## Part 4: Complete Implementation Example

### Route Handler for OAuth Initiation

```typescript
// src/routes/connect.ts
import express, { Request, Response } from "express";
import { googleOAuthService } from "../services/auth/GoogleOAuthService";
import { UserService } from "../services/database/UserService";
import { logger } from "../utils/logger";

export const connectRouter = express.Router();
const userService = new UserService();

connectRouter.get("/connect", async (req: Request, res: Response) => {
	try {
		// Step 1: Get WhatsApp number (from query param, session, or token)
		const whatsappNumber = req.query.phone as string;

		if (!whatsappNumber) {
			return res.status(400).json({ error: "WhatsApp number is required" });
		}

		// Step 2: Get or create user (CRITICAL: Use this method)
		const user = await userService.findOrCreateByWhatsappNumber(whatsappNumber);

		// Step 3: Generate state token
		const stateToken = googleOAuthService.createStateToken({
			userId: user.id,
			planType: user.plan_type,
			redirectPath: "/connect/success", // Optional
		});

		// Step 4: Get authorization URL
		const authUrl = await googleOAuthService.getAuthorizationUrl(stateToken);

		// Step 5: Redirect to Google
		res.redirect(authUrl);
	} catch (error) {
		logger.error("Error initiating Google connection:", error);
		res.status(500).json({ error: "Failed to start connection process" });
	}
});
```

### Existing Callback Handler (Already Implemented)

The callback is already implemented in `src/routes/auth.ts`:

```typescript
authRouter.get("/google/callback", async (req: Request, res: Response) => {
	try {
		const code = req.query.code;
		const stateToken = req.query.state;

		if (
			!code ||
			typeof code !== "string" ||
			!stateToken ||
			typeof stateToken !== "string"
		) {
			return res
				.status(400)
				.send("Missing authorization code or state parameter");
		}

		// This method handles everything:
		// - Verifies state token
		// - Exchanges code for tokens
		// - Gets user profile
		// - Stores tokens in database
		// - Updates user email
		// - Marks onboarding complete
		const result = await googleOAuthService.handleOAuthCallback(
			code,
			stateToken
		);

		// Optional: Redirect to success page
		const redirectUrl = result.state.redirectPath
			? `${process.env.APP_PUBLIC_URL || ""}${result.state.redirectPath}`
			: null;

		if (redirectUrl) {
			return res.redirect(302, redirectUrl);
		}

		// Or show success page
		res.status(200).send(renderSuccessPage(result.profile.email));
	} catch (error) {
		logger.error("Error completing Google OAuth callback:", error);
		res.status(500).send(renderErrorPage("Connection failed"));
	}
});
```

---

## Part 5: Key Points & Best Practices

### User Creation

- ✅ **ALWAYS** use `UserService.findOrCreateByWhatsappNumber(phoneNumber)`
- ✅ **NEVER** use direct INSERT statements
- ✅ The database function ensures idempotency
- ✅ User is created with default values automatically

### OAuth Flow

- ✅ **ALWAYS** generate state token with `userId` from database
- ✅ **ALWAYS** verify state token on callback (already done in service)
- ✅ **ALWAYS** use `upsertGoogleTokens` to store tokens (handles insert/update)
- ✅ **ALWAYS** store `refresh_token` - it's permanent and needed for refresh

### Token Management

- ✅ Access tokens expire (~1 hour) - must refresh before expiry
- ✅ Refresh tokens are permanent - store securely
- ✅ Use `GoogleTokenManager.ensureFreshTokens()` before API calls
- ✅ Handle `needsReauth: true` - user must reconnect if refresh fails

### Security

- ✅ State tokens are signed with HMAC-SHA256
- ✅ State tokens expire after 30 minutes
- ✅ Never expose `refresh_token` in logs or responses
- ✅ Use HTTPS in production (required by Google OAuth)

### Error Handling

- ✅ Check if user exists before OAuth
- ✅ Validate state token signature and expiry
- ✅ Handle token refresh failures gracefully
- ✅ Clear invalid tokens from database

---

## Summary

**User Creation Pattern**:

```typescript
const user = await userService.findOrCreateByWhatsappNumber(whatsappNumber);
```

**OAuth Initiation Pattern**:

```typescript
const stateToken = googleOAuthService.createStateToken({
	userId: user.id,
	planType: user.plan_type,
});
const authUrl = await googleOAuthService.getAuthorizationUrl(stateToken);
res.redirect(authUrl);
```

**OAuth Callback Pattern** (already implemented):

```typescript
const result = await googleOAuthService.handleOAuthCallback(code, stateToken);
// Tokens are automatically stored in database
```

**Token Validation Pattern** (already implemented):

```typescript
const tokenResult = await googleTokenManager.ensureFreshTokens(user, tokens);
// Use tokenResult.tokens and tokenResult.googleConnected
```

The system automatically handles token refresh, validation, and error handling. You just need to ensure users are created correctly and the OAuth flow is initiated properly.

---

## Related Files

- `src/services/database/UserService.ts` - User database operations
- `src/services/auth/GoogleOAuthService.ts` - OAuth flow logic
- `src/services/auth/GoogleTokenManager.ts` - Token refresh logic
- `src/routes/auth.ts` - OAuth callback route (already implemented)
- `src/services/onboarding/UserOnboardingHandler.ts` - Token validation on message processing
- `scripts/COMPLETE-DATABASE-SETUP.sql` - Database schema and functions

---

## Important Notes About Schema

### No `auth_id` Column

**The `users` table does NOT have an `auth_id` column.** If you see code referencing `auth_id`, it is incorrect and should be removed or updated.

### Google User Identification

- Google user IDs are **NOT stored** in the `users` table
- Only `google_email` is stored in the `users` table
- The `user_id` in `user_google_tokens` references `users.id` (UUID), not a Google ID
- Google profile information (email, name, picture) is retrieved from Google API when needed but only email is persisted

### Foreign Key Relationship

- `user_google_tokens.user_id` → `users.id` (ON DELETE CASCADE)
- When a user is deleted, their tokens are automatically deleted
- The relationship is one-to-many (one user can have multiple token records if different providers are used, but typically one for 'google')
