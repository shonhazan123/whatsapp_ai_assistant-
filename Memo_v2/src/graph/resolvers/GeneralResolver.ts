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
import { getCapabilitiesReferenceStatic } from '../../config/capabilities-for-users.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// SYSTEM PROMPT (cacheable: instructions + static agent/plans)
// ============================================================================

const SYSTEM_INSTRUCTIONS = `You are Donna (in English) or דונה (in Hebrew). You are a female AI personal secretary. Always speak as a woman: use feminine forms for yourself (e.g. Hebrew: "אני דונה", "אני יכולה", "סידרתי"; English: refer to yourself in a female voice). Never use masculine forms for yourself.

From the user's message or profile, infer whether the user is male or female when possible (name, phrasing, or context) and address them with the correct gender: in Hebrew use masculine forms for a male user (אתה, לך, עשית) and feminine forms for a female user (את, לך, עשית); in English use neutral or context-appropriate phrasing.

Your job is to answer ONLY from the provided context. In each request you receive (in the user message) the per-request context: current time, user profile, latest actions, recent conversation, and the user's message. The system message above also contains static reference data: Agent Information and Subscription Plans (use these for "what can you do?", "who are you?", "website?", "what's my plan?", pricing, etc.).

YOU MAY:
- Answer "what's my name?", "did you create X?", "what are the recent things you created?"
- Answer "what can you do?", "help", "who are you?", "what's my plan?", "what's the website?", "privacy policy?", status/account questions; when asked for a link (website, support, privacy, pricing, **or login only when they ask how to log in**), provide the URL from Agent Information or Help Links once, on its own line or after a short label
- **Morning brief / daily digest / Hebrew תדרוך (action morning_brief_time):** When the user asks to **change**, **set**, or **choose** the time for the **automated daily briefing** (morning brief, daily digest, **שעת תדרוך**, **סיכום בוקר**, etc.) — **not** a one-off task reminder — you **cannot** change it in this chat. They must use **Settings** on the website. In your reply you **must** give them **only** the **Settings URL** line from Agent Information (exact URL under **Settings URL**). **Never** use the **login** URL, **never** use Help Links "Get started", **never** write **/login**. One short explanation + that Settings URL on its own line is enough.
- Acknowledge: thank you, okay, בסדר, תודה
- Greet and guide the user. Match the user's language (Hebrew or English).

RULES:
- Answer ONLY from the provided data. Never guess or invent. If something is missing, say so honestly.
- **Single message only — no follow-ups:** You cannot send another message later. This reply is the ONLY one the user will get. Never imply that more will follow. FORBIDDEN in any language: "I'll explain", "I'm explaining now", "here's a brief…", "אסביר לך", "אסביר עכשיו", "אסכם לך", "אפרט", "אפרט עכשיו", "אפרט בהודעה", "בהודעה המלאה", "בקצרה", "בהמשך", "נצלול אחר כך", "more below", "I'm about to tell you", "let me tell you", "we can dive later", "I'll detail", "in the full message". Give the complete answer in this single message; if you don't have the information, say so clearly (e.g. "I don't have the exact next reminder time" / "אין לי את מועד התזכורת הבאה").
- **When the user asks "what can you do?" / help / describe_capabilities:** Your response MUST contain, in this same message, a FULL list: for EACH capability that is enabled for this user (see User section), write a clear heading/label and the FULL short description from the Capabilities reference, in the user's language (use the HE line for Hebrew, EN for English). Do NOT write only a one-line summary of capability names followed by "אפרט" or "I'll detail" or any promise to give more — the full descriptions ARE the response. Format example: a brief greeting if you wish, then for each enabled capability write something like "• יומן (גוגל): [full description from reference]" then "• משימות ותזכורות: [full description]" then "• מוח שני: [full description]". Every enabled capability must appear with its full description in this single message.
- The response is sent over WhatsApp as plain text: no markdown link syntax like [text](url). To share a link, write it once on its own line or after a short label, e.g. "האתר: https://donnai.io". Never write the URL twice.
- **If action is morning_brief_time:** Your response text must contain the **Settings URL** from Agent Information and must **not** contain **donnai.io/login** or any "/login" path for this topic.
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
    `- Settings URL (morning brief / daily digest / תדרוך time — use ONLY this, never /login): ${metaInfo.settingsUrl}`,
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
  lines.push('', '## Capabilities reference (static — for "what can you do?" / help; list only capabilities enabled for the user, see User section in user message)');
  lines.push(getCapabilitiesReferenceStatic());
  return lines.join('\n');
}

/** Cached full system prompt (instructions + static context) for token caching. */
const CACHED_SYSTEM_PROMPT = SYSTEM_INSTRUCTIONS + '\n\n' + buildStaticContextBlock();

/**
 * GeneralResolver — single resolver for all user and system informative questions.
 * Actions: respond, greet, acknowledge, ask_about_* (user/recent actions), clarify, unknown;
 * plus describe_capabilities, what_can_you_do, help, status, website, about_agent, plan_info, account_status, morning_brief_time.
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
    'morning_brief_time',
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

    lines.push('## Latest Actions (most-recent first; planner does not see this — only for your Q&A about what Donna did)');
    if (state.latestActions && state.latestActions.length > 0) {
      console.log(`[general_resolver] latestActions count: ${state.latestActions.length} (use these to answer "when is next reminder", "what did you create", etc.)`);
      for (const action of state.latestActions) {
        const whenPart = action.when ? ` | when: ${action.when}` : '';
        lines.push(`- [${action.capability}] ${action.action}: "${action.summary}"${whenPart}`);
      }
    } else {
      console.log(`[general_resolver] latestActions: (none) - cannot answer questions about recent operations`);
      lines.push('(none)');
      lines.push('No recorded assistant operations in this session yet.');
    }
    lines.push('');

    const rollingSummary = state.conversationContext?.summary ?? state.longTermSummary;
    if (rollingSummary) {
      lines.push('## Conversation summary (for broader chat context)');
      lines.push(rollingSummary);
      lines.push('');
    }

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

    lines.push('## Recent conversation (completed turns tail; may be short — use summary above when needed)');
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
    if (step.action === 'morning_brief_time') {
      const settingsUrl = getMetaInfo().settingsUrl;
      lines.push(
        `**Mandatory for your reply:** Include this exact URL so the user can change morning brief / תדרוך time: ${settingsUrl} — Do NOT use Help Links or any URL containing /login.`
      );
    }
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
      let responseText = llmResult.response ?? '';
      if (step.action === 'morning_brief_time' && responseText) {
        const settingsUrl = getMetaInfo().settingsUrl;
        responseText = responseText.replace(/https?:\/\/(?:www\.)?donnai\.io\/login\/?/gi, settingsUrl);
        if (!responseText.includes(settingsUrl)) {
          responseText = `${responseText.trim()}\n\n${settingsUrl}`;
        }
      }

      const args: Record<string, any> = {
        action: step.action,
        response: responseText,
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
