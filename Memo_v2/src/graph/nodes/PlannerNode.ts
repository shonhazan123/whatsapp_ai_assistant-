/**
 * PlannerNode - Central Planning Engine
 * 
 * The Planner is the brain of the system. It:
 * 1. Understands complex, multi-step user requests
 * 2. Decomposes them into executable steps
 * 3. Assigns each step to the correct capability
 * 4. Determines execution order via dependencies
 * 5. Extracts step-specific constraints
 * 6. Assesses risk and confidence levels
 * 
 * What it does:
 * - PLANS the execution by breaking down requests
 * - ROUTES steps to correct capabilities using RESOLVER SCHEMAS
 * - DECLARES dependencies between steps (for parallel/sequential execution)
 * - DETECTS ambiguity and missing information
 * - DECIDES if HITL is required
 * 
 * What it NEVER does:
 * - No specific operation selection (resolvers determine create/update/delete/etc)
 * - No schema field extraction (resolvers extract exact fields)
 * - No API calls
 * - No ID resolution
 * 
 * ✅ Uses LLM for intelligent planning
 * ✅ Uses Resolver Schemas for deterministic routing
 */

import { getNodeModel } from '../../config/llm-config.js';
import { callLLMJSON } from '../../services/llm/LLMService.js';
import type { Capability, PlannerOutput, PlanStep } from '../../types/index.js';
import { formatSchemasForPrompt, getRoutingSuggestions } from '../resolvers/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMNode } from './BaseNode.js';

// ============================================================================
// SYSTEM PROMPT - Comprehensive Planning Engine with Resolver Schemas
// ============================================================================

/**
 * Build the system prompt with resolver schemas injected
 */
function buildPlannerSystemPrompt(): string {
  // Get the resolver schemas formatted for the prompt
  const resolverSchemasSection = formatSchemasForPrompt();

  return `You are Memo's Planner (the Planning Brain).

## PERSONALITY / IDENTITY (HOW YOU THINK)
- You are a **high-precision execution planner** for a WhatsApp assistant.
- You **know all resolver capabilities** and match user requests to the correct resolver.
- You **plan safely**: prefer HITL when intent is ambiguous, risky, or under-specified.
- You do **NOT** execute tools, do **NOT** resolve IDs, and do **NOT** invent data.
- Your output must be **deterministic and router-compatible** (so code can run it).

## YOUR SPECIALTY
Convert the user request into a minimal list of steps that the system can execute:
- Choose **capability** per step (routing) - USE THE RESOLVER SCHEMAS BELOW
- Choose an **action hint** per step that matches the resolver's actionHints
- Set **dependsOn** only when a later step needs an earlier step's result
- Decide if HITL is required using **confidence** + **missingFields**

Output ONLY valid JSON that matches the schema below.

${resolverSchemasSection}

## OUTPUT SCHEMA (MUST MATCH)
{
  "intentType": "operation" | "conversation" | "meta",
  "confidence": 0.0-1.0,
  "riskLevel": "low" | "medium" | "high",
  "needsApproval": true | false,
  "missingFields": string[],
  "plan": [
    {
      "id": "A",
      "capability": "calendar" | "database" | "gmail" | "second-brain" | "general" | "meta",
      "action": string,
      "constraints": { "rawMessage": string, "extractedInfo"?: object },
      "changes": object,
      "dependsOn": string[]
    }
  ]
}

## ROUTING DECISION TREE (USE IN THIS ORDER)

### Step 1: Check for META intent first
If user asks about bot capabilities, help, or status → capability = **meta**
Patterns: "מה אתה יכול", "what can you do", "עזרה", "help"

### Step 2: Check for SECOND-BRAIN (memory storage/recall)
If user wants to SAVE a fact, contact, or key-value info, or RECALL saved information → capability = **second-brain**
Patterns: "תזכור ש", "remember that", "מה אמרתי על", "what did I save", "save contact", "phone is", "password is", "bill is", "שמור את הטלפון"
Types: notes (ideas/summaries), contacts (name+phone/email), kv facts (subject=value like bills/passwords)

### Step 3: Check for GMAIL
If user mentions email/mail operations → capability = **gmail** (if connected)
Patterns: "מייל", "email", "inbox", "שלח מייל"

### Step 4: Check for DATABASE vs CALENDAR (Critical distinction!)

**DATABASE (tasks/reminders) takes priority when:**
- User says **"remind me" / "תזכיר לי"** → capability = **database** (WhatsApp reminder)
- User says **"I'm done" / "סיימתי" / "done"** → capability = **database** (task completion)
- User mentions **"task" / "משימה" / "reminder" / "תזכורת"** explicitly
- User says **"delete reminders" / "מחק תזכורות"** → capability = **database**
- User mentions **"list" / "רשימה"** for named lists → capability = **database** (list resolver)

**CALENDAR takes priority when:**
- User mentions **time/date WITHOUT "remind me"** → capability = **calendar**
- User uses scheduling language: "schedule", "book", "תקבע", "תוסיף ליומן"
- User asks about their schedule: "מה יש לי מחר", "what do I have"

### Step 5: Fallback to GENERAL
If none of the above match → capability = **general** (conversation/advice)

## CORE PRINCIPLES

### 1) BULK rule (most important)
If user lists multiple items of the **same operation type**, it is **ONE step** (bulk). Do NOT split.
Examples: create many tasks, create many events, delete many reminders → all ONE step.

### 2) Split into multiple steps ONLY for different operations or capabilities
Examples: delete + create, find + update, calendar + database.

### 3) Dependencies (dependsOn)
Add dependency ONLY when step B needs step A's RESULT (e.g. find→act).
Do NOT add dependency when both steps can be decided from the original message (parallel is OK).

### 4) Action hints MUST match resolver actionHints
Use action hints from the RESOLVER CAPABILITIES section above. Examples:
- calendar_find_resolver: "list events", "find event", "check availability"
- calendar_mutate_resolver: "create event", "update event", "delete event"
- database_task_resolver: "create task", "create reminder", "list tasks", "complete task", "delete_all_tasks", "delete_multiple_tasks", "update_all_tasks", "update_multiple_tasks"
- database_list_resolver: "create list", "add to list" (ONLY when "list/רשימה" is mentioned)

### 5) HITL signals (missingFields)
If critical info is unclear, keep confidence low and include:
- "target_unclear" - ONLY when user says "delete the reminders/events" WITHOUT specifying EITHER:
  * Names/titles of specific items to delete, OR
  * Time window (tomorrow, next week, etc.) to search within
  * If user provides EITHER names OR time window, DO NOT use "target_unclear"
- "time_unclear" - when time is ambiguous
- "which_one" - multiple matches possible
- "intent_unclear" - CRITICAL: Use when user provides information but it's unclear WHAT ACTION they want:
  * User mentions multiple activities but no clear verb indicating what to DO with them
  * Example: "מחר יש לי אימון בשמונה, חלאקה ב10, טיול ב12" - unclear if they want calendar events, reminders, or just sharing info
  * When intent_unclear: set confidence < 0.6 and route to "general" capability

CRITICAL RULE: "target_unclear" should ONLY be used when BOTH conditions are true:
1. User wants to delete items (tasks/events/reminders)
2. User provided NEITHER specific names/titles NOR a time window to search within

Examples:
- "תמחק את האירועים של מחר" → time window exists → NO "target_unclear"
- "תמחק את הפגישה עם דני" → name exists → NO "target_unclear"
- "תמחק את התזכורות" → no names, no time window → YES "target_unclear"

### 6) Risk/approval
- riskLevel: low=create/read, medium=update, high=delete/send email/bulk delete.
- needsApproval = true for any high-risk step.

## EXAMPLES

### A) Tasks query → database_task_resolver
User: "מה המשימות שלי?"
{
  "intentType": "operation",
  "confidence": 0.95,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "list tasks",
    "constraints": { "rawMessage": "מה המשימות שלי?" },
    "changes": {},
    "dependsOn": []
  }]
}

### B) Reminder creation → database_task_resolver
User: "תזכיר לי מחר בשמונה לקנות חלב"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "create reminder",
    "constraints": { "rawMessage": "תזכיר לי מחר בשמונה לקנות חלב" },
    "changes": {},
    "dependsOn": []
  }]
}

### C) Calendar event → calendar_mutate_resolver
User: "תקבע פגישה עם דני מחר ב-10"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "calendar",
    "action": "create event",
    "constraints": { "rawMessage": "תקבע פגישה עם דני מחר ב-10" },
    "changes": {},
    "dependsOn": []
  }]
}

### D) Calendar query → calendar_find_resolver
User: "מה יש לי מחר?"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "calendar",
    "action": "list events",
    "constraints": { "rawMessage": "מה יש לי מחר?" },
    "changes": {},
    "dependsOn": []
  }]
}

### E) Memory storage (note) → secondbrain_resolver
User: "תזכור שדני אוהב פיצה"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "second-brain",
    "action": "store memory",
    "constraints": { "rawMessage": "תזכור שדני אוהב פיצה" },
    "changes": {},
    "dependsOn": []
  }]
}

### E2) Memory storage (contact) → secondbrain_resolver
User: "Jones - phone 050-1234567, email jones@email.com, HVAC contractor"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "second-brain",
    "action": "store memory",
    "constraints": { "rawMessage": "Jones - phone 050-1234567, email jones@email.com, HVAC contractor" },
    "changes": {},
    "dependsOn": []
  }]
}

### E3) Memory storage (kv) → secondbrain_resolver
User: "WiFi password is 1234"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "second-brain",
    "action": "store memory",
    "constraints": { "rawMessage": "WiFi password is 1234" },
    "changes": {},
    "dependsOn": []
  }]
}

### F) Named list → database_list_resolver
User: "תיצור רשימת קניות: חלב, לחם, ביצים"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "create list",
    "constraints": { "rawMessage": "תיצור רשימת קניות: חלב, לחם, ביצים" },
    "changes": {},
    "dependsOn": []
  }]
}

### G) Mixed ops → TWO steps
User: "תמחק את התזכורת של מחר ותזכיר לי לעשות בדיקה בחמישי"
{
  "intentType": "operation",
  "confidence": 0.8,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": [],
  "plan": [
    { "id": "A", "capability": "database", "action": "delete reminder", "constraints": { "rawMessage": "תמחק את התזכורת של מחר" }, "changes": {}, "dependsOn": [] },
    { "id": "B", "capability": "database", "action": "create reminder", "constraints": { "rawMessage": "תזכיר לי לעשות בדיקה בחמישי" }, "changes": {}, "dependsOn": [] }
  ]
}

### H) Delete ALL tasks → database_task_resolver
CRITICAL: When user says "תמחק את כולם" / "delete all" / "מחק הכל" → use "delete_all_tasks" (NOT delete_multiple_tasks)
User: "תמחק את כולם"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "delete_all_tasks",
    "constraints": { "rawMessage": "תמחק את כולם" },
    "changes": {},
    "dependsOn": []
  }]
}

### I) Delete MULTIPLE SPECIFIC tasks → database_task_resolver
CRITICAL: When user names specific tasks like "תמחק את המשימה X ואת המשימה Y" → use "delete_multiple_tasks" (NOT delete_all_tasks)
User: "תמחק את המשימה לקנות חלב ואת לנקות הבית"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "delete_multiple_tasks",
    "constraints": { "rawMessage": "תמחק את המשימה לקנות חלב ואת המשימה לנקות הבית" },
    "changes": {},
    "dependsOn": []
  }]
}

### J) Delete by TIME WINDOW → calendar_mutate_resolver or database_task_resolver
CRITICAL: When user provides a time window (tomorrow, next week, etc.), this is sufficient to identify targets. DO NOT use "target_unclear".
User: "תמחק את האירועים של מחר"
{
  "intentType": "operation",
  "confidence": 0.85,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "calendar",
    "action": "delete event",
    "constraints": {
      "rawMessage": "תמחק את האירועים של מחר",
      "extractedInfo": {
        "timeWindow": "tomorrow",
        "scope": "all events tomorrow"
      }
    },
    "changes": {},
    "dependsOn": []
  }]
}

### K) Intent unclear - user lists activities without clear action verb
CRITICAL: When user lists items/events WITHOUT saying "add to calendar", "remind me", "schedule", etc., set intent_unclear.
User: "מחר בבוקר יש לי אימון בשמונה, חלאקה לאימרי ב 10 וחצי, וב 12 טיול עם עדן"
{
  "intentType": "operation",
  "confidence": 0.5,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": ["intent_unclear"],
  "plan": [{
    "id": "A",
    "capability": "general",
    "action": "respond",
    "constraints": { "rawMessage": "מחר בבוקר יש לי אימון בשמונה, חלאקה לאימרי ב 10 וחצי, וב 12 טיול עם עדן" },
    "changes": {},
    "dependsOn": []
  }]
}

## HARD RULES
- Output ONLY JSON (no markdown, no comments).
- Always include constraints.rawMessage for every step.
- Never invent IDs.
- Match action hints to resolver actionHints from the schema above.`;
}

// Generate the prompt once at module load
const PLANNER_SYSTEM_PROMPT = buildPlannerSystemPrompt();

// ============================================================================
// PLANNER NODE
// ============================================================================

export class PlannerNode extends LLMNode {
  readonly name = 'planner';

  protected validate(state: MemoState): { valid: boolean; reason?: string } {
    if (!state.input.message && !state.input.enhancedMessage) {
      return { valid: false, reason: 'No message to plan' };
    }
    return { valid: true };
  }

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const modelConfig = getNodeModel('planner');
    const message = state.input.enhancedMessage || state.input.message;

    // Check if we're re-planning after intent_unclear HITL via canonical hitlResults
    const replanEntry = this.findReplanHITLResult(state);
    const isReplanning = !!replanEntry;

    if (isReplanning) {
      console.log(`[PlannerNode] Re-planning after intent clarification: "${replanEntry!.raw}"`);
    }

    // Get routing suggestions for disambiguation context (used by HITLGateNode)
    const routingSuggestions = getRoutingSuggestions(message);

    // Build user message with full context (includes routing suggestions and clarification if re-planning)
    const userMessage = this.buildUserMessage(state, routingSuggestions, isReplanning);

    // Make LLM call for planning
    const plannerOutput = await this.callLLM(userMessage, state, modelConfig);

    return {
      plannerOutput,
      routingSuggestions,
    };
  }

  private buildUserMessage(
    state: MemoState, 
    routingSuggestions: ReturnType<typeof getRoutingSuggestions>,
    isReplanning: boolean = false
  ): string {
    const message = state.input.enhancedMessage || state.input.message;

    let userMessage = `Current time: ${state.now.formatted}\n\n`;

    // If re-planning after intent clarification, include the clarification prominently
    if (isReplanning) {
      const clarification = this.findReplanHITLResult(state);
      if (clarification) {
        userMessage += `## INTENT CLARIFICATION (User was asked what they want to do)\n`;
        userMessage += `Original message: "${message}"\n`;
        userMessage += `User clarified they want: **${clarification.raw}**\n`;
        userMessage += `\nIMPORTANT: The user has clarified their intent. Plan accordingly with HIGH confidence.\n`;
        userMessage += `- If they said "יומן" / "calendar" / "מה יש לי" → route to calendar capability\n`;
        userMessage += `- If they said "תזכורת" / "תזכורות" / "reminder" / "reminders" / "מה יש בתזכורות" / "מה התזכורות" / "what's in my reminders" → route to **database** capability, action **list tasks**\n`;
        userMessage += `- If they said "משימות" / "tasks" and want to see them → database, action **list tasks**\n`;
        userMessage += `- If they said "לשמור בזכרון" / "save to memory" / "remember" / "שמור בזכרון" → route to second-brain capability\n`;
        userMessage += `- Otherwise interpret their response as the desired action\n\n`;
      }
    }

    // PRE-ROUTING HINTS - Pattern matching results to guide LLM
    if (routingSuggestions.length > 0) {
      userMessage += `## Pattern Matching Hints (pre-computed routing suggestions)\n`;
      userMessage += `Based on pattern analysis, these resolvers are likely matches:\n`;
      const topSuggestions = routingSuggestions.slice(0, 3);
      for (const suggestion of topSuggestions) {
        userMessage += `- **${suggestion.resolverName}** (${suggestion.capability}): score=${suggestion.score}`;
        if (suggestion.matchedPatterns.length > 0) {
          userMessage += `, matched: "${suggestion.matchedPatterns.slice(0, 3).join('", "')}"`;
        }
        userMessage += '\n';
      }
      userMessage += `\nUse these hints to inform your routing decision, but apply the decision tree rules.\n\n`;
    }

    // Recent conversation - CRITICAL for context understanding and resolving references like "it", "that", "סיימתי"
    if (state.recentMessages && state.recentMessages.length > 0) {
      userMessage += `## Recent Conversation (use to resolve references like "it", "that", "זה")\n`;
      // Provide a larger window so the Planner can understand context, not just the last input
      const recent = state.recentMessages.slice(-10);
      for (const msg of recent) {
        const preview = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content;
        userMessage += `[${msg.role}]: ${preview}\n`;
      }
      userMessage += '\n';
    }

    // Long-term context if available
    if (state.longTermSummary) {
      userMessage += `## User Context\n${state.longTermSummary}\n\n`;
    }

    // The actual user message
    userMessage += `## User Message\n${message}`;

    return userMessage;
  }

  /**
   * Find the most recent hitlResult that triggered a replan (returnTo planner+replan).
   */
  private findReplanHITLResult(state: MemoState): { raw: string; parsed: any } | null {
    if (!state.hitlResults) return null;
    const entries = Object.values(state.hitlResults);
    const replan = entries.find(e => e.returnTo?.node === 'planner' && e.returnTo?.mode === 'replan');
    return replan || null;
  }

  private async callLLM(
    userMessage: string,
    state: MemoState,
    modelConfig: { model: string; temperature?: number; maxTokens?: number }
  ): Promise<PlannerOutput> {
    try {
      const requestId = (state.input as any).requestId;

      const response = await callLLMJSON<any>({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        model: modelConfig.model,
        temperature: modelConfig.temperature || 0.3,
        maxTokens: modelConfig.maxTokens || 2500,
      }, requestId);

      // Normalize and validate response
      const normalized = this.normalizeResponse(response, state);

      // Validate response structure
      if (!normalized.intentType || !Array.isArray(normalized.plan)) {
        console.warn('[PlannerNode] Invalid LLM response structure, using fallback');
        console.warn('[PlannerNode] Response:', JSON.stringify(response).substring(0, 500));
        return this.createFallbackOutput(state.input.enhancedMessage || state.input.message, state);
      }

      // Validate and clamp confidence
      normalized.confidence = Math.max(0, Math.min(1, normalized.confidence ?? 0.7));

      // Validate riskLevel
      if (!['low', 'medium', 'high'].includes(normalized.riskLevel)) {
        normalized.riskLevel = this.inferRiskLevel(normalized.plan);
      }

      // Ensure arrays exist
      normalized.missingFields = normalized.missingFields || [];

      // Validate plan steps
      normalized.plan = this.validatePlanSteps(normalized.plan, state);

      // Safeguard: if LLM returns meta intent with empty plan, inject one step
      if (normalized.intentType === 'meta' && normalized.plan.length === 0) {
        const msg = state.input.enhancedMessage || state.input.message;
        normalized.plan = [{
          id: 'A',
          capability: 'meta',
          action: this.inferMetaAction(msg),
          constraints: { rawMessage: msg },
          changes: {},
          dependsOn: [],
        }];
        console.log(`[PlannerNode] Injected meta step (LLM returned empty plan): action=${normalized.plan[0].action}`);
      }

      console.log(`[PlannerNode] Intent: ${normalized.intentType}, Confidence: ${normalized.confidence}, Steps: ${normalized.plan.length}, Risk: ${normalized.riskLevel}`);

      return normalized as PlannerOutput;
    } catch (error: any) {
      console.error('[PlannerNode] LLM call failed:', error.message);
      return this.createFallbackOutput(state.input.enhancedMessage || state.input.message, state);
    }
  }

  /**
   * Normalize LLM response to match expected schema
   */
  private normalizeResponse(response: any, state: MemoState): any {
    const message = state.input.enhancedMessage || state.input.message;

    return {
      intentType: response.intentType || response.intent_type,
      confidence: response.confidence,
      riskLevel: response.riskLevel || response.risk_level,
      needsApproval: response.needsApproval ?? response.needs_approval ?? false,
      missingFields: response.missingFields || response.missing_fields || [],
      plan: (response.plan || []).map((step: any) => ({
        id: step.id,
        capability: step.capability,
        action: step.action || step.intent || 'process',
        constraints: {
          ...step.constraints,
          // Ensure rawMessage is always present
          rawMessage: step.constraints?.rawMessage || message,
        },
        changes: step.changes || {},
        dependsOn: step.dependsOn || step.depends_on || [],
      })),
    };
  }

  /**
   * Validate and fix plan steps
   */
  private validatePlanSteps(plan: PlanStep[], state: MemoState): PlanStep[] {
    const validCapabilities: Capability[] = ['calendar', 'database', 'gmail', 'second-brain', 'general', 'meta'];
    const message = state.input.enhancedMessage || state.input.message;

    return plan.map((step, index) => {
      // Ensure valid capability
      if (!validCapabilities.includes(step.capability)) {
        console.warn(`[PlannerNode] Invalid capability '${step.capability}', defaulting to 'general'`);
        step.capability = 'general';
      }

      // Ensure ID exists
      if (!step.id) {
        step.id = String.fromCharCode(65 + index); // A, B, C...
      }

      // Ensure rawMessage exists in constraints
      if (!step.constraints.rawMessage) {
        step.constraints.rawMessage = message;
      }

      // Ensure dependsOn is array
      if (!Array.isArray(step.dependsOn)) {
        step.dependsOn = [];
      }

      // Validate dependsOn references exist
      const validIds = plan.map(p => p.id);
      step.dependsOn = step.dependsOn.filter(depId => {
        if (!validIds.includes(depId)) {
          console.warn(`[PlannerNode] Invalid dependency '${depId}' in step ${step.id}`);
          return false;
        }
        return true;
      });

      return step;
    });
  }

  /**
   * Infer risk level from plan steps
   */
  private inferRiskLevel(plan: PlanStep[]): 'low' | 'medium' | 'high' {
    for (const step of plan) {
      const action = (step.action || '').toLowerCase();

      // High risk: delete, send email
      if (/delete|remove|cancel|מחק|בטל|הסר|send.*email|שלח.*מייל/i.test(action)) {
        return 'high';
      }

      // Medium risk: update, modify
      if (/update|modify|change|move|edit|שנה|עדכן|הזז/i.test(action)) {
        return 'medium';
      }
    }

    return 'low';
  }

  /**
   * Create fallback output when LLM fails
   */
  private createFallbackOutput(message: string, state: MemoState): PlannerOutput {
    // Meta intent — always emit one step so resolver_router can dispatch
    if (this.matchesMetaIntent(message)) {
      return {
        intentType: 'meta',
        confidence: 0.95,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'meta' as Capability,
          action: this.inferMetaAction(message),
          constraints: { rawMessage: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }

    // Greeting
    if (this.matchesGreeting(message)) {
      return {
        intentType: 'conversation',
        confidence: 0.9,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'general' as Capability,
          action: 'greeting response',
          constraints: { rawMessage: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }

    // Determine capability from keywords
    const capability = this.inferCapability(message, state);
    const riskLevel = this.inferRiskFromMessage(message);

    return {
      intentType: 'operation',
      confidence: 0.7, // Fallback has medium confidence
      riskLevel,
      needsApproval: riskLevel === 'high',
      missingFields: [],
      plan: [{
        id: 'A',
        capability,
        action: 'process request',
        constraints: { rawMessage: message },
        changes: {},
        dependsOn: [],
      }],
    };
  }

  /**
   * Infer capability from message keywords using schema-based pattern matching
   */
  private inferCapability(message: string, state: MemoState): Capability {
    // Use schema-based pattern matching first
    const suggestions = getRoutingSuggestions(message);

    if (suggestions.length > 0) {
      const best = suggestions[0];

      // Check if the capability is available
      if (best.capability === 'calendar' && !state.user.capabilities.calendar) {
        // Calendar not connected, fall back to database for time-based items
        return 'database';
      }
      if (best.capability === 'gmail' && !state.user.capabilities.gmail) {
        // Gmail not connected, fall back to general
        return 'general';
      }

      console.log(`[PlannerNode] Pattern-based capability inference: ${best.capability} (score: ${best.score})`);
      return best.capability;
    }

    // Legacy fallback patterns (in case schema matching doesn't find anything)

    // Calendar patterns
    if (/פגישה|אירוע|יומן|לוז|meeting|event|calendar|schedule|appointment/i.test(message)) {
      return state.user.capabilities.calendar ? 'calendar' : 'database';
    }

    // Email patterns
    if (/מייל|אימייל|email|mail|inbox/i.test(message)) {
      return state.user.capabilities.gmail ? 'gmail' : 'general';
    }

    // Memory patterns (remember facts, contacts, key-value info)
    if (/תזכור ש|זכור ש|שמור.*ש|שמור את הטלפון|שמור איש קשר|הסיסמא של|חשבון חשמל|remember that|save.*that|save contact|save phone|password is|bill is/i.test(message)) {
      return 'second-brain';
    }

    // Reminder/task patterns
    if (/תזכיר|תזכורת|להזכיר|משימה|רשימה|remind|reminder|task|todo|list/i.test(message)) {
      return 'database';
    }

    // Default to general
    return 'general';
  }

  /**
   * Infer risk level from message keywords
   */
  private inferRiskFromMessage(message: string): 'low' | 'medium' | 'high' {
    if (/מחק|בטל|הסר|delete|remove|cancel|שלח.*מייל|send.*mail/i.test(message)) {
      return 'high';
    }
    if (/שנה|עדכן|הזז|update|change|move|modify/i.test(message)) {
      return 'medium';
    }
    return 'low';
  }

  // Pattern matchers
  private matchesMetaIntent(message: string): boolean {
    return /what can you do|מה אתה יכול|help|עזרה|capabilities|יכולות|who are you|מי אתה|what are you|what is the website|מה האתר|מה הכתובת|my plan|what plan|תוכנית|מחיר|plan price|am i connected|google connected|מחובר לגוגל|status|סטטוס/i.test(message);
  }

  private inferMetaAction(message: string): string {
    const m = message.toLowerCase();
    if (/website|אתר|כתובת|url|link/i.test(m)) return 'website';
    if (/who are you|מי אתה|what are you|מה אתה(?! יכול)/i.test(m)) return 'about_agent';
    if (/my plan|what plan|plan price|what does.*include|תוכנית|מחיר/i.test(m)) return 'plan_info';
    if (/am i connected|google connected|מחובר/i.test(m)) return 'account_status';
    if (/status|סטטוס/i.test(m)) return 'status';
    if (/help|עזרה/i.test(m)) return 'help';
    return 'describe_capabilities';
  }

  private matchesGreeting(message: string): boolean {
    return /^(שלום|היי|הי|בוקר טוב|ערב טוב|hello|hi|hey|good morning|good evening|תודה|thanks)[\s!?]*$/i.test(message.trim());
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createPlannerNode() {
  const node = new PlannerNode();
  return node.asNodeFunction();
}

export { PLANNER_SYSTEM_PROMPT };

