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
import { traceLlmReasoningLog, traceLlmReasoningLogJSON } from '../../services/trace/traceLlmReasoningLog.js';
import { getMemoryService } from '../../services/memory/index.js';
import type { InterruptPayload, InterruptType } from '../../types/index.js';
import type { LLMStep } from '../state/MemoState.js';
import type {
  HITLExpectedInput,
  HITLInterpreterDecision,
  HITLInterpreterOutput,
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

const CLARIFICATION_SYSTEM_PROMPT = `You are Donna — a female personal assistant. Always speak as a woman (e.g. Hebrew: "אני דונה", "יכולה", "רוצה"; use feminine forms for yourself). Never use masculine forms for yourself.

From the user's message, infer whether the user is male or female when possible and address them with the correct gender (Hebrew: masculine "אתה/לך" for male, feminine "את/לך" for female; English: neutral or appropriate).

You are helping clarify an ambiguous user request.

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
- reminder_time_required: Ask at what time (and date if missing). Used for one-time or fixed-schedule reminders; repeating nudges every X minutes start immediately without this.
- target_unclear: Ask WHICH specific items (by name or time window)
- time_unclear: Ask WHEN
- intent_unclear: Ask WHAT they want to do. Offer choices based only on the Routing Suggestions (score-based); do not add a default save-to-memory option.
- which_one: Ask which specific item from options

## Output
Return ONLY the clarification message text. No JSON, no markdown, no explanations.`;

// ============================================================================
// CONFIRMATION / APPROVAL PROMPT
// ============================================================================

const CONFIRMATION_SYSTEM_PROMPT = `You are Donna — a warm, friendly female personal assistant. Always speak as a woman; never use masculine forms for yourself (e.g. Hebrew: "רוצה שאמחק", "מוודאה", "אמשיך" — NOT "מוודא").
From the user's message or context, infer whether the user is male or female when possible and address them with the correct gender (Hebrew: masculine "אתה/לך" for male, feminine "את/לך" for female).

The user already asked for this action. You are NOT asking if they want it — you are just confirming before you go ahead, like a good friend double-checking.

## Your Task
Generate a SHORT, casual confirmation message. Tone: "just making sure" — light, warm, not alarming.

## Rules
1. RESPOND ONLY in the user's language (Hebrew/English)
2. You are FEMALE — use feminine Hebrew forms for yourself: "רוצה שאמחק", "מוודאה", "אמשיך" (NOT masculine "מוודא", "אתה בטוח")
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
// INTERPRETER PROMPT (LLM-based reply classification)
// ============================================================================

const INTERPRETER_SYSTEM_PROMPT = `You are a reply classifier for a personal assistant called Donna.

You receive:
- The question Donna asked the user
- A summary of the pending operation (capability, action, current args)
- The user's reply

Your job: classify the user's reply into exactly ONE of these decisions:

## Decisions

1. **continue** — The user answered the question as expected.
   Examples:
   - Q: "Sure to delete task X?" → User: "yes" / "go ahead" / "do it" / "כן" / "בטוח" / "יאללה"
   - Q: "What time for the reminder?" → User: "3pm" / "בשלוש"
   - Q: "Which calendar?" → User: "work" / "personal"

2. **continue_with_modifications** — The user approved/answered AND added extra changes to the SAME operation.
   Examples:
   - Q: "Sure to update the event date to March 5?" → User: "Yes, and change the name to Wedding"
     → { "decision": "continue_with_modifications", "parsed": { "approved": true, "modifications": { "title": "Wedding" } } }
   - Q: "Sure to create a reminder for tomorrow?" → User: "Yes but make it at 3pm"
     → { "decision": "continue_with_modifications", "parsed": { "approved": true, "modifications": { "time": "3pm" } } }
   - Q: "Which one? 1. Meeting 2. Lunch" → User: "Pick 2 and make it recurring"
     → { "decision": "continue_with_modifications", "parsed": { "answer": "2", "modifications": { "recurring": true } } }

3. **switch_intent** — The user's reply is about a COMPLETELY DIFFERENT topic/intent, unrelated to the pending question.
   Examples:
   - Q: "Sure to delete task X?" → User: "What are my events tomorrow?" / "מה יש לי מחר?" / "Send an email to Dan"
   - Q: "What time?" → User: "Actually show me my calendar" / "מה האירועים שלי?"

4. **cancel** — The user explicitly wants to stop/cancel the pending operation.
   Examples:
   - User: "never mind" / "forget it" / "don't do it" / "cancel" / "לא רוצה" / "תשכחי מזה" / "ביטול" / "עזבי"

5. **re_ask** — The user tried to answer but the reply is unclear, partial, or does not make sense for the question.
   Examples:
   - Q: "Which event? 1. Meeting 2. Lunch" → User: "the thing" / "hmm" / "maybe"
   - Q: "Sure to delete?" → User: "what?" / "מה?" / "I don't know"

## Output format

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "decision": "<one of: continue | continue_with_modifications | switch_intent | cancel | re_ask>",
  "parsed": {
    "approved": true/false,
    "answer": "<the user's actual answer if applicable>",
    "modifications": { "<field>": "<value>" }
  }
}

- For "continue": set "parsed.approved" to true (for yes_no) or "parsed.answer" to the selection/answer.
- For "continue_with_modifications": MUST include "parsed.modifications" with semantic field names only (e.g. "title", "summary", "start", "end", "time", "date", "description", "location", "attendees", "priority", "category", "recurring"). NEVER output entity IDs, database IDs, or candidate indices.
- For "switch_intent", "cancel", "re_ask": "parsed" can be empty or omitted.

## Safety rules

- NEVER output entity IDs, eventId, taskId, or any database identifiers.
- NEVER choose disambiguation candidates on behalf of the user.
- NEVER invent fields not mentioned by the user.
- Only extract modifications the user EXPLICITLY stated.
- When in doubt between switch_intent and re_ask, prefer switch_intent if the reply looks like a new request.
- When in doubt between continue and continue_with_modifications, prefer continue if no extra changes were mentioned.`;

// Semantic fields the interpreter is allowed to suggest as modifications
const ALLOWED_MODIFICATION_FIELDS = new Set([
  'title', 'summary', 'description', 'name',
  'start', 'end', 'date', 'time', 'startDate', 'endDate', 'startTime', 'endTime',
  'location', 'attendees', 'duration',
  'priority', 'category', 'status',
  'recurring', 'recurrence', 'repeat',
  'reminder', 'reminderTime',
  'text', 'body', 'subject',
  'to', 'cc', 'bcc',
]);

// ============================================================================
// HITL GATE NODE
// ============================================================================

export class HITLGateNode {
  readonly name = 'hitl_gate';
  private _pendingLlmSteps: LLMStep[] = [];

  private _processStartTime = 0;

  async process(state: MemoState): Promise<Partial<MemoState> | Command> {
    this._processStartTime = Date.now();
    this._pendingLlmSteps = [];
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
    return this._llmStepsUpdate();
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

    const question = disambiguation.question
      || this.getDisambiguationQuestion(language, candidates, disambiguation.allowMultiple);
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
    return this._injectSteps(await this.handleResumeInline(state, pending, String(userResponse)));
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
    return this._injectSteps(await this.handleResumeInline(state, pending, String(userResponse)));
  }

  // ========================================================================
  // SHARED RESUME HANDLER (called inline after interrupt() returns)
  //
  // Three-layer processing:
  //   1. Fast path — deterministic keyword/index match (no LLM)
  //   2. LLM interpreter — semantic classification into 5 decisions
  //   3. State transitions — map decision to Command({ update, goto })
  // ========================================================================

  private async handleResumeInline(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
  ): Promise<Command> {
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

    // === LAYER 1: FAST PATH (cheapest — no LLM) ===

    // Entity disambiguation: deterministic + LLM fallback normalization
    if (pending.source === 'entity_resolution') {
      return await this.handleDisambiguationResume(state, pending, rawReply);
    }

    // Planner HITL: try fast-path first
    const fastPathResult = this.tryFastPath(rawReply, pending);
    if (fastPathResult) {
      console.log(JSON.stringify({
        event: 'HITL_FAST_PATH_MATCH',
        traceId, threadId,
        hitlId: pending.hitlId,
        decision: 'continue',
        parsed: fastPathResult.parsed,
      }));
      return await this.applyDecision(state, pending, rawReply, {
        decision: 'continue',
        parsed: { approved: fastPathResult.parsed === 'yes', answer: String(fastPathResult.parsed) },
      });
    }

    // === LAYER 2: LLM INTERPRETER ===
    const interpreterResult = await this.callInterpreter(state, pending, rawReply);

    console.log(JSON.stringify({
      event: 'HITL_INTERPRETER_RESULT',
      traceId, threadId,
      hitlId: pending.hitlId,
      decision: interpreterResult.decision,
      hasMods: !!(interpreterResult.parsed?.modifications && Object.keys(interpreterResult.parsed.modifications).length > 0),
    }));

    // === LAYER 3: STATE TRANSITIONS ===
    return await this.applyDecision(state, pending, rawReply, interpreterResult);
  }

  // ========================================================================
  // FAST PATH — deterministic yes/no and single_choice match
  // ========================================================================

  private tryFastPath(
    rawReply: string,
    pending: PendingHITL,
  ): { parsed: any } | null {
    const trimmed = rawReply.trim();
    if (!trimmed) return null;

    if (pending.expectedInput === 'yes_no') {
      const result = this.validateYesNo(trimmed);
      if (result.valid) return { parsed: result.parsed };
    }

    if (pending.expectedInput === 'single_choice') {
      const result = this.validateSingleChoiceExact(trimmed, pending);
      if (result.valid) return { parsed: result.parsed };
    }

    if (pending.expectedInput === 'multi_choice') {
      const result = this.validateMultiChoice(trimmed, pending);
      if (result.valid) return { parsed: result.parsed };
    }

    if (pending.expectedInput === 'free_text') {
      return { parsed: trimmed };
    }

    return null;
  }

  /**
   * Strict single-choice matching: only succeeds on exact index or exact option id/label.
   * Does NOT fall back to free-text (that goes to the interpreter).
   */
  private validateSingleChoiceExact(
    trimmed: string,
    pending: PendingHITL,
  ): { valid: boolean; parsed: any } {
    const optionCount = pending.options?.length || 0;

    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= optionCount) {
      return { valid: true, parsed: num };
    }

    const matchedOption = pending.options?.find(
      o => o.id === trimmed || o.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (matchedOption) {
      const idx = pending.options!.indexOf(matchedOption) + 1;
      return { valid: true, parsed: idx };
    }

    const allPatterns = ['both', 'all', 'שניהם', 'כולם'];
    if (allPatterns.includes(trimmed.toLowerCase())) {
      return { valid: true, parsed: 'all' };
    }

    return { valid: false, parsed: null };
  }

  // ========================================================================
  // ENTITY DISAMBIGUATION RESUME (deterministic only)
  // ========================================================================

  private async handleDisambiguationResume(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
  ): Promise<Command> {
    const traceId = state.traceId;
    const threadId = state.threadId;

    const validation = this.validateReply(rawReply, pending);

    // Layer 1: deterministic fast path — number or exact "all" keyword
    if (validation.valid && this.isCleanDisambiguationMatch(validation.parsed)) {
      return this.buildDisambiguationCommand(state, pending, validation.parsed, rawReply);
    }

    // Layer 2: LLM interpreter — normalize free-text to known value
    const interpreted = await this.callDisambiguationInterpreter(pending, rawReply);

    if (interpreted === null) {
      console.log(JSON.stringify({
        event: 'HITL_SWITCH_INTENT',
        traceId, threadId,
        hitlId: pending.hitlId,
        source: 'entity_disambiguation',
        rawReply,
      }));
      return this.buildSwitchIntentCommand(state, pending, rawReply);
    }

    // Normalized to number or "all"
    return this.buildDisambiguationCommand(state, pending, interpreted, rawReply);
  }

  /**
   * Returns true if parsed is a clean, normalized value that applySelection() can handle:
   * number, number[], or the canonical "all" string.
   */
  private isCleanDisambiguationMatch(parsed: any): boolean {
    if (typeof parsed === 'number') return true;
    if (Array.isArray(parsed) && parsed.every((n: any) => typeof n === 'number')) return true;
    if (parsed === 'all') return true;
    return false;
  }

  /**
   * Build Command for a successfully resolved disambiguation selection.
   */
  private buildDisambiguationCommand(
    state: MemoState,
    pending: PendingHITL,
    parsed: any,
    rawReply: string,
  ): Command {
    const disambiguationUpdate = state.disambiguation
      ? { ...state.disambiguation, userSelection: parsed, resolved: false }
      : undefined;

    const hitlResultEntry = {
      raw: rawReply,
      parsed,
      at: new Date().toISOString(),
      returnTo: pending.returnTo,
    };

    console.log(JSON.stringify({
      event: 'HITL_RESUME_VALID',
      traceId: state.traceId,
      threadId: state.threadId,
      hitlId: pending.hitlId,
      parsedResult: parsed,
      returnTo: pending.returnTo,
      goto: this.deriveGoto(pending.returnTo),
    }));

    return new Command({
      update: {
        pendingHITL: null,
        hitlResults: { ...state.hitlResults, [pending.hitlId]: hitlResultEntry },
        error: undefined,
        ...(disambiguationUpdate ? { disambiguation: disambiguationUpdate } : {}),
      } as Partial<MemoState>,
      goto: this.deriveGoto(pending.returnTo),
    });
  }

  /**
   * Lightweight LLM call to normalize free-text disambiguation replies.
   * Only fires when deterministic matching fails.
   * Returns: number (1-based), "all", or null (unrelated/new request).
   */
  private async callDisambiguationInterpreter(
    pending: PendingHITL,
    rawReply: string,
  ): Promise<number | 'all' | null> {
    const optionsList = pending.options
      ?.map((o, i) => `${i + 1}. ${o.label}`)
      .join('\n') || '';

    const systemPrompt = `You are classifying a user's reply to a numbered-options question.

The question was: "${pending.question}"
Options:
${optionsList}

The user replied: "${rawReply}"

Determine what the user meant. Return JSON:
- { "selection": <number> } if user picked a specific option (1-based)
- { "selection": "all" } if user wants ALL options
- { "selection": null } if the reply is unrelated or a new request

Return only the JSON.`;

    try {
      const { response: result, llmStep } = await traceLlmReasoningLogJSON<{ selection: number | 'all' | null }>(
        'hitl:disambiguate',
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: rawReply },
          ],
          model: 'gpt-4o-mini',
          temperature: 0.1,
          maxTokens: 50,
        },
      );
      this._pendingLlmSteps.push(llmStep);

      if (result.selection === 'all') return 'all';
      if (typeof result.selection === 'number' && result.selection >= 1) return result.selection;
      return null;
    } catch (error) {
      console.error('[HITLGateNode] Disambiguation interpreter failed:', error);
      return null;
    }
  }

  // ========================================================================
  // LLM INTERPRETER CALL
  // ========================================================================

  private async callInterpreter(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
  ): Promise<HITLInterpreterOutput> {
    const plan = state.plannerOutput?.plan || [];
    const originStep = plan.find(s => s.id === pending.originStepId) || plan[0];

    const operationSummary = originStep
      ? { capability: originStep.capability, action: originStep.action }
      : { capability: 'unknown', action: 'unknown' };

    const currentArgs = originStep
      ? { constraints: originStep.constraints, changes: originStep.changes }
      : {};

    const userPrompt = `## Donna's question to the user
"${pending.question}"

## Pending operation
${JSON.stringify(operationSummary)}

## Current args being confirmed
${JSON.stringify(currentArgs)}

## Expected input type
${pending.expectedInput}

## User's reply
"${rawReply}"

Classify this reply. Return JSON only.`;

    try {
      const { response: result, llmStep } = await traceLlmReasoningLogJSON<HITLInterpreterOutput>(
        'hitl:interpret',
        {
          messages: [
            { role: 'system', content: INTERPRETER_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          model: 'gpt-4o-mini',
          temperature: 0.1,
          maxTokens: 200,
        },
      );
      this._pendingLlmSteps.push(llmStep);

      if (!this.isValidDecision(result.decision)) {
        console.warn(`[HITLGateNode] Interpreter returned unknown decision "${result.decision}", falling back to re_ask`);
        return { decision: 're_ask' };
      }

      if (result.parsed?.modifications) {
        result.parsed.modifications = this.sanitizeModifications(result.parsed.modifications);
      }

      return result;
    } catch (error) {
      console.error('[HITLGateNode] Interpreter LLM call failed, falling back to re_ask:', error);
      return { decision: 're_ask' };
    }
  }

  private isValidDecision(d: string): d is HITLInterpreterDecision {
    return ['continue', 're_ask', 'switch_intent', 'cancel', 'continue_with_modifications'].includes(d);
  }

  /**
   * Strip any keys that look like entity IDs or are not in the semantic allowlist.
   */
  private sanitizeModifications(mods: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mods)) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.endsWith('id') || lowerKey === 'id') continue;
      if (!ALLOWED_MODIFICATION_FIELDS.has(key)) continue;
      sanitized[key] = value;
    }
    return sanitized;
  }

  // ========================================================================
  // STATE TRANSITION LAYER — maps interpreter decision to Command
  // ========================================================================

  private async applyDecision(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
    interpreterResult: HITLInterpreterOutput,
  ): Promise<Command> {
    const traceId = state.traceId;
    const threadId = state.threadId;
    const language = state.user.language;

    switch (interpreterResult.decision) {
      // ── CONTINUE ────────────────────────────────────────────────
      case 'continue': {
        const parsed = interpreterResult.parsed?.answer
          ?? interpreterResult.parsed?.approved
          ?? rawReply.trim();

        const normalizedParsed = this.normalizeApprovalParsed(parsed, pending);

        const hitlResultEntry = {
          raw: rawReply,
          parsed: normalizedParsed,
          at: new Date().toISOString(),
          returnTo: pending.returnTo,
          interpreted: interpreterResult,
        };

        console.log(JSON.stringify({
          event: 'HITL_RESUME_VALID',
          traceId, threadId,
          hitlId: pending.hitlId,
          parsedResult: normalizedParsed,
          returnTo: pending.returnTo,
          goto: this.deriveGoto(pending.returnTo),
        }));

        return new Command({
          update: {
            pendingHITL: null,
            hitlResults: { ...state.hitlResults, [pending.hitlId]: hitlResultEntry },
            error: undefined,
          } as Partial<MemoState>,
          goto: this.deriveGoto(pending.returnTo),
        });
      }

      // ── CONTINUE WITH MODIFICATIONS ─────────────────────────────
      case 'continue_with_modifications': {
        const modifications = interpreterResult.parsed?.modifications || {};
        if (Object.keys(modifications).length === 0) {
          console.warn(`[HITLGateNode] continue_with_modifications but no modifications found, treating as continue`);
          return await this.applyDecision(state, pending, rawReply, { decision: 'continue', parsed: interpreterResult.parsed });
        }

        const hitlResultEntry = {
          raw: rawReply,
          parsed: 'yes',
          at: new Date().toISOString(),
          returnTo: pending.returnTo,
          interpreted: interpreterResult,
        };

        const updatedPlannerOutput = this.mergePlanModifications(state, pending, modifications);

        const clearedResolverResults = new Map(state.resolverResults);
        clearedResolverResults.delete(pending.originStepId);
        const clearedExecutorArgs = new Map(state.executorArgs);
        clearedExecutorArgs.delete(pending.originStepId);

        console.log(JSON.stringify({
          event: 'HITL_CONTINUE_WITH_MODIFICATIONS',
          traceId, threadId,
          hitlId: pending.hitlId,
          modifications,
          originStepId: pending.originStepId,
        }));

        return new Command({
          update: {
            pendingHITL: null,
            hitlResults: { ...state.hitlResults, [pending.hitlId]: hitlResultEntry },
            plannerOutput: updatedPlannerOutput,
            resolverResults: clearedResolverResults,
            executorArgs: clearedExecutorArgs,
            error: undefined,
          } as Partial<MemoState>,
          goto: 'resolver_router',
        });
      }

      // ── SWITCH INTENT ───────────────────────────────────────────
      case 'switch_intent': {
        console.log(JSON.stringify({
          event: 'HITL_SWITCH_INTENT',
          traceId, threadId,
          hitlId: pending.hitlId,
          rawReply,
        }));

        return this.buildSwitchIntentCommand(state, pending, rawReply);
      }

      // ── CANCEL ──────────────────────────────────────────────────
      case 'cancel': {
        const cancelMessage = language === 'he'
          ? 'ביטלתי. 👍'
          : 'Cancelled. 👍';

        console.log(JSON.stringify({
          event: 'HITL_CANCELLED',
          traceId, threadId,
          hitlId: pending.hitlId,
        }));

        return new Command({
          update: {
            pendingHITL: null,
            finalResponse: cancelMessage,
            error: undefined,
          } as Partial<MemoState>,
          goto: 'response_writer',
        });
      }

      // ── RE-ASK ──────────────────────────────────────────────────
      case 're_ask': {
        console.log(JSON.stringify({
          event: 'HITL_RE_ASK',
          traceId, threadId,
          hitlId: pending.hitlId,
          rawReply,
        }));

        const reAskQuestion = this.buildReAskQuestion(pending, language);
        this.addInterruptMessageToMemory(state, reAskQuestion);

        const reAskPending: PendingHITL = {
          ...pending,
          question: reAskQuestion,
        };

        const payload = this.buildInterruptPayloadFromPending(reAskPending, state);
        const nextReply = interrupt(payload);

        return await this.handleResumeInline(state, reAskPending, String(nextReply));
      }

      default: {
        console.warn(`[HITLGateNode] Unexpected decision "${interpreterResult.decision}", treating as switch_intent`);
        return this.buildSwitchIntentCommand(state, pending, rawReply);
      }
    }
  }

  // ========================================================================
  // HELPER: Normalize approval parsed value for downstream compatibility
  // ========================================================================

  private normalizeApprovalParsed(parsed: any, pending: PendingHITL): any {
    if (pending.expectedInput === 'yes_no') {
      if (parsed === true || parsed === 'true') return 'yes';
      if (parsed === false || parsed === 'false') return 'no';
    }
    return parsed;
  }

  // ========================================================================
  // HELPER: Build switch-intent Command (shared by disambiguation + interpreter)
  // ========================================================================

  private buildSwitchIntentCommand(
    state: MemoState,
    pending: PendingHITL,
    rawReply: string,
  ): Command {
    const newInput = {
      ...state.input,
      message: rawReply,
      enhancedMessage: rawReply,
    };
    const hitlExchange: MemoState['recentMessages'] = [
      { role: 'assistant', content: pending.question, timestamp: new Date().toISOString() },
      { role: 'user', content: rawReply, timestamp: new Date().toISOString() },
    ];
    const mergedRecent = [...state.recentMessages, ...hitlExchange].slice(-20);

    return new Command({
      update: {
        pendingHITL: null,
        input: newInput,
        recentMessages: mergedRecent,
        plannerOutput: undefined,
      } as Partial<MemoState>,
      goto: 'planner',
    });
  }

  // ========================================================================
  // HELPER: Merge modifications into the plan step
  // ========================================================================

  private mergePlanModifications(
    state: MemoState,
    pending: PendingHITL,
    modifications: Record<string, unknown>,
  ): MemoState['plannerOutput'] {
    if (!state.plannerOutput) return state.plannerOutput;

    const updatedPlan = state.plannerOutput.plan.map(step => {
      if (step.id !== pending.originStepId) return step;
      return {
        ...step,
        constraints: { ...step.constraints, ...modifications },
        changes: { ...step.changes, ...modifications },
      };
    });

    return { ...state.plannerOutput, plan: updatedPlan };
  }

  // ========================================================================
  // HELPER: Build re-ask question (gentle nudge, same context)
  // ========================================================================

  private buildReAskQuestion(pending: PendingHITL, language: MemoState['user']['language']): string {
    if (pending.expectedInput === 'yes_no') {
      return language === 'he'
        ? `לא הצלחתי להבין — כן או לא? 🙂\n\n${pending.question}`
        : `I didn't quite catch that — yes or no? 🙂\n\n${pending.question}`;
    }
    if (pending.expectedInput === 'single_choice' || pending.expectedInput === 'multi_choice') {
      return language === 'he'
        ? `לא הצלחתי להבין את הבחירה — אפשר לבחור מהרשימה?\n\n${pending.question}`
        : `I didn't catch your choice — could you pick from the list?\n\n${pending.question}`;
    }
    return language === 'he'
      ? `לא הצלחתי להבין. אפשר לנסח אחרת?\n\n${pending.question}`
      : `I didn't quite understand. Could you rephrase?\n\n${pending.question}`;
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

    // "both"/"all" → normalize to canonical "all"
    const allPatterns = ['both', 'all', 'שניהם', 'כולם'];
    if (allPatterns.includes(trimmed.toLowerCase())) {
      return { valid: true, parsed: 'all' };
    }

    // No deterministic match — return invalid so LLM layer is invoked
    return { valid: false, parsed: null };
  }

  private validateMultiChoice(
    trimmed: string,
    pending: PendingHITL,
  ): { valid: boolean; parsed: any } {
    const optionCount = pending.options?.length || 0;

    // "both"/"all" → normalize to canonical "all"
    const allPatterns = ['both', 'all', 'שניהם', 'כולם'];
    if (allPatterns.includes(trimmed.toLowerCase())) {
      return { valid: true, parsed: 'all' };
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

    // No deterministic match — return invalid so LLM layer is invoked
    return { valid: false, parsed: null };
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
        reason: pending.reason,
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
      const { response, llmStep } = await traceLlmReasoningLog(
        'hitl:confirm',
        {
          messages: [
            { role: 'system', content: CONFIRMATION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 150,
        },
      );
      this._pendingLlmSteps.push(llmStep);

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

    const routingSuggestions = state.routingSuggestions?.slice(0, 3) || [];

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

Generate a friendly, conversational clarification message in ${language === 'he' ? 'Hebrew' : 'English'}:`;

    try {
      const { response, llmStep } = await traceLlmReasoningLog(
        'hitl:clarify',
        {
          messages: [
            { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 200,
        },
      );
      this._pendingLlmSteps.push(llmStep);

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

  private _buildNodeTiming(): { nodeExecutions: Array<{ node: string; startTime: number; endTime: number; durationMs: number }> } {
    const endTime = Date.now();
    return { nodeExecutions: [{ node: this.name, startTime: this._processStartTime, endTime, durationMs: endTime - this._processStartTime }] };
  }

  /** Return partial state with accumulated llmSteps + node timing. */
  private _llmStepsUpdate(): Partial<MemoState> {
    const update: Partial<MemoState> = { metadata: this._buildNodeTiming() as any };
    if (this._pendingLlmSteps.length > 0) {
      update.llmSteps = this._pendingLlmSteps;
    }
    return update;
  }

  /** Inject accumulated llmSteps + node timing into a Command's update payload. */
  private _injectSteps(cmd: Command): Command {
    const raw = cmd as any;
    if (raw.update === undefined && raw.goto === undefined) {
      console.warn('[HITLGateNode] Command structure unexpected — llmSteps may be lost. Check LangGraph version compatibility.');
    }
    const update = raw.update || {};
    const injected: Partial<MemoState> = {
      ...update,
      metadata: this._buildNodeTiming() as any,
    };
    if (this._pendingLlmSteps.length > 0) {
      injected.llmSteps = this._pendingLlmSteps;
    }
    return new Command({ ...raw, update: injected });
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
