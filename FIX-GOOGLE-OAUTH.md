# 🔧 Fix Google OAuth Error: invalid_grant

## Problem

```
Error: invalid_grant
Description: Bad Request
```

This means your Google refresh token is expired or invalid.

## Solution: Get a New Refresh Token

### Step 1: Run OAuth Setup Script

```bash
npx ts-node scripts/oauth-setup.ts
```

This will:
1. Start a local server on port 3000
2. Open your browser automatically
3. Ask you to authorize Google Calendar and Gmail access
4. Give you a new refresh token

### Step 2: Copy the Refresh Token

After authorizing, you'll see in the terminal:

```
=== Add this to your .env file ===
GOOGLE_REFRESH_TOKEN=1//0abcdef...
===================================
```

### Step 3: Update Your .env File

Replace the old token in `.env`:

```env
GOOGLE_REFRESH_TOKEN=1//0abcdef...  # Your NEW token here
```

### Step 4: Restart Your App

```bash
# Stop current app (Ctrl+C)
npm run dev
```

### Step 5: Test Again

Send your calendar request from WhatsApp:
```
תקבע לי מחר בשבע בבוקר גלישה עם נבו
```

Should work now! ✅

---

## Why This Happens

Google refresh tokens can expire if:
- ❌ Not used for 6 months
- ❌ User changed Google password
- ❌ User revoked access
- ❌ Token was generated in test mode

## Quick Fix Command

```bash
# One command to fix everything
npx ts-node scripts/oauth-setup.ts
```

Then copy the new token to `.env` and restart!

---

## Alternative: Check Current Token

To see if your token is the issue:

```bash
# Check what's in your .env
Get-Content .env | Select-String "GOOGLE_REFRESH_TOKEN"
```

Make sure it starts with `1//` and is a long string.

---

## Still Not Working?

### Check Google Cloud Console

1. Go to: https://console.cloud.google.com/
2. Select your project
3. Go to **APIs & Services** → **Credentials**
4. Make sure your OAuth 2.0 Client ID is active
5. Check that redirect URI includes: `http://localhost:3000/oauth/callback`

### Enable Required APIs

Make sure these are enabled:
- ✅ Google Calendar API
- ✅ Gmail API

Enable them here: https://console.cloud.google.com/apis/library

---

## Summary

**Quick Fix:**
1. Run: `npx ts-node scripts/oauth-setup.ts`
2. Authorize in browser
3. Copy new refresh token to `.env`
4. Restart app
5. Test! 🎉

