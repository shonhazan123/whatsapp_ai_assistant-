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

import { getConversationWindow, getUserService } from '../../services/v1-services.js';
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
    
    // 2. Get recent messages
    const recentMessages = await this.getRecentMessages(this.input.userPhone);
    
    // 3. Get long-term memory summary (optional)
    const longTermSummary = await this.getLongTermMemorySummary(this.input.userPhone);
    
    // 4. Build time context
    const now = this.buildTimeContext(user.timezone);
    
    // 5. Detect language
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
      
      // Check Google OAuth connection
      const googleConnected = !!(user.google_access_token && user.google_refresh_token);
      
      return {
        phone: user.phone,
        timezone: user.timezone || 'Asia/Jerusalem',
        language: user.language || 'he',
        planTier: user.plan_tier || 'free',
        googleConnected,
        capabilities: {
          calendar: googleConnected,
          gmail: googleConnected,
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
  
  private async getRecentMessages(phone: string): Promise<MemoState['recentMessages']> {
    try {
      const conversationWindow = getConversationWindow();
      if (!conversationWindow) {
        return [];
      }
      
      // V1 ConversationWindow uses getContext() method, not getMessages()
      const messages = conversationWindow.getContext(phone);
      
      // Convert V1 format to MemoState format (last 10 messages)
      // V1 ConversationMessage has timestamp as number (milliseconds), we need ISO string
      return messages.slice(-10).map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
        timestamp: msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString(),
        metadata: msg.metadata,
      }));
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
  
  private buildTimeContext(timezone: string): TimeContext {
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
      timeZone: timezone,
    };
    
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now);
    
    const day = parts.find(p => p.type === 'weekday')?.value || '';
    const date = `${parts.find(p => p.type === 'day')?.value}/${parts.find(p => p.type === 'month')?.value}/${parts.find(p => p.type === 'year')?.value}`;
    const time = `${parts.find(p => p.type === 'hour')?.value}:${parts.find(p => p.type === 'minute')?.value}`;
    
    const isoString = now.toISOString();
    
    return {
      formatted: `[Current time: ${day}, ${date} ${time}, Timezone: ${timezone}]`,
      iso: isoString,
      timezone,
      dayOfWeek: now.getDay(),
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
