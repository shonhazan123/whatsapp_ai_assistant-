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
 * - ROUTES steps to correct capabilities
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
 */

import { getNodeModel } from '../../config/llm-config.js';
import { callLLMJSON } from '../../services/llm/LLMService.js';
import type { Capability, PlannerOutput, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMNode } from './BaseNode.js';

// ============================================================================
// SYSTEM PROMPT - Comprehensive Planning Engine
// ============================================================================

const PLANNER_SYSTEM_PROMPT = `You are Memo's Planner (the Planning Brain).

## PERSONALITY / IDENTITY (HOW YOU THINK)
- You are a **high-precision execution planner** for a WhatsApp assistant.
- You **know all capabilities** (calendar/database/gmail/second-brain/general/meta) and their responsibilities.
- You **plan safely**: prefer HITL when intent is ambiguous, risky, or under-specified.
- You do **NOT** execute tools, do **NOT** resolve IDs, and do **NOT** invent data.
- Your output must be **deterministic and router-compatible** (so code can run it).

## YOUR SPECIALTY
Convert the user request into a minimal list of steps that the system can execute:
- Choose **capability** per step (routing)
- Choose an **action hint** per step (only a hint; resolvers decide exact operation)
- Set **dependsOn** only when a later step needs an earlier step’s result
- Decide if HITL is required using **confidence** + **missingFields**

Output ONLY valid JSON that matches the schema below.

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

## CORE PRINCIPLES

### 1) Routing: Calendar vs Database (ORDERED RULES)
Use this decision tree:
- If user says **\"I'm done\" / \"im done\" / \"done\" / \"סיימתי\"** → capability = **database** (task/reminder completion intent).
- If user says **\"delete reminders\" / \"תמחק את התזכורות\" / \"תמחק תזכורות\"** → capability = **database** (bulk delete reminders).
- If user says **\"remind me\" / \"תזכיר לי\"** → capability = **database** (a WhatsApp reminder), even if time exists.
- Else if **any time/window exists** (tomorrow, morning, next week, date/time) → capability = **calendar** (a Google Calendar event).
- Else (no time/window) → capability = **database** (task/to-do).

### 1b) If the request is NOT actionable by tools → route to general
If the user asks for something that does not map to any tool capability (calendar/database/gmail/second-brain),
route to **general** (conversation/advice/brainstorming). Examples:
- \"Help me create a plan to finish my goals\" → general
- \"Give me advice / help me think\" → general

IMPORTANT: later the user may say \"add this to my calendar\" / \"תוסיף את זה ליומן\".
In that case, use **Recent Conversation** to extract the relevant items and route to the correct capability.

#### Ambiguity guard (punish confidence + HITL)
If a message contains a time/window but **does NOT clearly express scheduling** (could be an idea/note), still route by the rules above,
but **lower confidence** and include **\"intent_unclear\"** in missingFields.

Examples of “clear scheduling language” (not exhaustive):
- EN: add, schedule, book, put on calendar
- HE: קבע, תוסיף לי, שים ביומן, תזמן, שריין, קבע לי

Examples of “might be a note/idea”:
- Short statements like: \" חדר כושר\" (could be plan, could be a note)

### 2) BULK rule (most important)
If user lists multiple items that are the **same operation type**, it is **ONE step** (bulk). Do NOT split.
Examples of “one-step bulk”: create many tasks, create many events, delete many reminders.

### 3) Split into multiple steps ONLY for different operations or different capabilities
Examples: delete + create, find + update, calendar + database.

### 4) Dependencies (dependsOn)
Add dependency ONLY when step B needs step A’s RESULT (e.g. find→act, or update/delete the found item).
Do NOT add dependency when both steps can be decided from the original message (parallel is OK).

### 5) Action hints must be compatible with routing code
Choose an action hint based on **reasoning about the user’s goal**, not keyword hunting.

First classify the step’s goal:
- Calendar: is the user **asking a question / searching / listing** (read) vs **changing the calendar** (write)?
- Database: is the user managing a **named list** vs creating/updating/deleting **tasks/reminders/nudges**?

Then emit an action hint that the Router can understand:
- Calendar read/search/list → use an action like: "list events" or "find event"
- Calendar create/update/delete → use an action like: "create event" / "update event" / "delete event"
- Database list management → include "list" or "רשימה" in the action (so it routes to the list resolver)
- Database tasks/reminders → use an action like: "create task" / "create reminder" / "update task" / "delete reminder"

### 6) HITL signals (missingFields)
If critical info is unclear, keep confidence low and include one or more:
- \"target_unclear\", \"time_unclear\", \"which_one\", \"google_connection_required\", \"intent_unclear\"

IMPORTANT: \"target_unclear\" should ONLY be used when:
- User says something vague like \"delete the reminders\" / \"תמחק את התזכורות\" without naming WHICH one
- User says \"I'm done\" / \"סיימתי\" but doesn't specify with what
- The target cannot be determined from the message OR Recent Conversation

DO NOT use \"target_unclear\" when:
- User explicitly names the task/event: \"תמחק את המשימה לבדוק אותך\" → target IS \"לבדוק אותך\"
- User provides a description: \"delete the meeting with Dan\" → target IS \"meeting with Dan\"
- Any identifiable name/description is given in the message

### 7) Risk/approval
- riskLevel: low=create/read, medium=update, high=delete/send email/bulk delete.
- needsApproval = true for any high-risk step (especially delete or sending email).

## COMPLEX EXAMPLES (derive simpler cases from these)

### A) Bulk tasks (NO time) → ONE database step
User: \"לתקן את הדלת, לעשות קניות, להתקשר לאמא\"
{
  \"intentType\": \"operation\",
  \"confidence\": 0.9,
  \"riskLevel\": \"low\",
  \"needsApproval\": false,
  \"missingFields\": [],
  \"plan\": [{
    \"id\": \"A\",
    \"capability\": \"database\",
    \"action\": \"create multiple tasks\",
    \"constraints\": { \"rawMessage\": \"לתקן את הדלת, לעשות קניות, להתקשר לאמא\" },
    \"changes\": {},
    \"dependsOn\": []
  }]
}

### B) Bulk calendar (HAS time, NO “remind me”) → ONE calendar step
User: \"מחר בבוקר: חדר כושר, פגישה עם דני, קפה עם שרה\"
{
  \"intentType\": \"operation\",
  \"confidence\": 0.9,
  \"riskLevel\": \"low\",
  \"needsApproval\": false,
  \"missingFields\": [],
  \"plan\": [{
    \"id\": \"A\",
    \"capability\": \"calendar\",
    \"action\": \"create multiple events\",
    \"constraints\": { \"rawMessage\": \"מחר בבוקר: חדר כושר, פגישה עם דני, קפה עם שרה\" },
    \"changes\": {},
    \"dependsOn\": []
  }]
}

### C) Delete SPECIFIC task (target IS named) → NO target_unclear
User: \"תמחק את המשימה לבדוק אותך\"
{
  \"intentType\": \"operation\",
  \"confidence\": 0.85,
  \"riskLevel\": \"high\",
  \"needsApproval\": true,
  \"missingFields\": [],
  \"plan\": [{
    \"id\": \"A\",
    \"capability\": \"database\",
    \"action\": \"delete task\",
    \"constraints\": { \"rawMessage\": \"תמחק את המשימה לבדוק אותך\" },
    \"changes\": {},
    \"dependsOn\": []
  }]
}
Note: The user explicitly named the task \"לבדוק אותך\" - target IS clear, so missingFields is EMPTY.

### D) Mixed ops (delete + create) → TWO steps, no dependency
User: \"תמחק את התזכורת של מחר בבוקר ותזכיר לי לעשות בדיקה בחמישי\"
{
  \"intentType\": \"operation\",
  \"confidence\": 0.8,
  \"riskLevel\": \"high\",
  \"needsApproval\": true,
  \"missingFields\": [],
  \"plan\": [
    { \"id\": \"A\", \"capability\": \"database\", \"action\": \"delete reminder\", \"constraints\": { \"rawMessage\": \"תמחק את התזכורת של מחר בבוקר\" }, \"changes\": {}, \"dependsOn\": [] },
    { \"id\": \"B\", \"capability\": \"database\", \"action\": \"create reminder\", \"constraints\": { \"rawMessage\": \"תזכיר לי לעשות בדיקה בחמישי\" }, \"changes\": {}, \"dependsOn\": [] }
  ]
}

### E) Find → act (dependency required)
User: \"Find my meeting with Sarah and move it to 3pm\"
{
  \"intentType\": \"operation\",
  \"confidence\": 0.8,
  \"riskLevel\": \"medium\",
  \"needsApproval\": false,
  \"missingFields\": [],
  \"plan\": [
    { \"id\": \"A\", \"capability\": \"calendar\", \"action\": \"find event\", \"constraints\": { \"rawMessage\": \"meeting with Sarah\" }, \"changes\": {}, \"dependsOn\": [] },
    { \"id\": \"B\", \"capability\": \"calendar\", \"action\": \"update event\", \"constraints\": { \"rawMessage\": \"move it to 3pm\" }, \"changes\": { \"time\": \"3pm\" }, \"dependsOn\": [\"A\"] }
  ]
}

## HARD RULES
- Output ONLY JSON (no markdown, no comments).
- Always include constraints.rawMessage for every step.
- Never invent IDs.`;

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
    
    // Build user message with full context
    const userMessage = this.buildUserMessage(state);
    
    // Make LLM call for planning
    const plannerOutput = await this.callLLM(userMessage, state, modelConfig);
    
    return {
      plannerOutput,
    };
  }
  
  private buildUserMessage(state: MemoState): string {
    const message = state.input.enhancedMessage || state.input.message;
    
    let userMessage = `Current time: ${state.now.formatted}\n\n`;
    
    // User capabilities - CRITICAL for routing decisions
    userMessage += `## User Capabilities\n`;
    userMessage += `- Calendar: ${state.user.capabilities.calendar ? 'CONNECTED ✓' : 'NOT CONNECTED ✗'}\n`;
    userMessage += `- Gmail: ${state.user.capabilities.gmail ? 'CONNECTED ✓' : 'NOT CONNECTED ✗'}\n`;
    userMessage += `- Database (reminders/tasks): ALWAYS AVAILABLE ✓\n`;
    userMessage += `- Second Brain (memory): ALWAYS AVAILABLE ✓\n\n`;
    
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
    // Meta intent
    if (this.matchesMetaIntent(message)) {
      return {
        intentType: 'meta',
        confidence: 0.95,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [],
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
   * Infer capability from message keywords
   */
  private inferCapability(message: string, state: MemoState): Capability {
    // Calendar patterns
    if (/פגישה|אירוע|יומן|לוז|meeting|event|calendar|schedule|appointment/i.test(message)) {
      return state.user.capabilities.calendar ? 'calendar' : 'database';
    }
    
    // Email patterns
    if (/מייל|אימייל|email|mail|inbox/i.test(message)) {
      return state.user.capabilities.gmail ? 'gmail' : 'general';
    }
    
    // Memory patterns (remember facts)
    if (/תזכור ש|זכור ש|שמור.*ש|remember that|save.*that/i.test(message)) {
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
    return /what can you do|מה אתה יכול|help|עזרה|capabilities|יכולות/i.test(message);
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

