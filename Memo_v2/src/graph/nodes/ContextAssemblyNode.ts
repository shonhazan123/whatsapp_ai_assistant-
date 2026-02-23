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
import type { AuthContext, TimeContext, TriggerInput, UserContext } from '../../types/index.js';
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
    const language = this.detectLanguage(this.input.message);
    const user = this.deriveUserContext(authContext, language);

    // 3. CRITICAL: Add current user message to memory FIRST (before reading)
    // This matches V1 behavior where user message is added before processing
    this.addUserMessageToMemory(this.input);

    // 4. Get recent messages (now includes the current user message)
    const recentMessages = this.getRecentMessages(this.input.userPhone);

    // 5. Get long-term memory summary (optional)
    const longTermSummary = await this.getLongTermMemorySummary(this.input.userPhone);

    // 6. Build time context
    const now = this.buildTimeContext();

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

  private buildTimeContext(): TimeContext {
    const now = new Date();

    // Format like V1: "[Current time: Day, DD/MM/YYYY HH:mm, Timezone: Asia/Jerusalem]"
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Jerusalem',
    };

    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now);

    const day = parts.find(p => p.type === 'weekday')?.value || '';
    const date = `${parts.find(p => p.type === 'day')?.value}/${parts.find(p => p.type === 'month')?.value}/${parts.find(p => p.type === 'year')?.value}`;
    const time = `${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}`;

    const isoString = now.toISOString();

    return {
      formatted: `[Current time: ${day}, ${date} ${time}, Timezone: Asia/Jerusalem]`,
      iso: isoString,
      timezone: 'Asia/Jerusalem',
      dayOfWeek: now.getDay(),
      date: now,
    };
  }

  private detectLanguage(message: string): 'he' | 'en' | 'other' {
    // Hebrew character range
    const hebrewRegex = /[\u0590-\u05FF]/;

    if (hebrewRegex.test(message)) {
      return 'he';
    }

    // Check if mostly ASCII (English)
    const asciiChars = message.match(/[a-zA-Z]/g)?.length || 0;
    if (asciiChars > message.length * 0.5) {
      return 'en';
    }

    return 'other';
  }
}

/**
 * Factory function for LangGraph node registration
 */
export function createContextAssemblyNode(input: TriggerInput) {
  const node = new ContextAssemblyNode(input);
  return node.asNodeFunction();
}
