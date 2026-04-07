import { describe, expect, it } from 'vitest';
import { isGuestAuth } from '../../src/utils/guestUser.js';
import type { AuthContext } from '../../src/types/index.js';

function authWithId(id: string): AuthContext {
  const now = new Date().toISOString();
  return {
    userRecord: {
      id,
      whatsapp_number: '+1',
      plan_type: 'free',
      timezone: 'Asia/Jerusalem',
      settings: {},
      google_email: null,
      onboarding_complete: true,
      onboarding_last_prompt_at: null,
      morning_brief_time: '08:00:00',
      created_at: now,
      updated_at: now,
      subscription_status: null,
      subscription_period_end: null,
      cancel_at_period_end: false,
    },
    planTier: 'free',
    googleTokens: null,
    googleConnected: false,
    capabilities: { calendar: false, gmail: false, database: true, secondBrain: true },
    hydratedAt: Date.now(),
  };
}

describe('isGuestAuth', () => {
  it('returns true when auth is undefined', () => {
    expect(isGuestAuth(undefined)).toBe(true);
  });

  it('returns true when user id is empty', () => {
    const a = authWithId('');
    expect(isGuestAuth(a)).toBe(true);
  });

  it('returns true when user id is whitespace only', () => {
    const a = authWithId('   ');
    expect(isGuestAuth(a)).toBe(true);
  });

  it('returns false when user has a real id', () => {
    expect(isGuestAuth(authWithId('uuid-here'))).toBe(false);
  });
});
