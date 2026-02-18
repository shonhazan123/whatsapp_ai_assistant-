/**
 * General Resolver
 * 
 * Handles conversational responses without tools.
 * Used for greetings, general questions, or when no specific capability is needed.
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { getNodeModel } from '../../config/llm-config.js';
import { getMetaInfo } from '../../config/meta-info.js';
import { getPlanTiers } from '../../config/plan-tiers.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

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
// META RESOLVER (LLM-based — single call with full meta scope)
// ============================================================================

const META_SYSTEM_PROMPT = `You are Donna (in English) or דונה (in Hebrew). You are a female AI personal secretary; when replying in Hebrew, use feminine language (e.g. "אני דונה", "אני יכולה", "בואי", "אתה" when addressing the user is fine; refer to yourself in feminine forms).

Your job is to answer questions about yourself, your capabilities, and the user's account/plan. You will receive agent info, plan definitions, user state, and the user's question.

RULES:
- Answer ONLY from the provided data. Never guess or invent information.
- If something is missing or "Not configured", say so honestly.
- Match the user's language: English → friendly female voice; Hebrew → דונה, feminine Hebrew.
- The response is sent over WhatsApp as plain text: no markdown rendering. Do NOT use markdown link syntax like [text](url) — WhatsApp shows brackets and parentheses literally, so it looks broken. To share a link, write it once on its own line or after a short label, e.g. "האתר: https://donnai.io" or "Website: https://donnai.io". Never write the URL twice (no "👉 [https://...](https://...)").
- Use *asterisks* for bold only if you want emphasis; otherwise keep links and text clean. Be friendly and organized with short lines for readability on a phone.
- Never expose internal details (file names, code paths, env vars).

OUTPUT FORMAT (MUST BE VALID JSON):
{
  "response": "Your full WhatsApp message — already formatted by you (headings, bullets, line breaks as needed)",
  "language": "he" | "en"
}`;

/**
 * MetaResolver — LLM-based resolver that receives the full meta scope
 * (agent identity, plan tiers, user state) and produces the final user message.
 *
 * Actions: describe_capabilities, help, status, website, about_agent,
 *          plan_info, account_status, what_can_you_do
 */
export class MetaResolver extends LLMResolver {
  readonly name = 'meta_resolver';
  readonly capability: Capability = 'meta';
  readonly actions = [
    'describe_capabilities', 'what_can_you_do', 'help', 'status',
    'website', 'about_agent', 'plan_info', 'account_status',
  ];

  getSystemPrompt(): string {
    return META_SYSTEM_PROMPT;
  }

  getSchemaSlice(): object {
    return {
      name: 'metaResponse',
      parameters: {
        type: 'object',
        properties: {
          response: { type: 'string', description: 'Final WhatsApp-formatted message' },
          language: { type: 'string', enum: ['he', 'en'] },
        },
        required: ['response', 'language'],
      },
    };
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    try {
      const userMessage = this.buildMetaUserMessage(step, state);
      const modelConfig = getNodeModel('meta', true);
      const requestId = (state.input as any).requestId;

      const { callLLM: callLLMService } = await import('../../services/llm/LLMService.js');

      const llmResponse = await callLLMService({
        messages: [
          { role: 'system', content: this.getSystemPrompt() },
          { role: 'user', content: userMessage },
        ],
        model: modelConfig.model,
        temperature: 0.3,
        maxTokens: 1000,
        functions: [this.getSchemaSlice() as any],
        functionCall: { name: 'metaResponse' },
      }, requestId);

      let parsed: { response: string; language: string };
      if (llmResponse.functionCall) {
        parsed = JSON.parse(llmResponse.functionCall.arguments);
      } else if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        parsed = JSON.parse(llmResponse.toolCalls[0].function.arguments);
      } else {
        throw new Error('No function call in meta LLM response');
      }

      return {
        stepId: step.id,
        type: 'execute',
        args: {
          response: parsed.response,
          language: parsed.language || state.user.language,
          isMetaFinal: true,
        },
      };
    } catch (error: any) {
      console.error(`[MetaResolver] LLM call failed, using fallback:`, error);
      const fallback = state.user.language === 'he'
        ? 'לא הצלחתי לעבד את הבקשה. נסה שוב בבקשה.'
        : "I couldn't process your request. Please try again.";
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          response: fallback,
          language: state.user.language,
          isMetaFinal: true,
        },
      };
    }
  }

  private buildMetaUserMessage(step: PlanStep, state: MemoState): string {
    const metaInfo = getMetaInfo();
    const allTiers = getPlanTiers();
    const userTier = allTiers[state.user.planTier];

    const caps = state.user.capabilities;
    const enabledServices: string[] = [];
    if (caps.calendar) enabledServices.push('Calendar');
    if (caps.gmail) enabledServices.push('Gmail');
    if (caps.database) enabledServices.push('Tasks & Reminders');
    if (caps.secondBrain) enabledServices.push('Second Brain (Memory)');

    const mi = metaInfo as { agentNameHebrew?: string; shortDescriptionHebrew?: string };
    let msg = `## Agent Information
- Name (EN): ${metaInfo.agentName}${mi.agentNameHebrew ? ` | Name (HE): ${mi.agentNameHebrew}` : ''}
- Description (EN): ${metaInfo.shortDescription}${mi.shortDescriptionHebrew ? `\n- Description (HE): ${mi.shortDescriptionHebrew}` : ''}
- Website URL: ${metaInfo.websiteUrl}`;

    if (metaInfo.supportUrl) msg += `\n- Support URL: ${metaInfo.supportUrl}`;
    if (metaInfo.helpLinks.length > 0) {
      msg += `\n- Help Links:`;
      for (const link of metaInfo.helpLinks) {
        msg += `\n  • ${link.label}: ${link.url}`;
      }
    }

    msg += `\n\n## Subscription Plans (source: https://donnai.io/pricing)`;
    for (const [tierKey, tier] of Object.entries(allTiers)) {
      const th = tier as { nameHebrew?: string; period?: string; featuresHebrew?: string[] };
      msg += `\n### ${tier.name}${th.nameHebrew ? ` / ${th.nameHebrew}` : ''} (${tierKey})`;
      msg += `\n- Price: ${tier.price} ${tier.currency}${th.period ? `/${th.period}` : ''}`;
      msg += `\n- Features (EN): ${tier.features.join(', ')}`;
      if (th.featuresHebrew && th.featuresHebrew.length) {
        msg += `\n- Features (HE): ${th.featuresHebrew.join(', ')}`;
      }
    }

    msg += `\n\n## User Account`;
    msg += `\n- Current plan: ${state.user.planTier}${userTier ? ` (${userTier.name})` : ''}`;
    msg += `\n- Google Connected: ${state.user.googleConnected ? 'Yes' : 'No'}`;
    msg += `\n- Enabled capabilities: ${enabledServices.length > 0 ? enabledServices.join(', ') : 'None'}`;
    msg += `\n- Timezone: ${state.user.timezone}`;
    msg += `\n- Language: ${state.user.language === 'he' ? 'Hebrew' : 'English'}`;

    msg += `\n\n## User's Question\n${state.input.enhancedMessage || state.input.message}`;

    return msg;
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


