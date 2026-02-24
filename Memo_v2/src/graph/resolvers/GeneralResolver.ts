/**
 * General Resolver
 *
 * Single informative capability: answers about the user (name, account, capabilities),
 * about what the assistant did (last/recent actions), acknowledgments, and about the
 * agent (identity, capabilities, help, status, plan/account, website). One prompt,
 * one context, one resolve path.
 *
 * Static data (agent info, subscription plans) is in the system prompt so it can be
 * cached by the LLM provider to reduce tokens and cost per request.
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { getMetaInfo } from '../../config/meta-info.js';
import { getPlanTiers } from '../../config/plan-tiers.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// SYSTEM PROMPT (cacheable: instructions + static agent/plans)
// ============================================================================

const SYSTEM_INSTRUCTIONS = `You are Donna (in English) or דונה (in Hebrew). You are a female AI personal secretary; when replying in Hebrew, use feminine language (e.g. "אני דונה", "אני יכולה"; refer to yourself in feminine forms).

Your job is to answer ONLY from the provided context. In each request you receive (in the user message) the per-request context: current time, user profile, latest actions, recent conversation, and the user's message. The system message above also contains static reference data: Agent Information and Subscription Plans (use these for "what can you do?", "who are you?", "website?", "what's my plan?", pricing, etc.).

YOU MAY:
- Answer "what's my name?", "did you create X?", "what are the recent things you created?"
- Answer "what can you do?", "help", "who are you?", "what's my plan?", "what's the website?", "privacy policy?", status/account questions; when asked for a link (website, support, privacy, pricing, login), provide the URL from Agent Information or Help Links once, on its own line or after a short label
- Acknowledge: thank you, okay, בסדר, תודה
- Greet and guide the user. Match the user's language (Hebrew or English).

RULES:
- Answer ONLY from the provided data. Never guess or invent. If something is missing, say so honestly.
- The response is sent over WhatsApp as plain text: no markdown link syntax like [text](url). To share a link, write it once on its own line or after a short label, e.g. "האתר: https://donnai.io". Never write the URL twice.
- Use *asterisks* for bold only if needed. Keep links and text clean; short lines for readability on a phone.
- Never expose internal details (file names, code paths, env vars). Do not answer general-knowledge questions outside this app.

OUTPUT FORMAT (MUST BE VALID JSON):
Respond with ONLY valid JSON, no additional text.
{
  "response": "Your message here",
  "language": "he" | "en"
}`;

/** Build static agent + plans block once (cacheable with system prompt). */
function buildStaticContextBlock(): string {
  const metaInfo = getMetaInfo();
  const mi = metaInfo as { agentNameHebrew?: string; shortDescriptionHebrew?: string };
  const lines: string[] = [
    '---',
    '## Agent Information (static reference)',
    `- Name (EN): ${metaInfo.agentName}${mi.agentNameHebrew ? ` | Name (HE): ${mi.agentNameHebrew}` : ''}`,
    `- Description (EN): ${metaInfo.shortDescription}${mi.shortDescriptionHebrew ? `\n- Description (HE): ${mi.shortDescriptionHebrew}` : ''}`,
    `- Website URL: ${metaInfo.websiteUrl}`,
  ];
  if (metaInfo.supportUrl) lines.push(`- Support URL: ${metaInfo.supportUrl}`);
  if (metaInfo.privacyUrl) lines.push(`- Privacy URL: ${metaInfo.privacyUrl}`);
  if (metaInfo.helpLinks.length > 0) {
    lines.push('- Help Links:');
    for (const link of metaInfo.helpLinks) {
      lines.push(`  • ${link.label}: ${link.url}`);
    }
  }
  const allTiers = getPlanTiers();
  lines.push('', '## Subscription Plans (static reference, source: https://donnai.io/pricing)');
  for (const [tierKey, tier] of Object.entries(allTiers)) {
    const th = tier as { nameHebrew?: string; period?: string; featuresHebrew?: string[] };
    lines.push(`### ${tier.name}${th.nameHebrew ? ` / ${th.nameHebrew}` : ''} (${tierKey})`);
    lines.push(`- Price: ${tier.price} ${tier.currency}${th.period ? `/${th.period}` : ''}`);
    lines.push(`- Features (EN): ${tier.features.join(', ')}`);
    if (th.featuresHebrew && th.featuresHebrew.length) {
      lines.push(`- Features (HE): ${th.featuresHebrew.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** Cached full system prompt (instructions + static context) for token caching. */
const CACHED_SYSTEM_PROMPT = SYSTEM_INSTRUCTIONS + '\n\n' + buildStaticContextBlock();

/**
 * GeneralResolver — single resolver for all user and system informative questions.
 * Actions: respond, greet, acknowledge, ask_about_* (user/recent actions), clarify, unknown;
 * plus describe_capabilities, what_can_you_do, help, status, website, about_agent, plan_info, account_status.
 */
export class GeneralResolver extends LLMResolver {
  readonly name = 'general_resolver';
  readonly capability: Capability = 'general';
  readonly actions = [
    'respond',
    'greet',
    'acknowledge',
    'ask_about_recent_actions',
    'ask_about_user',
    'ask_about_what_i_did',
    'clarify',
    'unknown',
    'greeting response',
    'process request',
    'describe_capabilities',
    'what_can_you_do',
    'help',
    'status',
    'website',
    'about_agent',
    'plan_info',
    'account_status',
  ];

  getSystemPrompt(): string {
    return CACHED_SYSTEM_PROMPT;
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

  protected override buildUserMessage(step: PlanStep, state: MemoState): string {
    const message = state.input.enhancedMessage || state.input.message;
    const lines: string[] = [];

    lines.push(`Current time: ${state.now.formatted}`);
    lines.push('');

    const clarification = this.findClarificationResult(state);
    if (clarification) {
      lines.push('## User Clarification');
      lines.push(`The user was asked for more information and responded: "${clarification}"`);
      lines.push('Use this together with the user message below.');
      lines.push('');
    }

    lines.push('## Latest Actions (most-recent first)');
    if (state.latestActions && state.latestActions.length > 0) {
      for (const action of state.latestActions) {
        const whenPart = action.when ? ` | when: ${action.when}` : '';
        lines.push(`- [${action.capability}] ${action.action}: "${action.summary}"${whenPart}`);
      }
    } else {
      lines.push('(none)');
    }
    lines.push('');

    const u = state.user;
    const caps = u.capabilities;
    const enabled = [
      caps.calendar && 'calendar',
      caps.gmail && 'gmail',
      caps.database && 'tasks/reminders',
      caps.secondBrain && 'second brain',
    ].filter(Boolean);
    lines.push('## User');
    lines.push(`- Name: ${u.userName ?? '(not set)'}`);
    lines.push(`- Language: ${u.language}`);
    lines.push(`- Timezone: ${u.timezone}`);
    lines.push(`- Plan: ${u.planTier}`);
    lines.push(`- Google connected: ${u.googleConnected}`);
    lines.push(`- Enabled capabilities: ${enabled.join(', ') || 'none'}`);
    lines.push('');

    lines.push('## Recent conversation');
    if (state.recentMessages && state.recentMessages.length > 0) {
      const recent = state.recentMessages.slice(-10);
      for (const msg of recent) {
        const preview = msg.content.length > 350 ? msg.content.substring(0, 350) + '...' : msg.content;
        lines.push(`[${msg.role}]: ${preview}`);
      }
    } else {
      lines.push('(none)');
    }
    lines.push('');

    lines.push('## User message');
    lines.push(`Action hint: ${step.action}`);
    if (Object.keys(step.constraints).length > 0) {
      lines.push(`Constraints: ${JSON.stringify(step.constraints)}`);
    }
    lines.push('');
    lines.push(message);

    return lines.join('\n');
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    try {
      const llmResult = await this.callLLM(step, state);

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
      const fallbackResponse =
        state.user.language === 'he'
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
}

// ============================================================================
// FACTORY
// ============================================================================

export function createGeneralResolver() {
  const resolver = new GeneralResolver();
  return resolver.asNodeFunction();
}
