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
      "capability": "calendar" | "database" | "gmail" | "second-brain" | "general",
      "action": string,
      "constraints": { "rawMessage": string, "extractedInfo"?: object },
      "changes": object,
      "dependsOn": string[]
    }
  ]
}

## ROUTING DECISION TREE (USE IN THIS ORDER)

### Step 1: Check for agent/user-info intent (→ general)
If user asks about bot capabilities, help, or status → capability = **general**
Patterns: "מה אתה יכול", "what can you do", "עזרה", "help"
Action hints: describe_capabilities, what_can_you_do, help, status, website, about_agent, plan_info, account_status

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
Route to **general** when the user asks about **themselves** (name, account), about **what the assistant did** (last/recent actions, "did you create X?"), or sends **acknowledgments** (thank you, okay). If none of the above capabilities match and the message fits this scope → capability = **general**. General is NOT for general knowledge or open-ended advice.

## CORE PRINCIPLES

### 1) BULK rule (most important)
If user lists multiple items of the **same operation type**, it is **ONE step** (bulk). Do NOT split.
Examples: create many tasks, create many events, delete many reminders → all ONE step.

### 2) Multiple steps ONLY when capability OR action differs (logic rule)
- **ALLOW** multiple steps when: (a) different capabilities (e.g. calendar + database), or (b) same capability but **different** actions (e.g. database create_multiple + database delete).
- **FORBIDDEN** multiple steps with the **same** capability AND the **same** action.
  - WRONG: A database create_reminder, B database create_reminder. (Same cap + same action → merge into ONE step.)
  - WRONG: A calendar create event, B calendar create event. (Same cap + same action → ONE step.)
  - CORRECT: A database create_reminder (all items in one step). Resolver will use createMultiple.
  - CORRECT: A database create_reminder, B database delete_all_tasks. (Same capability, different actions.)
  - CORRECT: A calendar create event, B database create reminder. (Different capabilities.)

### 3) Dependencies (dependsOn)
Add dependency ONLY when step B needs step A's RESULT (e.g. find→act).
Do NOT add dependency when both steps can be decided from the original message (parallel is OK).

### 4) Action hints MUST match resolver actionHints + Reminder vs Task
Use action hints from the RESOLVER CAPABILITIES section above. Examples:
- calendar_find_resolver: "list events", "find event", "check availability"
- calendar_mutate_resolver: "create event", "update event", "delete event"
- database_task_resolver: "create task", "create reminder", "list tasks", "complete task", "delete_all_tasks", "delete_multiple_tasks", "update_all_tasks", "update_multiple_tasks"
- database_list_resolver: "create list", "add to list" (ONLY when "list/רשימה" is mentioned)
- general_resolver: "respond", "greet", "acknowledge", "ask_about_recent_actions", "ask_about_user", "ask_about_what_i_did", "describe_capabilities", "what_can_you_do", "help", "status", "website", "about_agent", "plan_info", "account_status" (user/account + agent/help/plan; use Latest Actions section for recent-actions questions)

**Reminder vs Task (database):**
- **create reminder** = user wants to be notified at a specific date+time ("תזכיר לי מחר בשמונה", "remind me at 5pm"). Requires BOTH date AND time; if either is missing → missingFields: ["reminder_time_required"].
- **create task** = user lists things to do with NO time (e.g. "משימות שאני צריך לעשות", "להתקשר לבנק", "לקבוע עם אמא פגישה", "תוסיפי משימה X"). No time required; do NOT set missingFields for time.
- If user said "תזכיר לי היום X" or "תזכיר לי מחר X" but did not give a time → action "create reminder" + missingFields: ["reminder_time_required"].

### 5) HITL signals (missingFields)
If critical info is unclear, keep confidence low and include:
- "reminder_time_required" - **CRITICAL for reminders**: A REMINDER must have BOTH a specific date AND a specific time. Use when:
  * User said "תזכיר לי" / "remind me" and gave a day/date (e.g. היום, מחר, ברביעי) but did NOT specify a time → set missingFields: ["reminder_time_required"].
  * User said "תזכיר לי" / "remind me" with no date and no time at all → set missingFields: ["reminder_time_required"].
  * Do NOT use "create reminder" when the user has no time at all and is just listing things to do; use "create task" instead (see Reminder vs Task below).
- "target_unclear" - ONLY when user says "delete the reminders/events" WITHOUT specifying EITHER:
  * Names/titles of specific items to delete, OR
  * Time window (tomorrow, next week, etc.) to search within
  * If user provides EITHER names OR time window, DO NOT use "target_unclear"
- "time_unclear" - when time is ambiguous (non-reminder cases)
- "which_one" - multiple matches possible
- "intent_unclear" - CRITICAL: Use when user provides information but it's unclear WHAT ACTION they want:
  * User mentions multiple activities but no clear verb indicating what to DO with them
  * Example: "מחר יש לי אימון בשמונה, חלאקה ב10, טיול ב12" - unclear if they want calendar events, reminders, or just sharing info
  * When intent_unclear: set confidence < 0.6 and missingFields: ["intent_unclear"]

CRITICAL RULE: "target_unclear" should ONLY be used when BOTH conditions are true:
1. User wants to delete items (tasks/events/reminders)
2. User provided NEITHER specific names/titles NOR a time window to search within

Examples:
- "תמחק את האירועים של מחר" → time window exists → NO "target_unclear"
- "תמחק את הפגישה עם דני" → name exists → NO "target_unclear"
- "תמחק את התזכורות" → no names, no time window → YES "target_unclear"

### 6) Referential language ("it/that/this/זה/אותו/אותה/גם/also/that too")
When the user's message uses referential language (e.g., "תכניסי לי את זה גם ליומן", "move it to 5pm", "delete it", "גם אותו הדבר") and does NOT explicitly name a target:
- Check the **Latest Actions** section in the user context. The **first item** (most recent) is the strongest candidate.
- The user's message tells you WHAT TO DO with the referent (e.g., "גם ליומן" = also add to calendar, "תזיזי" = move/update, "תמחקי" = delete).
- Use the referent's summary/when/capability to build the plan step with HIGH confidence.
- If the most-recent action doesn't fit, try the 2nd or 3rd action.
- ONLY set "intent_unclear" + confidence < 0.6 when:
  * Latest Actions is empty, OR
  * None of the latest actions are plausible referents, OR
  * The desired action itself is genuinely ambiguous (not just referential)
- NEVER create a brand-new entity from thin air when the user is clearly referring to a prior action.
- For "what did you do?" / "what did I ask you to create?" / "did you create the last mission?" type questions, use the **Latest Actions** section in context and route to **general** with action hint e.g. ask_about_recent_actions.

### 7) Risk/approval
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

### B) Reminder creation (date + time) → database_task_resolver
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

### B2) Reminder with day but NO time → missingFields, HITL
User said "תזכיר לי" with a day (היום/מחר/יום X) but did not specify WHEN. Reminder requires exact date+time.
User: "תזכיר לי היום לצאת לחתונה"
{
  "intentType": "operation",
  "confidence": 0.85,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": ["reminder_time_required"],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "create reminder",
    "constraints": { "rawMessage": "תזכיר לי היום לצאת לחתונה" },
    "changes": {},
    "dependsOn": []
  }]
}

### B3) Task without time (no reminder wording) → database_task_resolver, create task
User lists things to do with no time. Use "create task", not "create reminder". No missingFields.
User: "תוסיפי משימה להתקשר לבנק" or "משימות: להתקשר לבנק, לקבוע עם אמא פגישה"
{
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "create task",
    "constraints": { "rawMessage": "תוסיפי משימה להתקשר לבנק" },
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

### G) Mixed ops → TWO steps (step B has day but no time → missingFields)
User: "תמחק את התזכורת של מחר ותזכיר לי לעשות בדיקה בחמישי"
{
  "intentType": "operation",
  "confidence": 0.8,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": ["reminder_time_required"],
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

### L) Referential follow-up → use Latest Actions
User previously created a reminder "לקנות חלב מחר ב-8". Now user says: "תכניסי לי את זה גם ליומן"
Latest Actions shows: [database] create reminder: "לקנות חלב" | 2026-02-24T08:00
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
    "constraints": { "rawMessage": "תכניסי לי את זה גם ליומן", "extractedInfo": { "summary": "לקנות חלב", "when": "2026-02-24T08:00", "source": "latestAction_reference" } },
    "changes": {},
    "dependsOn": []
  }]
}

### M) Ask about what assistant did → general
User: "Did you create the last mission?" or "What are the recent things you created?"
{
  "intentType": "conversation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "general",
    "action": "ask_about_recent_actions",
    "constraints": { "rawMessage": "Did you create the last mission?" },
    "changes": {},
    "dependsOn": []
  }]
}

### N) Ask about user (name, self) → general
User: "What's my name?" or "מה השם שלי?"
{
  "intentType": "conversation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "general",
    "action": "ask_about_user",
    "constraints": { "rawMessage": "What's my name?" },
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
      userMessage += `The user may refer in their last message to previous context (events, details, dates, etc.). If the message is ambiguous, try to match it with details from these interactions.\n\n`;
      // Provide a larger window so the Planner can understand context, not just the last input
      const recent = state.recentMessages.slice(-10);
      for (const msg of recent) {
        const preview = msg.content.length > 350 ? msg.content.substring(0, 350) + '...' : msg.content;
        userMessage += `[${msg.role}]: ${preview}\n`;
      }
      userMessage += '\n';
    }

    // Latest executed actions (most-recent first) - for resolving "it/that/זה" references
    if (state.latestActions && state.latestActions.length > 0) {
      userMessage += `## Latest Actions (most-recent first)\n`;
      for (const action of state.latestActions) {
        const whenPart = action.when ? ` | ${action.when}` : '';
        userMessage += `- [${action.capability}] ${action.action}: "${action.summary}"${whenPart}\n`;
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

      // Merge any duplicate (capability, action) steps into one — never allow A database create, B database create
      normalized.plan = this.mergeDuplicateCapabilityActionSteps(normalized.plan, state);

      // Safeguard: if LLM returns meta intent with empty plan, inject one step (general capability)
      if (normalized.intentType === 'meta' && normalized.plan.length === 0) {
        const msg = state.input.enhancedMessage || state.input.message;
        normalized.plan = [{
          id: 'A',
          capability: 'general',
          action: this.inferMetaAction(msg),
          constraints: { rawMessage: msg },
          changes: {},
          dependsOn: [],
        }];
        console.log(`[PlannerNode] Injected general step (meta intent, empty plan): action=${normalized.plan[0].action}`);
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
    const validCapabilities: Capability[] = ['calendar', 'database', 'gmail', 'second-brain', 'general'];
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
   * Merge steps that share the same (capability, action) into a single step.
   * Multiple steps are only valid when capability differs or same capability but different action
   * (e.g. calendar + database, or database create + database delete).
   * Never allow: A database create_reminder, B database create_reminder.
   */
  private mergeDuplicateCapabilityActionSteps(plan: PlanStep[], state: MemoState): PlanStep[] {
    if (plan.length <= 1) return plan;

    const message = state.input.enhancedMessage || state.input.message;

    const actionKey = (step: PlanStep) =>
      `${step.capability}:${(step.action || '').toLowerCase().replace(/\s+/g, '_').trim()}`;

    const groups = new Map<string, PlanStep[]>();
    for (const step of plan) {
      const key = actionKey(step);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(step);
    }

    const merged: PlanStep[] = [];
    const oldIdToKeptId = new Map<string, string>();

    for (const [, steps] of groups) {
      const first = steps[0];
      if (steps.length === 1) {
        merged.push({ ...first });
        oldIdToKeptId.set(first.id, first.id);
        continue;
      }
      // Merge: keep one step with full message so resolver sees entire request (e.g. createMultiple)
      const representative: PlanStep = {
        id: first.id,
        capability: first.capability,
        action: first.action,
        constraints: { ...first.constraints, rawMessage: message },
        changes: first.changes || {},
        dependsOn: [],
      };
      merged.push(representative);
      for (const s of steps) oldIdToKeptId.set(s.id, first.id);
      console.log(
        `[PlannerNode] Merged ${steps.length} steps (${first.capability}/${first.action}) into one; was: ${steps.map(s => s.id).join(', ')}`
      );
    }

    // Reassign sequential ids A, B, C, ... and fix dependsOn
    const keptIdToNewId = new Map<string, string>();
    merged.forEach((step, i) => {
      const newId = String.fromCharCode(65 + i);
      keptIdToNewId.set(step.id, newId);
      step.id = newId;
    });

    for (const step of merged) {
      const newDeps = new Set<string>();
      for (const oldDep of step.dependsOn || []) {
        const kept = oldIdToKeptId.get(oldDep) ?? oldDep;
        const newId = keptIdToNewId.get(kept) ?? kept;
        if (merged.some(s => s.id === newId)) newDeps.add(newId);
      }
      step.dependsOn = Array.from(newDeps);
    }

    return merged;
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
    // Meta intent (agent/help/plan) — route to general capability
    if (this.matchesMetaIntent(message)) {
      return {
        intentType: 'meta',
        confidence: 0.95,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'general' as Capability,
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

