import type { AuthContext } from '../types/index.js';

/**
 * Guests have no persisted conversation or action memory (no DB user id).
 * When auth is missing or userRecord.id is empty, skip MemoryService / ConversationContextStore.
 */
export function isGuestAuth(auth: AuthContext | undefined): boolean {
  const id = auth?.userRecord?.id;
  return !id || String(id).trim() === '';
}
