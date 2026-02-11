# Authentication Flow Documentation

## Overview

This document explains the Google OAuth authentication flow used in Memo_v2.

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

- Tokens are automatically refreshed when expired
- Refresh happens transparently during API calls
- Updated tokens are persisted to database

## Security

- State tokens are signed and verified
- Tokens are encrypted in transit (HTTPS)
- Refresh tokens are stored securely in database
- OAuth client credentials are environment variables

## Integration Points

1. **Webhook**: Checks user capabilities before processing requests
2. **ContextAssemblyNode**: Loads user capabilities into MemoState
3. **CalendarService/GmailService**: Require valid tokens for operations
4. **CapabilityCheckNode**: Validates user has required capabilities

