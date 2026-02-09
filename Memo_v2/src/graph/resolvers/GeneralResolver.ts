/**
 * General Resolver
 * 
 * Handles conversational responses without tools.
 * Used for greetings, general questions, or when no specific capability is needed.
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, TemplateResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// GENERAL RESOLVER (LLM-based)
// ============================================================================

/**
 * GeneralResolver - Conversational responses
 * 
 * Actions: respond, greet, clarify, acknowledge
 */
export class GeneralResolver extends LLMResolver {
  readonly name = 'general_resolver';
  readonly capability: Capability = 'general';
  readonly actions = ['respond', 'greet', 'clarify', 'acknowledge', 'unknown'];
  
  getSystemPrompt(): string {
    return `You are Memo, a friendly and helpful personal assistant.

Your job is to generate a natural response to the user's message.

CONTEXT:
- User language preference is provided
- Recent conversation context is available
- You should be warm, concise, and helpful

RESPONSE GUIDELINES:
1. Match the user's language (Hebrew or English)
2. Be friendly but professional
3. Keep responses concise unless detailed explanation is needed
4. If you don't understand, ask for clarification politely

OUTPUT FORMAT (MUST BE VALID JSON):
You MUST respond with ONLY valid JSON, no additional text or explanation.
{
  "response": "Your natural language response here",
  "language": "he" | "en"
}

RULES:
1. Never mention internal systems or capabilities
2. Never expose technical details
3. Always be helpful and encouraging
4. Output only the JSON, no explanation`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'generalResponse',
      parameters: {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'Natural language response' },
          language: { type: 'string', enum: ['he', 'en'] },
        },
        required: ['response'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Use LLM to generate the conversational response
    // This follows the architecture: Resolver uses LLM, Executor just returns the result
    try {
      const llmResult = await this.callLLM(step, state);
      
      // LLM returns { response: string, language: string } via function calling
      const args: Record<string, any> = {
        action: step.action,
        response: llmResult.response,
        language: llmResult.language || state.user.language,
      };
      
      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed, using fallback:`, error);
      // Fallback: return generic response
      const fallbackResponse = state.user.language === 'he' 
        ? 'לא הבנתי. אפשר לנסח אחרת?'
        : "I didn't understand. Could you rephrase?";
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          action: step.action,
          response: fallbackResponse,
          language: state.user.language,
        },
      };
    }
  }
  
  private extractRecentContext(state: MemoState): string {
    // Extract last few messages for context
    const recent = state.recentMessages.slice(-3);
    return recent.map(m => `${m.role}: ${m.content}`).join('\n');
  }
}

// ============================================================================
// META RESOLVER (Template-based, no LLM)
// ============================================================================

/**
 * MetaResolver - Capability descriptions without LLM
 * 
 * Actions: describe_capabilities, help, status
 */
export class MetaResolver extends TemplateResolver {
  readonly name = 'meta_resolver';
  readonly capability: Capability = 'meta';
  readonly actions = ['describe_capabilities', 'help', 'status', 'what_can_you_do'];
  
  getSystemPrompt(): string {
    // Not used - template-based
    return '';
  }
  
  getSchemaSlice(): object {
    // Not used - template-based
    return {};
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action } = step;
    const response = this.generateFromTemplate(step, state);
    
    return {
      stepId: step.id,
      type: 'execute',
      args: {
        response,
        language: state.user.language,
        isTemplate: true,
      },
    };
  }
  
  protected generateFromTemplate(step: PlanStep, state: MemoState): string {
    const { action } = step;
    const isHebrew = state.user.language === 'he';
    const capabilities = state.user.capabilities;
    
    switch (action) {
      case 'describe_capabilities':
      case 'what_can_you_do':
        return this.getCapabilitiesDescription(capabilities, isHebrew);
        
      case 'help':
        return this.getHelpMessage(isHebrew);
        
      case 'status':
        return this.getStatusMessage(state, isHebrew);
        
      default:
        return this.getDefaultResponse(isHebrew);
    }
  }
  
  private getCapabilitiesDescription(
    capabilities: { calendar: boolean; gmail: boolean; database: boolean; secondBrain: boolean },
    isHebrew: boolean
  ): string {
    if (isHebrew) {
      const caps: string[] = ['אני יכול לעזור לך עם:'];
      
      if (capabilities.calendar) {
        caps.push('📅 *לוח שנה* - יצירה, עדכון ומחיקה של אירועים');
      }
      if (capabilities.database) {
        caps.push('✅ *משימות* - ניהול משימות, תזכורות ורשימות');
      }
      if (capabilities.gmail) {
        caps.push('📧 *אימייל* - קריאה, שליחה ותשובה לאימיילים');
      }
      if (capabilities.secondBrain) {
        caps.push('🧠 *זיכרון* - שמירה וחיפוש מידע אישי');
      }
      
      caps.push('💬 *שיחה* - שאל אותי כל דבר!');
      
      return caps.join('\n');
    }
    
    const caps: string[] = ['I can help you with:'];
    
    if (capabilities.calendar) {
      caps.push('📅 *Calendar* - Create, update, and delete events');
    }
    if (capabilities.database) {
      caps.push('✅ *Tasks* - Manage tasks, reminders, and lists');
    }
    if (capabilities.gmail) {
      caps.push('📧 *Email* - Read, send, and reply to emails');
    }
    if (capabilities.secondBrain) {
      caps.push('🧠 *Memory* - Store and search personal information');
    }
    
    caps.push('💬 *Chat* - Ask me anything!');
    
    return caps.join('\n');
  }
  
  private getHelpMessage(isHebrew: boolean): string {
    if (isHebrew) {
      return `🆘 *עזרה*

*דוגמאות לפקודות:*
• "צור אירוע מחר בשעה 10"
• "הוסף משימה: להתקשר לרופא"
• "מה יש לי היום?"
• "תזכיר לי לקנות חלב בעוד שעה"
• "שמור: מספר הטלפון של יוסי הוא 054-1234567"

*טיפים:*
• דבר אליי בעברית או באנגלית
• אני מבין שפה טבעית
• אפשר לשאול שאלות המשך`;
    }
    
    return `🆘 *Help*

*Example commands:*
• "Create an event tomorrow at 10am"
• "Add task: Call the doctor"
• "What do I have today?"
• "Remind me to buy milk in 1 hour"
• "Save: John's phone number is 555-1234"

*Tips:*
• Talk to me in English or Hebrew
• I understand natural language
• You can ask follow-up questions`;
  }
  
  private getStatusMessage(state: MemoState, isHebrew: boolean): string {
    const caps = state.user.capabilities;
    const connected: string[] = [];
    
    if (caps.calendar) connected.push(isHebrew ? 'לוח שנה' : 'Calendar');
    if (caps.gmail) connected.push(isHebrew ? 'אימייל' : 'Email');
    if (caps.database) connected.push(isHebrew ? 'משימות' : 'Tasks');
    if (caps.secondBrain) connected.push(isHebrew ? 'זיכרון' : 'Memory');
    
    if (isHebrew) {
      return `📊 *סטטוס*

*שירותים פעילים:* ${connected.join(', ') || 'אין'}
*אזור זמן:* ${state.user.timezone}
*שפה:* עברית`;
    }
    
    return `📊 *Status*

*Active services:* ${connected.join(', ') || 'None'}
*Timezone:* ${state.user.timezone}
*Language:* English`;
  }
  
  private getDefaultResponse(isHebrew: boolean): string {
    return isHebrew
      ? 'איך אפשר לעזור?'
      : 'How can I help?';
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export function createGeneralResolver() {
  const resolver = new GeneralResolver();
  return resolver.asNodeFunction();
}

export function createMetaResolver() {
  const resolver = new MetaResolver();
  return resolver.asNodeFunction();
}


