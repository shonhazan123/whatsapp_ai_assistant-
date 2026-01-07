/**
 * PlannerNode - Central reasoning node
 * 
 * Converts natural language → execution intent (Plan DSL)
 * 
 * What it does well:
 * - Detects ambiguity
 * - Breaks multi-intent requests into steps
 * - Declares dependencies between steps
 * - Decides if HITL is required
 * - Separates WHAT from HOW
 * 
 * What it NEVER does:
 * - No tool calls
 * - No schema selection
 * - No API args
 * - No guessing execution success
 * 
 * ✅ Uses LLM
 */

import { getNodeModel } from '../../config/llm-config.js';
import { callLLMJSON } from '../../services/llm/LLMService.js';
import type { Capability, PlannerOutput } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMNode } from './BaseNode.js';

// ============================================================================
// SYSTEM PROMPT - Comprehensive with exact field specifications
// ============================================================================

const PLANNER_SYSTEM_PROMPT = `You are Memo's Planner. Your job is to understand user intent and create an execution plan.

## OUTPUT FORMAT
You MUST respond with ONLY valid JSON using camelCase field names:

{
  "intentType": "operation" | "conversation" | "meta",
  "confidence": 0.0-1.0,
  "riskLevel": "low" | "medium" | "high",
  "needsApproval": true | false,
  "missingFields": ["field1", "field2"],
  "plan": [
    {
      "id": "A",
      "capability": "database",
      "action": "create_task",
      "constraints": { "text": "what user said" },
      "changes": {},
      "dependsOn": []
    }
  ]
}

## FIELD DESCRIPTIONS AND CALCULATION RULES

### intentType (REQUIRED)
- "operation": User wants to DO something (create, update, delete, search)
- "conversation": User wants to CHAT (greetings, questions, advice)
- "meta": User asks WHAT you can do ("מה אתה יכול?", "help")

### confidence (REQUIRED, 0.0-1.0)
Calculate based on clarity:
- 0.9-1.0: All info present, clear intent (e.g., "תזכיר לי מחר ב-8 לקנות חלב")
- 0.7-0.89: Minor details missing but intent clear (e.g., "תזכיר לי לקנות חלב" - no time)
- 0.5-0.69: Intent unclear, multiple interpretations (e.g., "תמחק את זה" - what is "it"?)
- <0.5: Cannot determine intent at all

⚠️ CRITICAL: If confidence < 0.7, add missing info to missingFields array.

### riskLevel (REQUIRED)
- "low": Read-only, create new items
- "medium": Update existing items
- "high": Delete items, bulk operations, irreversible actions

### needsApproval (REQUIRED)
Set to true if:
- riskLevel is "high"
- Bulk operation (affects multiple items)
- Involves sending email

### missingFields (REQUIRED, array)
List what's missing when confidence < 0.7:
- "what_to_delete" - if delete action but target unclear
- "time" - if reminder/event but no time specified
- "date" - if date is unclear
- "target_item" - if update/delete but which item is unclear
- "google_connection_required" - if calendar/gmail needed but user not connected

### plan (REQUIRED, array of steps)
Each step has:
- id: Single letter "A", "B", "C"...
- capability: MUST be one of: "calendar", "database", "gmail", "second-brain", "general", "meta"
- action: MUST match resolver actions (see list below)
- constraints: What user mentioned (search criteria)
- changes: What to modify (new values)
- dependsOn: Array of step IDs this depends on (e.g., ["A"] if B needs result of A)

## VALID ACTIONS BY CAPABILITY

### calendar (requires Google connection)
- find_event: Search for events
- list_events: List events in date range
- create_event: Create calendar event
- update_event: Modify existing event
- delete_event: Remove event

### database (always available)
- create_task: Create reminder/task (use for: תזכורת, משימה, תזכיר לי)
- list_tasks: Show tasks/reminders
- update_task: Modify task
- delete_task: Remove task
- complete_task: Mark as done

### gmail (requires Google connection)
- list_emails: Search/list emails
- get_email: Get specific email
- send_email: Compose and send email
- reply_email: Reply to email

### second-brain (always available)
- store_memory: Save note/information
- search_memory: Find saved info
- update_memory: Modify saved info
- delete_memory: Remove saved info

### general (always available)
- respond: Conversational response (greetings, questions, chitchat)

### meta (always available)
- describe_capabilities: Explain what Memo can do

## HEBREW PATTERN RECOGNITION

### Reminders/Tasks (→ database)
- "תזכיר לי" / "תזכורת" / "להזכיר" → create_task
- "כל יום/בוקר/ערב ב..." → create_task with recurring
- "כל X דקות/שעות" → create_task with nudge
- "מחק/בטל/הסר תזכורת" → delete_task
- "מה התזכורות שלי" / "מה יש לי" → list_tasks
- "סמן כבוצע" / "עשיתי" → complete_task

### Calendar (→ calendar, check connection first!)
- "פגישה" / "אירוע" / "meeting" → calendar operations
- "מה יש ביומן" / "לוח הזמנים" → list_events
- "קבע פגישה" / "schedule" → create_event

### Memory (→ second-brain)
- "תזכור ש..." / "זכור ש..." / "שמור" → store_memory
- "מה אמרתי על..." / "מה שמרתי" → search_memory

### General conversation (→ general)
- "שלום" / "היי" / "מה שלומך" → respond
- "תודה" / "מעולה" → respond

## HANDLING UNAVAILABLE CAPABILITIES

If user requests calendar/gmail but capabilities show "not connected":
1. Set confidence to 0.6
2. Add "google_connection_required" to missingFields
3. Set capability to what they need anyway (calendar/gmail)

This will trigger HITL to inform user they need to connect Google.

## EXAMPLES

### Example 1: Daily recurring reminder (Hebrew)
User: "תעשה לי תזכורת כל בוקר ב-8 לקחת ויטמינים"
→ {
  "intentType": "operation",
  "confidence": 0.95,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "create_task",
    "constraints": { "text": "לקחת ויטמינים", "recurring": "daily", "time": "08:00" },
    "changes": {},
    "dependsOn": []
  }]
}

### Example 2: Ambiguous delete
User: "תמחק את זה"
→ {
  "intentType": "operation",
  "confidence": 0.4,
  "riskLevel": "high",
  "needsApproval": true,
  "missingFields": ["what_to_delete", "target_item"],
  "plan": [{
    "id": "A",
    "capability": "database",
    "action": "delete_task",
    "constraints": {},
    "changes": {},
    "dependsOn": []
  }]
}

### Example 3: Calendar query (user connected)
User capabilities: Calendar: connected
User: "מה יש לי מחר?"
→ {
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "calendar",
    "action": "list_events",
    "constraints": { "date": "tomorrow" },
    "changes": {},
    "dependsOn": []
  }]
}

### Example 4: Calendar but not connected
User capabilities: Calendar: not connected
User: "מה יש לי מחר ביומן?"
→ {
  "intentType": "operation",
  "confidence": 0.6,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": ["google_connection_required"],
  "plan": [{
    "id": "A",
    "capability": "calendar",
    "action": "list_events",
    "constraints": { "date": "tomorrow" },
    "changes": {},
    "dependsOn": []
  }]
}

### Example 5: Multi-step with dependency
User: "קבע לי פגישה עם דני מחר ב-10 ותזכיר לי שעה לפני"
→ {
  "intentType": "operation",
  "confidence": 0.9,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [
    {
      "id": "A",
      "capability": "calendar",
      "action": "create_event",
      "constraints": { "summary": "פגישה עם דני", "date": "tomorrow", "time": "10:00" },
      "changes": {},
      "dependsOn": []
    },
    {
      "id": "B",
      "capability": "database",
      "action": "create_task",
      "constraints": { "text": "פגישה עם דני", "reminderBefore": "1 hour" },
      "changes": {},
      "dependsOn": ["A"]
    }
  ]
}

### Example 6: Greeting (conversation)
User: "היי מה קורה?"
→ {
  "intentType": "conversation",
  "confidence": 0.95,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": [{
    "id": "A",
    "capability": "general",
    "action": "respond",
    "constraints": {},
    "changes": {},
    "dependsOn": []
  }]
}

### Example 7: Meta question
User: "מה אתה יכול לעשות?"
→ {
  "intentType": "meta",
  "confidence": 0.95,
  "riskLevel": "low",
  "needsApproval": false,
  "missingFields": [],
  "plan": []
}

## CRITICAL RULES
1. ALWAYS use camelCase for JSON fields (intentType, NOT intent_type)
2. NEVER output anything except valid JSON
3. ALWAYS check user capabilities before routing to calendar/gmail
4. If intent is unclear, set low confidence AND populate missingFields
5. Use recent conversation to resolve ambiguous references ("it", "that", "זה")`;

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
    
    // Make actual LLM call
    const plannerOutput = await this.callLLM(userMessage, state, modelConfig);
    
    return {
      plannerOutput,
    };
  }
  
  private buildUserMessage(state: MemoState): string {
    const message = state.input.enhancedMessage || state.input.message;
    
    let userMessage = `${state.now.formatted}\n\n`;
    
    // Add user capabilities (CRITICAL for calendar/gmail routing)
    userMessage += `User capabilities:\n`;
    userMessage += `- Calendar: ${state.user.capabilities.calendar ? 'connected' : 'NOT connected'}\n`;
    userMessage += `- Gmail: ${state.user.capabilities.gmail ? 'connected' : 'NOT connected'}\n`;
    userMessage += `- Database: available\n`;
    userMessage += `- Second Brain: available\n\n`;
    
    // Add recent conversation context (CRITICAL for resolving "it", "that", etc.)
    if (state.recentMessages && state.recentMessages.length > 0) {
      userMessage += `Recent conversation (use this to understand references like "זה", "it", "that"):\n`;
      const recent = state.recentMessages.slice(-5);
      for (const msg of recent) {
        const preview = msg.content.length > 150 ? msg.content.substring(0, 150) + '...' : msg.content;
        userMessage += `[${msg.role}]: ${preview}\n`;
      }
      userMessage += '\n';
    }
    
    // Add long-term context if available
    if (state.longTermSummary) {
      userMessage += `User context: ${state.longTermSummary}\n\n`;
    }
    
    userMessage += `User message: ${message}`;
    
    return userMessage;
  }
  
  private async callLLM(
    userMessage: string, 
    state: MemoState,
    modelConfig: { model: string; temperature?: number; maxTokens?: number }
  ): Promise<PlannerOutput> {
    try {
      // Get requestId from state input metadata if available
      const requestId = (state.input as any).requestId;
      
      // Call LLM
      const response = await callLLMJSON<any>({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        model: modelConfig.model,
        temperature: modelConfig.temperature || 0.3, // Lower temperature for more consistent output
        maxTokens: modelConfig.maxTokens || 2000,
      }, requestId);
      
      // Normalize response (handle both snake_case and camelCase just in case)
      const normalized = this.normalizeResponse(response);
      
      // Validate response structure
      if (!normalized.intentType || !Array.isArray(normalized.plan)) {
        console.warn('[PlannerNode] Invalid LLM response structure, using fallback');
        console.warn('[PlannerNode] Response was:', JSON.stringify(response));
        return this.createFallbackOutput(state.input.enhancedMessage || state.input.message, state);
      }
      
      // Validate confidence range
      normalized.confidence = Math.max(0, Math.min(1, normalized.confidence ?? 0.7));
      
      // Validate riskLevel
      if (!['low', 'medium', 'high'].includes(normalized.riskLevel)) {
        normalized.riskLevel = 'low';
      }
      
      // Ensure arrays exist
      normalized.missingFields = normalized.missingFields || [];
      
      console.log(`[PlannerNode] Intent: ${normalized.intentType}, Confidence: ${normalized.confidence}, Plan steps: ${normalized.plan.length}`);
      
      return normalized as PlannerOutput;
    } catch (error: any) {
      console.error('[PlannerNode] LLM call failed:', error.message);
      return this.createFallbackOutput(state.input.enhancedMessage || state.input.message, state);
    }
  }
  
  /**
   * Normalize LLM response - handle both snake_case and camelCase
   */
  private normalizeResponse(response: any): any {
    return {
      intentType: response.intentType || response.intent_type,
      confidence: response.confidence,
      riskLevel: response.riskLevel || response.risk_level,
      needsApproval: response.needsApproval ?? response.needs_approval ?? false,
      missingFields: response.missingFields || response.missing_fields || [],
      plan: (response.plan || []).map((step: any) => ({
        id: step.id,
        capability: step.capability,
        action: step.action,
        constraints: step.constraints || {},
        changes: step.changes || {},
        dependsOn: step.dependsOn || step.depends_on || [],
      })),
    };
  }
  
  /**
   * Create fallback output when LLM fails
   * Unlike the old stub, this returns low confidence to trigger HITL
   */
  private createFallbackOutput(message: string, state: MemoState): PlannerOutput {
    const lowerMessage = message.toLowerCase();
    
    // Meta intent - user asks what we can do
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
    
    // Greeting patterns
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
          action: 'respond',
          constraints: {},
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // Reminder/Task patterns (Hebrew + English)
    if (this.matchesReminderIntent(message)) {
      const isDelete = /מחק|בטל|הסר|delete|remove|cancel/i.test(message);
      const isComplete = /סיימתי|עשיתי|בוצע|done|complete|finish/i.test(message);
      const isList = /מה יש|מה התזכורות|הראה|show|list|what.*remind/i.test(message);
      
      let action: string;
      let riskLevel: 'low' | 'medium' | 'high' = 'low';
      
      if (isDelete) {
        action = 'delete_task';
        riskLevel = 'high';
      } else if (isComplete) {
        action = 'complete_task';
      } else if (isList) {
        action = 'list_tasks';
      } else {
        action = 'create_task';
      }
      
      return {
        intentType: 'operation',
        confidence: 0.85,
        riskLevel,
        needsApproval: isDelete,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'database' as Capability,
          action,
          constraints: { text: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // Calendar patterns
    if (this.matchesCalendarIntent(message)) {
      // Check if user has calendar connected
      if (!state.user.capabilities.calendar) {
        return {
          intentType: 'operation',
          confidence: 0.6,
          riskLevel: 'low',
          needsApproval: false,
          missingFields: ['google_connection_required'],
          plan: [{
            id: 'A',
            capability: 'calendar' as Capability,
            action: 'list_events',
            constraints: {},
            changes: {},
            dependsOn: [],
          }],
        };
      }
      
      const isCreate = /קבע|צור|schedule|create|add/i.test(message);
      const isDelete = /בטל|מחק|delete|cancel/i.test(message);
      
      return {
        intentType: 'operation',
        confidence: 0.8,
        riskLevel: isDelete ? 'high' : 'low',
        needsApproval: isDelete,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'calendar' as Capability,
          action: isCreate ? 'create_event' : isDelete ? 'delete_event' : 'list_events',
          constraints: { summary: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // Memory patterns
    if (this.matchesMemoryIntent(message)) {
      const isStore = /תזכור|זכור|שמור|remember|save|store/i.test(message);
      
      return {
        intentType: 'operation',
        confidence: 0.8,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'second-brain' as Capability,
          action: isStore ? 'store_memory' : 'search_memory',
          constraints: { text: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // DEFAULT: Return low confidence to trigger HITL clarification
    // Instead of routing to "general" and giving a generic response
    console.log('[PlannerNode] Could not determine intent, returning low confidence for HITL');
    return {
      intentType: 'operation',
      confidence: 0.5, // This will trigger HITL
      riskLevel: 'low',
      needsApproval: false,
      missingFields: ['unclear_intent'],
      plan: [{
        id: 'A',
        capability: 'general' as Capability,
        action: 'respond',
        constraints: {},
        changes: {},
        dependsOn: [],
      }],
    };
  }
  
  // ========================================================================
  // Pattern matchers
  // ========================================================================
  
  private matchesMetaIntent(message: string): boolean {
    return /what can you do|מה אתה יכול|help|עזרה|capabilities|יכולות/i.test(message);
  }
  
  private matchesGreeting(message: string): boolean {
    return /^(שלום|היי|הי|בוקר טוב|ערב טוב|hello|hi|hey|good morning|good evening)[\s!?]*$/i.test(message.trim());
  }
  
  private matchesReminderIntent(message: string): boolean {
    // Comprehensive Hebrew and English patterns for reminders/tasks
    return /תזכיר|תזכורת|להזכיר|משימה|remind|reminder|task|todo|to-do|כל יום|כל בוקר|כל ערב|every day|every morning/i.test(message);
  }
  
  private matchesCalendarIntent(message: string): boolean {
    return /פגישה|אירוע|יומן|לוח זמנים|meeting|calendar|event|schedule|appointment/i.test(message);
  }
  
  private matchesMemoryIntent(message: string): boolean {
    return /תזכור ש|זכור ש|שמור|מה אמרתי|מה שמרתי|remember that|save|store|what did i say|what.*saved/i.test(message);
  }
}

/**
 * Factory function for LangGraph node registration
 */
export function createPlannerNode() {
  const node = new PlannerNode();
  return node.asNodeFunction();
}

export { PLANNER_SYSTEM_PROMPT };

