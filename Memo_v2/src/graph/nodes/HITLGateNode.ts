/**
 * HITLGateNode - Canonical HITL Control-Plane
 *
 * Single contract-driven gate: one pendingHITL at a time,
 * deterministic resume routing via Command({ update, goto }).
 *
 * Responsibilities:
 * - Contract manager: creates exactly one PendingHITL per interruption.
 * - Resume validator: validates user reply vs expectedInput, writes hitlResults,
 *   routes via Command({ update, goto }) derived from pendingHITL.returnTo.
 * - Multi-HITL guard: if pendingHITL already exists, ignores duplicate triggers.
 * - Expiry enforcement: clears expired pendingHITL, responds with expiry message.
 * - LLM guardrails: LLM generates question text only; options are machine-controlled.
 */

import { Command, interrupt } from '@langchain/langgraph';
import { randomUUID } from 'crypto';
import { callLLM } from '../../services/llm/LLMService.js';
import { getMemoryService } from '../../services/memory/index.js';
import type { InterruptPayload, InterruptType } from '../../types/index.js';
import type {
  HITLExpectedInput,
  HITLKind,
  HITLPolicySource,
  HITLReason,
  HITLReturnTo,
  HITLSource,
  PendingHITL,
  PendingHITLOption,
} from '../../types/hitl.js';
import { HITL_TTL_MS } from '../../types/hitl.js';
import type { MemoState } from '../state/MemoState.js';

const CONFIDENCE_THRESHOLD = 0.7;

// ============================================================================
// CLARIFICATION PROMPT
// ============================================================================

const CLARIFICATION_SYSTEM_PROMPT = `You are a friendly WhatsApp assistant helping clarify an ambiguous user request.

## Your Task
Generate a SHORT, conversational message asking the user to clarify their intent.

## Rules
1. RESPOND ONLY in the user's language (Hebrew/English)
2. Be conversational and friendly, NOT robotic
3. Keep it SHORT (2-4 sentences max)
4. NEVER expose internal names like "calendar_mutate_resolver" or "database_task_resolver"
5. If multiple options exist, present them as friendly alternatives
6. If something specific is missing (like time/date), ask for it naturally
7. Use the user's original words when referring to what they asked

## Capability Descriptions (use these friendly terms)
- calendar (create/edit): "להוסיף/לערוך אירוע ביומן" / "add/edit calendar event"
- calendar (query): "לבדוק מה יש ביומן" / "check your calendar"
- database (reminder): "ליצור תזכורת" / "create a reminder"
- database (task): "ליצור משימה" / "create a task"
- gmail: "לטפל במייל" / "handle email"
- second-brain: When asking if user wants to SAVE/REMEMBER something, use exactly: "לשמור בזכרון?" (Hebrew) / "save to memory?" (English). For search/recall: "לחפש בזכרון?" / "search memory?"

## Missing Field Translations
- reminder_time_required: Ask at what time (and date if missing). Reminders need a specific date and time.
- target_unclear: Ask WHICH specific items (by name or time window)
- time_unclear: Ask WHEN
- intent_unclear: Ask WHAT they want to do. Always offer second-brain as an option when it could apply.
- which_one: Ask which specific item from options

## Output
Return ONLY the clarification message text. No JSON, no markdown, no explanations.`;

// ============================================================================
// CONFIRMATION / APPROVAL PROMPT
// ============================================================================

const CONFIRMATION_SYSTEM_PROMPT = `You are Memo — a warm, friendly female WhatsApp assistant.
The user already asked for this action. You are NOT asking if they want it — you are just confirming before you go ahead, like a good friend double-checking.

## Your Task
Generate a SHORT, casual confirmation message. Tone: "just making sure" — light, warm, not alarming.

## Rules
1. RESPOND ONLY in the user's language (Hebrew/English)
2. You are FEMALE — use feminine Hebrew forms: "רוצה שאמחק", "מוודאה", "אמשיך" (NOT masculine "מוודא", "אתה בטוח")
3. ALWAYS mention the SPECIFIC items/targets BY NAME. If the user said "these two tasks" or "המשימות האלה" without naming them, use the "Recent conversation" section to find the actual task/event/item names (e.g. from a previous Assistant message that listed them) and list those names in your confirmation — don't be vague.
4. Keep it SHORT — 1-2 sentences max
5. NEVER expose internal names (no "delete_multiple_tasks", no "calendar_mutate_resolver", no "deleteBySummary")
6. Use natural action words: "למחוק" (delete), "לעדכן" (update), "לשלוח" (send), "ליצור" (create)
7. Tone: casual double-check, NOT a scary warning. No ⚠️. A smiley is fine.
8. Do NOT ask "are you sure?" robotically — phrase it naturally like "רק מוודאה — למחוק את X ו-Y?"
9. End with a natural yes/no expectation (the options buttons are added separately)

## Examples (Hebrew)
- User wants to delete tasks "לתכנן מה לפתח" and "בדיקה לאסלה":
  "רק מוודאה — למחוק את *לתכנן מה לפתח בתוכנה* ו*לעשות בדיקה לאסלה*? 🙂"
- User wants to delete calendar events for tomorrow:
  "רק מוודאה שאמחק את האירועים של מחר, בסדר? 🙂"
- User wants to send an email:
  "רגע לפני ששולחת — הכל נראה טוב?"

## Examples (English)
- "Just making sure — delete *plan software features* and *toilet inspection*? 🙂"
- "Before I go ahead and delete tomorrow's events — all good? 🙂"

## Output
Return ONLY the confirmation message text. No JSON, no markdown fences, no explanations.`;

// ============================================================================
// HITL GATE NODE
// ============================================================================

export class HITLGateNode {
  readonly name = 'hitl_gate';

  async process(state: MemoState): Promise<Partial<MemoState> | Command> {
    const traceId = state.traceId;
    const threadId = state.threadId;

    // ====================================================================
    // FORWARD PATH: check if HITL is needed, interrupt inline, handle resume
    // ====================================================================

    // 1) Entity disambiguation (machine-only: state.disambiguation with candidates)
    if (state.disambiguation?.candidates && state.disambiguation.candidates.length > 0
        && !state.disambiguation.resolved) {
      console.log(JSON.stringify({
        event: 'HITL_ENTITY_DISAMBIGUATION_DETECTED',
        traceId, threadId,
        resolverStepId: state.disambiguation.resolverStepId,
      }));
      return this.interruptForEntityDisambiguation(state);
    }

    // 2) Planner HITL conditions
    const plannerCheck = this.checkPlannerHITLConditions(state);
    if (plannerCheck.shouldInterrupt) {
      console.log(JSON.stringify({
        event: 'HITL_PLANNER_TRIGGER',
        traceId, threadId,
        reason: plannerCheck.reason,
        details: plannerCheck.details,
      }));
      return this.interruptForPlannerHITL(plannerCheck, state);
    }

    // No HITL needed
    console.log(JSON.stringify({
      event: 'HITL_GATE_PASS',
      traceId, threadId,
    }));
    return {};
  }

  // ========================================================================
  // INTERRUPT + RESUME: Entity Disambiguation
  // Builds pendingHITL, calls interrupt(), validates reply, returns Command.
  // ========================================================================

  private async interruptForEntityDisambiguation(state: MemoState): Promise<Partial<MemoState> | Command> {
    // Multi-HITL guard
    if (state.pendingHITL !== null) {
      console.log(JSON.stringify({
        event: 'HITL_DUPLICATE_ATTEMPT',
        traceId: state.traceId,
        threadId: state.threadId,
        existingHitlId: state.pendingHITL.hitlId,
        newSource: 'entity_resolution',
      }));
      return {};
    }

    const disambiguation = state.disambiguation!;
    const candidates = disambiguation.candidates || [];
    const language = state.user.language;

    const options: PendingHITLOption[] = candidates.map((c, i) => ({
      id: String(i + 1),
      label: c.displayText,
    }));

    const question = this.getDisambiguationQuestion(language, candidates, disambiguation.allowMultiple);
    const expectedInput: HITLExpectedInput = disambiguation.allowMultiple ? 'multi_choice' : 'single_choice';

    const hitlId = randomUUID();
    const pending: PendingHITL = {
      version: 1,
      hitlId,
      kind: 'disambiguation',
      source: 'entity_resolution',
      reason: 'disambiguation',
      originStepId: disambiguation.resolverStepId,
      returnTo: { node: 'entity_resolution', mode: 'apply_selection' },
      expectedInput,
      question,
      options,
      expiresAt: new Date(Date.now() + HITL_TTL_MS).toISOString(),
      context: {
        resolverStepId: disambiguation.resolverStepId,
        originalArgs: disambiguation.originalArgs,
        candidates,
        allowMultiple: disambiguation.allowMultiple,
        disambiguationKind: disambiguation.allowMultiple ? 'pick_many' : 'pick_one',
      },
      createdAt: new Date().toISOString(),
    };

    console.log(JSON.stringify({
      event: 'HITL_CREATED',
      traceId: state.traceId,
      threadId: state.threadId,
      hitlId,
      kind: 'disambiguation',
      source: 'entity_resolution',
      returnTo: pending.returnTo,
    }));

    // Build interrupt payload and pause the graph
    const payload = this.buildInterruptPayloadFromPending(pending, state);
    this.addInterruptMessageToMemory(state, pending.question);
    const userResponse = interrupt(payload);

    // === BELOW RUNS AFTER USER REPLIES (graph resumed) ===
    return this.handleResumeInline(state, pending, String(userResponse));
  }

  // ========================================================================
  // INTERRUPT + RESUME: Planner HITL
  // Builds pendingHITL, calls interrupt(), validates reply, returns Command.
  // ========================================================================

  private async interruptForPlannerHITL(
    check: PlannerHITLCheckResult,
    state: MemoState,
  ): Promise<Partial<MemoState> | Command> {
    // Multi-HITL guard
    if (state.pendingHITL !== null) {
      console.log(JSON.stringify({
        event: 'HITL_DUPLICATE_ATTEMPT',
        traceId: state.traceId,
        threadId: state.threadId,
        existingHitlId: state.pendingHITL.hitlId,
        newSource: 'planner',
      }));
      return {};
    }

    const language = state.user.language;
    const hitlId = randomUUID();
    const reason = check.reason || 'low_confidence_plan';

    const kind: HITLKind = this.reasonToKind(reason);

    const returnTo: HITLReturnTo = reason === 'intent_unclear'
      ? { node: 'planner', mode: 'replan' }
      : { node: 'resolver_router', mode: 'continue' };

    const expectedInput: HITLExpectedInput =
      (kind === 'approval' || reason === 'confirmation' || reason === 'high_risk' || reason === 'needs_approval')
        ? 'yes_no'
        : 'free_text';

    let policySource: HITLPolicySource | undefined;
    if (kind === 'approval') {
      if (reason === 'high_risk' || reason === 'needs_approval') {
        policySource = 'planner';
      } else if (reason === 'tool_requires_review') {
        policySource = 'tool_policy';
      } else if (reason === 'policy_violation') {
        policySource = 'tool_policy';
      }
    }

    const originStepId = state.plannerOutput?.plan?.[0]?.id || 'planner';

    let options: PendingHITLOption[] | undefined;
    if (expectedInput === 'yes_no') {
      options = language === 'he'
        ? [{ id: 'yes', label: 'כן' }, { id: 'no', label: 'לא' }]
        : [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }];
    }

    let question: string;
    if (kind === 'clarification') {
      question = await this.generateClarificationWithLLM(check, state);
    } else {
      question = await this.generateConfirmationWithLLM(check, state);
    }

    const pending: PendingHITL = {
      version: 1,
      hitlId,
      kind,
      source: 'planner',
      reason: reason as HITLReason,
      originStepId,
      returnTo,
      expectedInput,
      question,
      options,
      policySource,
      expiresAt: new Date(Date.now() + HITL_TTL_MS).toISOString(),
      createdAt: new Date().toISOString(),
    };

    console.log(JSON.stringify({
      event: 'HITL_CREATED',
      traceId: state.traceId,
      threadId: state.threadId,
      hitlId,
      kind,
      reason: check.reason,
      source: 'planner',
      returnTo,
    }));

    // Build interrupt payload and pause the graph
    const payload = this.buildInterruptPayloadFromPending(pending, state);
    this.addInterruptMessageToMemory(state, pending.question);
    const userResponse = interrupt(payload);

    // === BELOW RUNS AFTER USER REPLIES (graph resumed) ===
    return this.handleResumeInline(state, pending, String(userResponse));
  }

  // ========================================================================
  // SHARED RESUME HANDLER (called inline after interrupt() returns)
  // ========================================================================

  private handleResumeInline(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
  ): Command {
    const traceId = state.traceId;
    const threadId = state.threadId;

    this.addUserResponseToMemory(state, rawReply);

    // Expiry check (defense-in-depth: user replied after TTL)
    if (pending.expiresAt && new Date(pending.expiresAt).getTime() < Date.now()) {
      console.log(JSON.stringify({
        event: 'HITL_EXPIRED',
        traceId, threadId,
        hitlId: pending.hitlId,
        originStepId: pending.originStepId,
      }));

      const language = state.user.language;
      const expiryMessage = language === 'he'
        ? 'הבקשה פגה — רוצה לנסות שוב?'
        : 'That request expired — want to try again?';

      return new Command({
        update: {
          pendingHITL: null,
          finalResponse: expiryMessage,
        } as Partial<MemoState>,
        goto: 'response_writer',
      });
    }

    // Validate reply against expectedInput
    const validation = this.validateReply(rawReply, pending);

    if (!validation.valid) {
      console.log(JSON.stringify({
        event: 'HITL_INVALID_REPLY',
        traceId, threadId,
        hitlId: pending.hitlId,
        expectedInput: pending.expectedInput,
        rawReply,
      }));

      // Do NOT continue with the pending action. Treat the user's message as a new request
      // and re-route to planner so we plan for the new input (e.g. "מה האירועים שלי?" instead of yes/no).
      const newInput = {
        ...state.input,
        message: rawReply,
        enhancedMessage: rawReply,
      };
      const hitlExchange: MemoState['recentMessages'] = [
        { role: 'assistant', content: pending.question, timestamp: new Date().toISOString() },
        { role: 'user', content: rawReply, timestamp: new Date().toISOString() },
      ];
      console.log(`[HITLGateNode] Invalid reply: re-routing to planner with new message as input: "${rawReply.slice(0, 80)}${rawReply.length > 80 ? '...' : ''}"`);
      return new Command({
        update: {
          pendingHITL: null,
          input: newInput,
          recentMessages: hitlExchange,
          // Clear old plan so planner runs fresh on the new message and downstream uses new plan
          plannerOutput: undefined,
        } as Partial<MemoState>,
        goto: 'planner',
      });
    }

    // Valid reply — write hitlResults, clear pendingHITL, route via returnTo
    const hitlResultEntry = {
      raw: rawReply,
      parsed: validation.parsed,
      at: new Date().toISOString(),
      returnTo: pending.returnTo,
    };

    const hitlResults = {
      ...state.hitlResults,
      [pending.hitlId]: hitlResultEntry,
    };

    const goto = this.deriveGoto(pending.returnTo);

    let disambiguationUpdate: MemoState['disambiguation'] | undefined;
    if (pending.source === 'entity_resolution' && state.disambiguation) {
      disambiguationUpdate = {
        ...state.disambiguation,
        userSelection: validation.parsed,
        resolved: false,
      };
    }

    console.log(JSON.stringify({
      event: 'HITL_RESUME_VALID',
      traceId, threadId,
      hitlId: pending.hitlId,
      parsedResult: validation.parsed,
      returnTo: pending.returnTo,
      goto,
    }));

    const update: Partial<MemoState> = {
      pendingHITL: null,
      hitlResults,
      error: undefined,
      ...(disambiguationUpdate ? { disambiguation: disambiguationUpdate } : {}),
    };

    return new Command({ update, goto });
  }

  // ========================================================================
  // PLANNER HITL CONDITION CHECKING
  // ========================================================================

  private checkPlannerHITLConditions(state: MemoState): PlannerHITLCheckResult {
    const plannerOutput = state.plannerOutput;
    if (!plannerOutput) {
      return { shouldInterrupt: false };
    }

    if (plannerOutput.missingFields.includes('intent_unclear')) {
      return {
        shouldInterrupt: true,
        reason: 'intent_unclear',
        details: 'Unclear what action user wants to take — will re-plan after clarification',
        missingFields: plannerOutput.missingFields,
      };
    }

    if (plannerOutput.confidence < CONFIDENCE_THRESHOLD) {
      return {
        shouldInterrupt: true,
        reason: 'low_confidence_plan',
        details: `Confidence ${plannerOutput.confidence} below threshold ${CONFIDENCE_THRESHOLD}`,
      };
    }

    if (plannerOutput.missingFields.length > 0) {
      return {
        shouldInterrupt: true,
        reason: 'missing_fields',
        details: `Missing: ${plannerOutput.missingFields.join(', ')}`,
        missingFields: plannerOutput.missingFields,
      };
    }

    if (plannerOutput.riskLevel === 'high') {
      return {
        shouldInterrupt: true,
        reason: 'high_risk',
        details: 'High risk operation requires confirmation',
      };
    }

    if (plannerOutput.needsApproval) {
      return {
        shouldInterrupt: true,
        reason: 'needs_approval',
        details: 'Operation requires explicit user approval',
      };
    }

    return { shouldInterrupt: false };
  }

  // ========================================================================
  // REPLY VALIDATION
  // ========================================================================

  private validateReply(
    raw: string,
    pending: PendingHITL,
  ): { valid: boolean; parsed: any } {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { valid: false, parsed: null };
    }

    switch (pending.expectedInput) {
      case 'yes_no':
        return this.validateYesNo(trimmed);

      case 'single_choice':
        return this.validateSingleChoice(trimmed, pending);

      case 'multi_choice':
        return this.validateMultiChoice(trimmed, pending);

      case 'free_text':
        return { valid: true, parsed: trimmed };

      default:
        return { valid: true, parsed: trimmed };
    }
  }

  private validateYesNo(trimmed: string): { valid: boolean; parsed: any } {
    const lower = trimmed.toLowerCase();
    const yesPatterns = ['yes', 'y', 'כן', 'כ', 'בטוח', 'sure', 'ok', 'okay', 'yep', 'yeah', 'אישור'];
    const noPatterns = ['no', 'n', 'לא', 'ל', 'cancel', 'ביטול', 'nope', 'nah'];

    if (yesPatterns.includes(lower)) return { valid: true, parsed: 'yes' };
    if (noPatterns.includes(lower)) return { valid: true, parsed: 'no' };

    return { valid: false, parsed: null };
  }

  private validateSingleChoice(
    trimmed: string,
    pending: PendingHITL,
  ): { valid: boolean; parsed: any } {
    const optionCount = pending.options?.length || 0;

    // Numeric selection (1-based)
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= optionCount) {
      return { valid: true, parsed: num };
    }

    // Option id match
    const matchedOption = pending.options?.find(o => o.id === trimmed || o.label.toLowerCase() === trimmed.toLowerCase());
    if (matchedOption) {
      const idx = pending.options!.indexOf(matchedOption) + 1;
      return { valid: true, parsed: idx };
    }

    // "both"/"all" → treat as first if single_choice
    const allPatterns = ['both', 'all', 'שניהם', 'כולם'];
    if (allPatterns.includes(trimmed.toLowerCase())) {
      return { valid: true, parsed: trimmed };
    }

    // Free text fallback (for text-based selection)
    return { valid: true, parsed: trimmed };
  }

  private validateMultiChoice(
    trimmed: string,
    pending: PendingHITL,
  ): { valid: boolean; parsed: any } {
    const optionCount = pending.options?.length || 0;

    // "both"/"all"
    const allPatterns = ['both', 'all', 'שניהם', 'כולם'];
    if (allPatterns.includes(trimmed.toLowerCase())) {
      return { valid: true, parsed: trimmed };
    }

    // Parse "2 3" or "2,3" or "1, 3"
    const numbers = trimmed.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      const parsed = numbers.map(n => parseInt(n, 10));
      const allValid = parsed.every(n => n >= 1 && n <= optionCount);
      if (allValid) {
        return { valid: true, parsed };
      }
    }

    // Fallback: accept as free text
    return { valid: true, parsed: trimmed };
  }

  // ========================================================================
  // ROUTING
  // ========================================================================

  private deriveGoto(returnTo: HITLReturnTo): string {
    switch (returnTo.node) {
      case 'planner':
        return 'planner';
      case 'resolver_router':
        return 'resolver_router';
      case 'entity_resolution':
        return 'entity_resolution';
      default:
        return 'resolver_router';
    }
  }

  // ========================================================================
  // INTERRUPT PAYLOAD BUILDER (for interrupt() call)
  // ========================================================================

  private buildInterruptPayloadFromPending(
    pending: PendingHITL,
    state: MemoState,
  ): InterruptPayload {
    return {
      type: this.kindToInterruptType(pending.kind),
      question: pending.question,
      options: pending.options?.map((o, i) => `${i + 1}. ${o.label}`),
      metadata: {
        hitlId: pending.hitlId,
        kind: pending.kind,
        source: pending.source,
        expectedInput: pending.expectedInput,
        returnTo: pending.returnTo,
        stepId: pending.originStepId,
        interruptedAt: Date.now(),
      },
    };
  }

  private kindToInterruptType(kind: HITLKind): InterruptType {
    switch (kind) {
      case 'clarification': return 'clarification';
      case 'approval': return 'confirmation';
      case 'disambiguation': return 'disambiguation';
      default: return 'clarification';
    }
  }

  // ========================================================================
  // REASON → KIND MAPPING
  // ========================================================================

  private reasonToKind(reason: string): HITLKind {
    switch (reason) {
      case 'intent_unclear':
      case 'missing_fields':
      case 'low_confidence_plan':
      case 'ambiguous_scope':
        return 'clarification';

      case 'confirmation':
      case 'high_risk':
      case 'needs_approval':
      case 'tool_requires_review':
      case 'policy_violation':
        return 'approval';

      case 'disambiguation':
        return 'disambiguation';

      default:
        return 'clarification';
    }
  }

  // ========================================================================
  // DISAMBIGUATION QUESTION (machine-controlled, no LLM)
  // ========================================================================

  private getDisambiguationQuestion(
    language: 'he' | 'en' | 'other',
    candidates: Array<{ displayText: string }>,
    allowMultiple?: boolean,
  ): string {
    const options = candidates
      .map((c, i) => `${i + 1}. ${c.displayText}`)
      .join('\n');

    if (language === 'he') {
      const suffix = allowMultiple ? 'אפשר לבחור כמה.' : '';
      return `מצאתי כמה אפשרויות:\n${options}\n\nאיזה התכוונת? ${suffix}`.trim();
    }

    const suffix = allowMultiple ? 'You can select multiple.' : '';
    return `I found multiple matches:\n${options}\n\nWhich one did you mean? ${suffix}`.trim();
  }

  // ========================================================================
  // CONFIRMATION/APPROVAL QUESTION (LLM-generated, warm + item-specific)
  // ========================================================================

  /** Format last few messages so the confirmation LLM can resolve "these two tasks" / "המשימות האלה" to actual names. */
  private formatRecentMessagesForConfirmation(recentMessages: MemoState['recentMessages']): string {
    if (!recentMessages?.length) return '';
    const maxMessages = 6;
    const maxContentLen = 400;
    const slice = recentMessages.slice(-maxMessages);
    const lines = slice.map(m => {
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : 'System';
      const content = m.content.length > maxContentLen ? m.content.slice(0, maxContentLen) + '…' : m.content;
      return `${role}: ${content}`;
    });
    return `## Recent conversation (use this to resolve "these two tasks" / "המשימות האלה" / "those items" to actual item names)
${lines.join('\n\n')}`;
  }

  private async generateConfirmationWithLLM(
    check: PlannerHITLCheckResult,
    state: MemoState,
  ): Promise<string> {
    const language = state.user.language;
    const userMessage = state.input.enhancedMessage || state.input.message;
    const plan = state.plannerOutput?.plan || [];

    const stepsContext = plan.map(step => ({
      capability: step.capability,
      action: step.action,
      rawMessage: step.constraints?.rawMessage || userMessage,
    }));

    const recentConversation = this.formatRecentMessagesForConfirmation(state.recentMessages);

    const userPrompt = `## User's Original Message
"${userMessage}"

${recentConversation}

## Language
${language === 'he' ? 'Hebrew (עברית) — respond in Hebrew only' : 'English — respond in English only'}

## What the system is about to do
${JSON.stringify(stepsContext, null, 2)}

## Why confirmation is needed
Reason: ${check.reason || 'high_risk'}
Details: ${check.details || 'Significant action requires confirmation'}

Generate a short, warm confirmation message:`;

    try {
      const response = await callLLM({
        messages: [
          { role: 'system', content: CONFIRMATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 150,

      });

      const message = response.content?.trim();
      if (message) return message;

      return this.getFallbackConfirmation(language);
    } catch (error) {
      console.error('[HITLGateNode] LLM confirmation failed, using fallback:', error);
      return this.getFallbackConfirmation(language);
    }
  }

  private getFallbackConfirmation(language: 'he' | 'en' | 'other'): string {
    return language === 'he'
      ? 'רק מוודאה — רוצה שאמשיך? 🙂'
      : 'Just making sure — want me to go ahead? 🙂';
  }

  // ========================================================================
  // LLM CLARIFICATION (question text only — LLM guardrail)
  // ========================================================================

  private async generateClarificationWithLLM(
    check: PlannerHITLCheckResult,
    state: MemoState,
  ): Promise<string> {
    const language = state.user.language;
    const userMessage = state.input.enhancedMessage || state.input.message;
    const isIntentUnclear = check.reason === 'intent_unclear';

    const baseSuggestions = state.routingSuggestions?.slice(0, 3) || [];
    const hasSecondBrain = baseSuggestions.some(s => s.capability === 'second-brain');
    const routingSuggestions = isIntentUnclear && !hasSecondBrain
      ? [{ resolverName: 'secondbrain_resolver', capability: 'second-brain' as const, matchedPatterns: ['save/remember'], score: 0 }, ...baseSuggestions]
      : baseSuggestions;

    const context = {
      userMessage,
      language,
      routingSuggestions,
      plannerOutput: state.plannerOutput ? {
        confidence: state.plannerOutput.confidence,
        missingFields: state.plannerOutput.missingFields,
        plan: state.plannerOutput.plan.map(p => ({
          capability: p.capability,
          action: p.action,
        })),
      } : null,
      hitlReason: check.reason,
      hitlDetails: check.details,
    };

    const intentUnclearInstruction = isIntentUnclear
      ? `\n## Mandatory for intent_unclear\nYou MUST include the option to save to memory. Use exactly: "${language === 'he' ? 'לשמור בזכרון?' : 'save to memory?'}" as one of the choices.\n`
      : '';

    const userPrompt = `## User Message
"${userMessage}"

## Language
${language === 'he' ? 'Hebrew (עברית) - respond in Hebrew only' : 'English - respond in English only'}

## Routing Suggestions
${context.routingSuggestions.length > 0
  ? JSON.stringify(context.routingSuggestions.map(s => ({
      capability: s.capability,
      matchedPatterns: s.matchedPatterns.slice(0, 3),
      score: s.score,
    })), null, 2)
  : 'No clear matches found'}

## Planner Analysis
${context.plannerOutput
  ? JSON.stringify(context.plannerOutput, null, 2)
  : 'No planner output'}

## Why Clarification Is Needed
Reason: ${check.reason || 'unclear intent'}
Details: ${check.details || 'Low confidence in understanding'}
${check.missingFields?.length ? `Missing fields: ${check.missingFields.join(', ')}` : ''}
${intentUnclearInstruction}

Generate a friendly, conversational clarification message in ${language === 'he' ? 'Hebrew' : 'English'}:`;

    try {
      const response = await callLLM({
        messages: [
          { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 200,
      });

      const clarificationMessage = response.content?.trim();
      if (clarificationMessage) {
        return clarificationMessage;
      }

      return this.getFallbackClarificationMessage(language, check);
    } catch (error) {
      console.error('[HITLGateNode] LLM clarification failed, using fallback:', error);
      return this.getFallbackClarificationMessage(language, check);
    }
  }

  private getFallbackClarificationMessage(
    language: 'he' | 'en' | 'other',
    check: PlannerHITLCheckResult,
  ): string {
    if (check.missingFields?.length) {
      const fieldDescriptions = check.missingFields.map(f => this.describeField(f, language)).join('\n• ');
      return language === 'he'
        ? `אני צריך עוד כמה פרטים:\n• ${fieldDescriptions}`
        : `I need a few more details:\n• ${fieldDescriptions}`;
    }

    return language === 'he'
      ? 'לא הצלחתי להבין בדיוק. אפשר לנסח אחרת?'
      : "I couldn't quite understand. Could you rephrase?";
  }

  // ========================================================================
  // MEMORY HELPERS (so HITL Q&A appear in recent context for planner/response)
  // ========================================================================

  /** Persist the HITL question (confirmation/clarification) so it appears in recentMessages for future context. */
  private addInterruptMessageToMemory(state: MemoState, question: string | undefined): void {
    if (!question) return;
    try {
      const memoryService = getMemoryService();
      const userPhone = state.user.phone || state.input.userPhone;
      memoryService.addAssistantMessage(userPhone, question);
    } catch (error) {
      console.error('[HITLGateNode] Error adding interrupt message to memory:', error);
    }
  }

  private addUserResponseToMemory(state: MemoState, response: string | undefined): void {
    if (!response) return;
    try {
      const memoryService = getMemoryService();
      const userPhone = state.user.phone || state.input.userPhone;
      memoryService.addUserMessage(userPhone, response, {});
    } catch (error) {
      console.error('[HITLGateNode] Error adding user response to memory:', error);
    }
  }

  // ========================================================================
  // FIELD DESCRIPTIONS
  // ========================================================================

  private describeField(field: string, language: 'he' | 'en' | 'other'): string {
    const descriptions: Record<string, Record<string, string>> = {
      reminder_time_required: {
        he: 'באיזו שעה? (תזכורת חייבת תאריך ושעה מדויקים)',
        en: 'What time? (A reminder needs a specific date and time)',
      },
      date: { he: 'תאריך', en: 'date' },
      time: { he: 'שעה', en: 'time' },
      title: { he: 'כותרת', en: 'title' },
      summary: { he: 'תיאור', en: 'description' },
      duration: { he: 'משך', en: 'duration' },
      attendees: { he: 'משתתפים', en: 'attendees' },
      category: { he: 'קטגוריה', en: 'category' },
      priority: { he: 'עדיפות', en: 'priority' },
      google_connection_required: {
        he: 'כדי להשתמש ביומן או במייל, צריך לחבר את חשבון Google שלך. שלחתי לך קישור בהודעה נפרדת 🔗',
        en: 'To use calendar or email, you need to connect your Google account. I sent you a link in a separate message 🔗',
      },
      what_to_delete: { he: 'מה בדיוק למחוק?', en: 'What exactly should I delete?' },
      target_item: { he: 'איזה פריט התכוונת?', en: 'Which item did you mean?' },
      unclear_intent: {
        he: 'לא הבנתי בדיוק מה לעשות. אפשר לנסח אחרת?',
        en: 'I didn\'t understand exactly what to do. Can you rephrase?',
      },
    };
    const lang = language === 'other' ? 'en' : language;
    return descriptions[field]?.[lang] || field;
  }

  asNodeFunction(): (state: MemoState) => Promise<Partial<MemoState> | Command> {
    return (state: MemoState) => this.process(state);
  }
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

interface PlannerHITLCheckResult {
  shouldInterrupt: boolean;
  reason?: string;
  details?: string;
  missingFields?: string[];
}

// ============================================================================
// FACTORY
// ============================================================================

export function createHITLGateNode() {
  const node = new HITLGateNode();
  return node.asNodeFunction();
}
