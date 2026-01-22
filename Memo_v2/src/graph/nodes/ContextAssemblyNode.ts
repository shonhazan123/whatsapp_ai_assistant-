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

import { getMemoryService } from '../../services/memory/index.js';
import { getUserService } from '../../services/v1-services.js';
import type { TimeContext, TriggerInput, UserContext } from '../../types/index.js';
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
    // 1. Get user profile
    const user = await this.getUserProfile(this.input.userPhone);

    // 2. CRITICAL: Add current user message to memory FIRST (before reading)
    // This matches V1 behavior where user message is added before processing
    // This ensures the user message is available for the current request context
    this.addUserMessageToMemory(this.input);

    // 3. Get recent messages (now includes the current user message)
    const recentMessages = this.getRecentMessages(this.input.userPhone);

    // 4. Get long-term memory summary (optional)
    const longTermSummary = await this.getLongTermMemorySummary(this.input.userPhone);

    // 5. Build time context
    const now = this.buildTimeContext();

    // 6. Detect language
    const language = this.detectLanguage(this.input.message);

    return createInitialState({
      user: {
        ...user,
        language,
      },
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
    });
  }

  // ========================================================================
  // Helper methods (integrated with V1 services)
  // ========================================================================

  private async getUserProfile(phone: string): Promise<UserContext> {
    try {
      const userService = getUserService();
      if (!userService) {
        return this.getDefaultUserContext(phone);
      }

      const user = await userService.findByWhatsappNumber(phone);

      if (!user) {
        return this.getDefaultUserContext(phone);
      }

      // CRITICAL: Google tokens are in a SEPARATE table (user_google_tokens)
      // Must fetch them explicitly using getGoogleTokens(userId)
      let googleConnected = false;
      let hasCalendar = false;
      let hasGmail = false;

      try {
        const googleTokens = await userService.getGoogleTokens(user.id);

        if (googleTokens?.access_token && googleTokens?.refresh_token) {
          googleConnected = true;

          // Check token expiry - if expired more than buffer, mark as needs refresh
          // but still consider connected (will be refreshed on actual API call)
          const expiresAt = googleTokens.expires_at ? new Date(googleTokens.expires_at).getTime() : null;
          const isExpired = expiresAt ? expiresAt < Date.now() : false;

          // If expired but has refresh token, still consider connected
          // The actual service will refresh when needed
          if (!isExpired || googleTokens.refresh_token) {
            googleConnected = true;
          }

          // Check scopes to determine specific capabilities
          const scopes = googleTokens.scope || [];
          hasCalendar = scopes.some((s: string) => s.includes('calendar'));
          hasGmail = scopes.some((s: string) => s.includes('gmail'));

          // If no scopes stored, assume full access based on plan
          if (scopes.length === 0 && googleConnected) {
            hasCalendar = user.plan_type === 'standard' || user.plan_type === 'pro';
            hasGmail = user.plan_type === 'pro';
          }
        }

        console.log(`[ContextAssemblyNode] User ${user.id}: googleConnected=${googleConnected}, calendar=${hasCalendar}, gmail=${hasGmail}`);
      } catch (tokenError) {
        console.warn('[ContextAssemblyNode] Error fetching Google tokens:', tokenError);
        // Continue with googleConnected = false
      }

      return {
        phone: user.whatsapp_number,
        timezone: user.timezone || 'Asia/Jerusalem',
        language: 'he', // Will be overridden by detectLanguage()
        planTier: user.plan_type || 'free',
        googleConnected,
        capabilities: {
          calendar: hasCalendar,
          gmail: hasGmail,
          database: true,
          secondBrain: true,
        },
      };
    } catch (error) {
      console.error('[ContextAssemblyNode] Error getting user profile:', error);
      return this.getDefaultUserContext(phone);
    }
  }

  private getDefaultUserContext(phone: string): UserContext {
    return {
      phone,
      timezone: 'Asia/Jerusalem',
      language: 'he',
      planTier: 'free',
      googleConnected: false,
      capabilities: {
        calendar: false,
        gmail: false,
        database: true,
        secondBrain: true
      },
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
