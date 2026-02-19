# Authentication Flow Documentation

## Overview

This document explains the Google OAuth authentication flow used in Memo_v2, and the **state-first AuthContext** pattern that eliminates redundant database fetches.

## Flow Diagram

```
User → WhatsApp → Memo_v2 → Google OAuth → Callback → Token Storage → Capability Update
```

## Components

### 1. OAuth Initiation (`/auth/google`)

- User requests Google connection via WhatsApp
- System generates a state token with user ID and metadata
- Redirects user to Google OAuth consent screen
- State token is included in the redirect URL

### 2. OAuth Callback (`/auth/google/callback`)

- Google redirects back with authorization code
- System exchanges code for access/refresh tokens
- Tokens are stored in `user_google_tokens` table
- User capabilities are updated based on plan type and scopes

### 3. Token Storage

- Access token: Short-lived, used for API calls
- Refresh token: Long-lived, used to refresh access tokens
- Expiry date: Tracks when access token expires
- Scopes: Tracks which Google services are authorized

### 4. Capability Integration

- Calendar: Available for `standard` and `pro` plans
- Gmail: Available for `pro` plan only
- Capabilities are checked before executing operations

## State Token Structure

```typescript
{
  userId: string;
  planType?: string;
  redirectPath?: string;
  issuedAt: number;
  nonce?: string;
}
```

## Token Refresh

- Tokens are proactively refreshed at graph start by `ContextAssemblyNode` via `GoogleTokenManager.ensureFreshTokens()`
- The V1 services also have a fallback token refresh on the `tokens` event of the OAuth client
- Updated tokens are persisted to database

## Security

- State tokens are signed and verified
- Tokens are encrypted in transit (HTTPS)
- Refresh tokens are stored securely in database
- OAuth client credentials are environment variables

---

## State-First AuthContext Pattern

### Problem (before)

User auth data (user record, Google tokens, capabilities) was fetched from the database **multiple times per request**:

1. `ContextAssemblyNode` fetched user record + Google tokens (2 DB calls) but only stored boolean flags in `state.user`.
2. `CalendarServiceAdapter.buildRequestContext()` re-fetched user record + Google tokens (2 more DB calls).
3. `GmailServiceAdapter.buildRequestContext()` re-fetched user record + Google tokens (2 more DB calls).

**Total: Up to 6 DB calls for the same user data per request.**

### Solution: `AuthContext` on MemoState

A new `authContext` field on `MemoState` holds the **full hydrated user data** fetched once at graph start:

```typescript
interface AuthContext {
  userRecord: UserRecord;       // Full DB user record
  planTier: UserPlanType;       // 'free' | 'standard' | 'pro'
  googleTokens: UserGoogleToken | null;  // OAuth tokens (refreshed)
  googleConnected: boolean;     // Whether Google is connected
  capabilities: {               // Pre-computed from scopes + plan
    calendar: boolean;
    gmail: boolean;
    database: boolean;
    secondBrain: boolean;
  };
  hydratedAt: number;           // Timestamp for staleness checks
}
```

### Data Flow

1. **ContextAssemblyNode** (first node):
   - Fetches user record via `UserService.findByWhatsappNumber()` (1 DB call)
   - Fetches Google tokens via `UserService.getGoogleTokens()` (1 DB call)
   - Refreshes tokens via `GoogleTokenManager.ensureFreshTokens()` (if needed)
   - Stores everything in `state.authContext`
   - Derives lightweight `state.user` (UserContext) for prompts/planner (includes optional `userName` from `users.settings.user_name`; used by ResponseWriterNode and morning digest)

2. **ExecutorNode** reads `state.authContext` and passes it to adapters

3. **CalendarServiceAdapter / GmailServiceAdapter**:
   - Accept `AuthContext` in constructor
   - Build `RequestUserContext` from `AuthContext` (zero DB calls)
   - V1 services receive the same `RequestUserContext` they expect

**Total: 2 DB calls per request (down from 6).**

## Integration Points

1. **Webhook**: Invokes graph with user phone number
2. **ContextAssemblyNode**: Hydrates full `AuthContext` into MemoState (user record, tokens, capabilities)
3. **CapabilityCheckNode**: Validates user has required capabilities (reads `state.user.capabilities`)
4. **ExecutorNode**: Passes `state.authContext` to service adapters
5. **CalendarServiceAdapter / GmailServiceAdapter**: Build V1-compatible `RequestUserContext` from `AuthContext` (no DB calls)
6. **CalendarService / GmailService**: Receive `RequestUserContext` with valid tokens
