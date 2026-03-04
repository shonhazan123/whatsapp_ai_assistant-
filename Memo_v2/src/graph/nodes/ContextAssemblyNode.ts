/**
 * ContextAssemblyNode - First node in the graph
 * 
 * Builds a clean, minimal state from:
 * - User profile (timezone, language, plan tier)
 * - Short-term memory (recent messages)
 * - Long-term memory (facts, preferences)
 * - Runtime now (timestamp, timezone)
 * 
 * ❌ No reasoning
 * ❌ No LLM
 * ✅ Deterministic
 */

import { randomUUID } from 'crypto';
import { GoogleTokenManager } from '../../legacy/services/auth/GoogleTokenManager.js';
import { getMemoryService } from '../../services/memory/index.js';
import { getUserService } from '../../services/v1-services.js';
import type { AuthContext, LatestAction, TimeContext, TriggerInput, UserContext } from '../../types/index.js';
import { detectUserResponseLanguage } from '../../utils/languageDetection.js';
import { getDatePartsInTimezone } from '../../utils/userTimezone.js';
import type { MemoState } from '../state/MemoState.js';
import { createInitialState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

export class ContextAssemblyNode extends CodeNode {
  readonly name = 'context_assembly';

  private input: TriggerInput;

  constructor(input: TriggerInput) {
    super();
    this.input = input;
  }

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    // 1. Hydrate full AuthContext (user record + Google tokens + capabilities)
    //    This is the SINGLE source of truth for user auth data in the graph.
    const authContext = await this.hydrateAuthContext(this.input.userPhone);

    // 2. Derive lightweight UserContext from AuthContext (for prompts / planner)
    // Central language detection: used for all LLM response language. Empty message (e.g. image-only) defaults to Hebrew.
    const language = detectUserResponseLanguage(this.input.message, { defaultWhenEmpty: 'he' });
    const user = this.deriveUserContext(authContext, language);

    // 3. CRITICAL: Add current user message to memory FIRST (before reading)
    // This matches V1 behavior where user message is added before processing
    this.addUserMessageToMemory(this.input);

    // 4. Get recent messages (now includes the current user message)
    const recentMessages = this.getRecentMessages(this.input.userPhone);

    // 5. Get long-term memory summary (optional)
    const longTermSummary = await this.getLongTermMemorySummary(this.input.userPhone);

    // 6. Get latest actions (last 3, for referential follow-ups)
    const latestActions = this.getLatestActions(this.input.userPhone);

    // 7. Build time context (always in user timezone – never server)
    const now = this.buildTimeContext(user.timezone);

    // threadId = conversation identity (WhatsApp phone / session key)
    const threadId = this.input.userPhone;
    // traceId = per-request chain, stable across resume (immutable once set)
    const traceId = state.traceId || this.input.whatsappMessageId || randomUUID();

    return createInitialState({
      user,
      authContext,
      input: {
        message: this.input.message,
        triggerType: this.input.triggerType,
        whatsappMessageId: this.input.whatsappMessageId,
        replyToMessageId: this.input.replyToMessageId,
        userPhone: this.input.userPhone,
        timezone: user.timezone,
        language,
      },
      now,
      recentMessages,
      longTermSummary,
      latestActions,
      threadId,
      traceId,
    });
  }

  // ========================================================================
  // Auth Context Hydration (single DB fetch for the entire graph)
  // ========================================================================

  /**
   * Hydrate the full AuthContext from DB.
   * Fetches user record + Google tokens ONCE, refreshes tokens if needed,
   * and computes capabilities from scopes + plan tier.
   */
  private async hydrateAuthContext(phone: string): Promise<AuthContext> {
    try {
      const userService = getUserService();
      if (!userService) {
        return this.getDefaultAuthContext(phone);
      }

      const userRecord = await userService.findByWhatsappNumber(phone);
      if (!userRecord) {
        return this.getDefaultAuthContext(phone);
      }

      // Fetch Google tokens (separate table)
      let googleTokens = null;
      let googleConnected = false;
      let hasCalendar = false;
      let hasGmail = false;

      try {
        const rawTokens = await userService.getGoogleTokens(userRecord.id);

        if (rawTokens?.access_token && rawTokens?.refresh_token) {
          // Refresh tokens proactively if they are expired / about to expire
          const tokenManager = new GoogleTokenManager(userService);
          const tokenResult = await tokenManager.ensureFreshTokens(userRecord, rawTokens);

          googleTokens = tokenResult.tokens;
          googleConnected = tokenResult.googleConnected;

          if (googleConnected && googleTokens) {
            // Determine capabilities from granted scopes
            const scopes = googleTokens.scope || [];
            hasCalendar = scopes.some((s: string) => s.includes('calendar'));
            hasGmail = scopes.some((s: string) => s.includes('gmail'));

            // If no scopes stored, fall back to plan-based defaults
            if (scopes.length === 0) {
              hasCalendar = userRecord.plan_type === 'standard' || userRecord.plan_type === 'pro';
              hasGmail = userRecord.plan_type === 'pro';
            }
          }
        }

        console.log(`[ContextAssemblyNode] User ${userRecord.id}: googleConnected=${googleConnected}, calendar=${hasCalendar}, gmail=${hasGmail}`);
      } catch (tokenError) {
        console.warn('[ContextAssemblyNode] Error fetching/refreshing Google tokens:', tokenError);
      }

      return {
        userRecord,
        planTier: userRecord.plan_type || 'free',
        googleTokens,
        googleConnected,
        capabilities: {
          calendar: hasCalendar,
          gmail: hasGmail,
          database: true,
          secondBrain: true,
        },
        hydratedAt: Date.now(),
      };
    } catch (error) {
      console.error('[ContextAssemblyNode] Error hydrating auth context:', error);
      return this.getDefaultAuthContext(phone);
    }
  }

  /**
   * Derive the lightweight UserContext (used by planner, prompts, response nodes)
   * from the full AuthContext.
   */
  private deriveUserContext(auth: AuthContext, language: 'he' | 'en' | 'other'): UserContext {
    const rawName = auth.userRecord.settings?.user_name;
    const userName = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
    return {
      phone: auth.userRecord.whatsapp_number,
      timezone: auth.userRecord.timezone || 'Asia/Jerusalem',
      language,
      planTier: auth.planTier,
      googleConnected: auth.googleConnected,
      userName,
      capabilities: { ...auth.capabilities },
    };
  }

  /**
   * Default AuthContext when user is not found or services are unavailable.
   */
  private getDefaultAuthContext(phone: string): AuthContext {
    return {
      userRecord: {
        id: '',
        whatsapp_number: phone,
        plan_type: 'free',
        timezone: 'Asia/Jerusalem',
        settings: {},
        google_email: null,
        onboarding_complete: false,
        onboarding_last_prompt_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      planTier: 'free',
      googleTokens: null,
      googleConnected: false,
      capabilities: {
        calendar: false,
        gmail: false,
        database: true,
        secondBrain: true,
      },
      hydratedAt: Date.now(),
    };
  }

  /**
   * Add current user message to memory before processing
   * This matches V1 behavior and ensures the message is available for context
   */
  private addUserMessageToMemory(input: TriggerInput): void {
    if (!input.message) {
      return;
    }

    try {
      const memoryService = getMemoryService();

      // Add user message to memory (matches V1 MainAgent behavior)
      memoryService.addUserMessage(
        input.userPhone,
        input.message, // Store original message
        {
          whatsappMessageId: input.whatsappMessageId,
          replyToMessageId: input.replyToMessageId,
        }
      );

      console.log(`[ContextAssemblyNode] Added user message to memory for ${input.userPhone}`);
    } catch (error) {
      console.error('[ContextAssemblyNode] Error adding user message to memory:', error);
      // Don't fail if this fails, but log the error
    }
  }

  /**
   * Get recent messages from memory in MemoState format
   */
  private getRecentMessages(phone: string): MemoState['recentMessages'] {
    try {
      const memoryService = getMemoryService();

      // MemoryService returns messages in MemoState format (ISO timestamps)
      const messages = memoryService.getRecentMessages(phone, 10);

      return messages;
    } catch (error) {
      console.error('[ContextAssemblyNode] Error getting recent messages:', error);
      return [];
    }
  }

  private async getLongTermMemorySummary(phone: string): Promise<string | undefined> {
    // For now, return undefined (can be enhanced later with SecondBrainService)
    // This would query the second_brain_memory table for user summaries
    return undefined;
  }

  private getLatestActions(phone: string): LatestAction[] {
    try {
      const memoryService = getMemoryService();
      const actions = memoryService.getLatestActions(phone, 3);
      if (actions.length > 0) {
        console.log(`[ContextAssemblyNode] latestActions for ${phone}: ${actions.length} (e.g. "${actions[0]?.summary?.substring(0, 40)}...")`);
      } else {
        console.log(`[ContextAssemblyNode] latestActions for ${phone}: 0 (no recent operations to reference)`);
      }
      return actions;
    } catch (error) {
      console.error('[ContextAssemblyNode] Error getting latest actions:', error);
      return [];
    }
  }

  private buildTimeContext(userTimezone: string): TimeContext {
    const now = new Date();
    const tz = userTimezone || 'Asia/Jerusalem';

    const p = getDatePartsInTimezone(tz, now);
    // Use ISO date (YYYY-MM-DD) so LLMs interpret "today" and "tomorrow" correctly (avoids DD/MM vs MM/DD confusion)
    const dateIso = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const day = weekdays[p.dayOfWeek] ?? '';

    return {
      formatted: `[Current time: ${day}, ${dateIso} ${time}, Timezone: ${tz}]`,
      iso: now.toISOString(),
      timezone: tz,
      dayOfWeek: p.dayOfWeek,
      date: now,
    };
  }

}

/**
 * Factory function for LangGraph node registration
 */
export function createContextAssemblyNode(input: TriggerInput) {
  const node = new ContextAssemblyNode(input);
  return node.asNodeFunction();
}
