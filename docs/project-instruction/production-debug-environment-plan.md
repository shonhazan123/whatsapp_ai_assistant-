# Production/Debug Environment Split - Implementation Plan

## Goal

Create a dual-environment system where:

- **PRODUCTION** (cloud): Stable version, always online, receives all WhatsApp messages
- **DEBUG** (local): Development/testing version, only receives forwarded requests from PRODUCTION

## Key Requirements

- **Minimal code changes** - Add new code, don't modify existing logic
- **Environment-based routing** - Behavior controlled by `.env` variables
- **DEBUG isolation** - DEBUG never receives WhatsApp messages directly
- **Seamless forwarding** - PRODUCTION forwards specific messages to DEBUG transparently

---

## Environment Configuration

### .env File Variables

**PRODUCTION instance:**

```env
ENVIRONMENT=PRODUCTION
DEBUG_INSTANCE_URL=https://your-ngrok-url.ngrok.io
```

**DEBUG instance:**

```env
ENVIRONMENT=DEBUG
DEBUG_INSTANCE_URL=https://your-ngrok-url.ngrok.io  # Optional, for reference
```

---

## Architecture Overview

### PRODUCTION Environment

- ✅ Receives **ALL** WhatsApp messages via webhook
- ✅ Checks sender phone number
- ✅ If sender is `+972543911602` → Forwards to DEBUG, returns response
- ✅ If sender is other → Processes normally in PRODUCTION
- ✅ Registers WhatsApp webhook on startup

### DEBUG Environment

- ❌ **Does NOT** receive WhatsApp messages directly
- ✅ Exposes `/api/debug/process` endpoint for PRODUCTION
- ✅ Processes forwarded requests using existing logic
- ✅ Returns response to PRODUCTION
- ❌ Does NOT register WhatsApp webhook

---

## Implementation Plan

### Phase 1: Environment Detection & Configuration

**File: `src/config/environment.ts` (NEW)**

- Read `ENVIRONMENT` from `.env`
- Read `DEBUG_INSTANCE_URL` from `.env`
- Export constants: `ENVIRONMENT`, `DEBUG_INSTANCE_URL`
- Type: `ENVIRONMENT = 'PRODUCTION' | 'DEBUG'`

**Changes:** New file only, no existing code modified

---

### Phase 2: HTTP Forwarding Service (PRODUCTION only)

**File: `src/services/debug/DebugForwarderService.ts` (NEW)**

- Service class for forwarding requests to DEBUG instance
- Constructor: Only initializes if `ENVIRONMENT === 'PRODUCTION'`
- Method: `forwardToDebug(requestData)` - HTTP POST to `DEBUG_INSTANCE_URL/api/debug/process`
- Handles request/response transformation
- Error handling if DEBUG is unreachable

**Changes:** New file only, no existing code modified

---

### Phase 3: Debug Endpoint (DEBUG only)

**File: `src/routes/debug.ts` (NEW)**

- New route: `POST /api/debug/process`
- Receives request from PRODUCTION
- Extracts message data (text, userPhone, messageId, etc.)
- Calls existing `handleIncomingMessage` function (reuse existing logic)
- Returns response in standardized format

**Changes:** New file only, reuses existing `handleIncomingMessage` function

---

### Phase 4: Conditional Webhook Registration

**File: `src/routes/webhook.ts`**

- **Minimal change:** Add environment check at top of file
- If `ENVIRONMENT === 'DEBUG'`: Skip webhook registration (return early or don't register)
- If `ENVIRONMENT === 'PRODUCTION'`: Register webhook normally (existing code)

**Changes:**

- Import environment config
- Add conditional check before webhook registration
- No logic changes to existing webhook handler

---

### Phase 5: Conditional Forwarding in Webhook Handler

**File: `src/routes/webhook.ts` - `handleIncomingMessage` function**

- **Minimal change:** Add forwarding check at start of function
- If `ENVIRONMENT === 'PRODUCTION'` AND sender is `+972543911602`:
  - Call `DebugForwarderService.forwardToDebug()`
  - Wait for response
  - Send response to WhatsApp
  - Return early (skip normal processing)
- Otherwise: Continue with existing logic (no changes)

**Changes:**

- Import `DebugForwarderService` and environment config
- Add conditional check at function start
- Early return if forwarded
- All existing logic remains untouched

---

### Phase 6: Filter Reminders & Digests in DEBUG Environment

**Problem:** When both DEBUG and PRODUCTION are running, reminders and morning digests are sent twice to all users. We need DEBUG to only send to `+972543911602`.

**File: `src/services/reminder/ReminderService.ts`**

**Changes in `sendUpcomingReminders()` method:**

- **Minimal change:** Add environment check before sending reminders
- Before sending each reminder group:
  - If `ENVIRONMENT === 'DEBUG'` AND `userPhone !== '+972543911602'`: Skip (continue to next group)
  - If `ENVIRONMENT === 'PRODUCTION'`: Send normally (no change)
  - If `ENVIRONMENT === 'DEBUG'` AND `userPhone === '+972543911602'`: Send normally

**Changes in `sendMorningDigestForUser()` method:**

- **Minimal change:** Add environment check at start of function
- If `ENVIRONMENT === 'DEBUG'` AND `userPhone !== '+972543911602'`: Return early (don't send)
- Otherwise: Continue with existing logic (no changes)

**Pattern:**

```typescript
// At start of send functions or before sending to each user:
if (ENVIRONMENT === "DEBUG" && userPhone !== "+972543911602") {
	return; // or continue to next iteration
}
// Continue with existing send logic
```

**Changes:**

- Import environment config
- Add conditional check before sending
- Early return/continue if DEBUG and user is not target
- **No existing sending logic modified**

**Result:**

- PRODUCTION: Sends reminders/digests to all users (unchanged)
- DEBUG: Only sends reminders/digests to `+972543911602`
- Other users: Receive only from PRODUCTION (no duplicates)

---

## Request/Response Format

### Request Format (PRODUCTION → DEBUG)

```typescript
{
  messageText: string;
  userPhone: string;
  messageId: string;
  messageType: 'text' | 'audio' | 'image';
  replyToMessageId?: string;
  // ... other WhatsApp message fields
}
```

### Response Format (DEBUG → PRODUCTION)

```typescript
{
  success: boolean;
  responseText: string;
  error?: string;
}
```

---

## Code Change Summary

### New Files (No Impact on Existing Code)

1. `src/config/environment.ts` - Environment detection
2. `src/services/debug/DebugForwarderService.ts` - HTTP forwarding service
3. `src/routes/debug.ts` - Debug endpoint

### Modified Files (Minimal Changes)

1. `src/routes/webhook.ts`

   - Add environment import
   - Add conditional webhook registration check
   - Add forwarding check at start of `handleIncomingMessage`
   - Early return if forwarded
   - **No existing logic modified**

2. `src/services/reminder/ReminderService.ts`
   - Add environment import
   - Add conditional check in `sendUpcomingReminders()` before sending to each user
   - Add conditional check in `sendMorningDigestForUser()` at function start
   - Early return/continue if DEBUG and user is not `+972543911602`
   - **No existing sending logic modified**

---

## Execution Flow

### PRODUCTION Flow

```
1. App starts → Read ENVIRONMENT from .env → ENVIRONMENT = 'PRODUCTION'
2. Initialize DebugForwarderService (ENVIRONMENT === 'PRODUCTION')
3. Register WhatsApp webhook (ENVIRONMENT === 'PRODUCTION')
4. WhatsApp message arrives → handleIncomingMessage()
5. Check: ENVIRONMENT === 'PRODUCTION' AND sender === '+972543911602'?
   ├─ YES → Forward to DEBUG → Wait response → Send to WhatsApp → Return
   └─ NO → Continue existing logic (no changes)
```

### DEBUG Flow

```
1. App starts → Read ENVIRONMENT from .env → ENVIRONMENT = 'DEBUG'
2. Skip DebugForwarderService initialization (ENVIRONMENT === 'DEBUG')
3. Skip WhatsApp webhook registration (ENVIRONMENT === 'DEBUG')
4. Expose /api/debug/process endpoint
5. PRODUCTION forwards request → /api/debug/process
6. Extract request data → Call existing handleIncomingMessage() → Return response
```

---

## Testing Checklist

### PRODUCTION Environment

- [ ] Receives WhatsApp messages normally
- [ ] Forwards messages from +972543911602 to DEBUG
- [ ] Processes other messages normally
- [ ] Handles DEBUG unreachable gracefully

### DEBUG Environment

- [ ] Does NOT receive WhatsApp messages directly
- [ ] Receives forwarded requests from PRODUCTION
- [ ] Processes requests using existing logic
- [ ] Returns responses correctly
- [ ] Only sends reminders to `+972543911602` (other users skipped)
- [ ] Only sends morning digests to `+972543911602` (other users skipped)

---

## Error Handling

### DEBUG Unreachable

- PRODUCTION should log error
- Return error message to user: "Debug service unavailable"
- Optionally: Fall back to PRODUCTION processing (future enhancement)

### Invalid Environment

- Validate ENVIRONMENT on startup
- Throw error if not 'PRODUCTION' or 'DEBUG'
- Prevent app from starting with invalid config

---

## Notes

- All existing business logic remains untouched
- Only adds conditional routing based on environment
- DEBUG endpoint reuses existing `handleIncomingMessage` function
- Minimal code changes, maximum isolation
- Reminders/digests filtering ensures no duplicate messages for users (except `+972543911602` who receives from both)
