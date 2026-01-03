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

// System prompt for the planner (static, cacheable)
const PLANNER_SYSTEM_PROMPT = `You are Memo's Planner. Your job is to understand user intent and create an execution plan.

CAPABILITIES AVAILABLE:
- calendar: Google Calendar operations (create, read, update, delete events)
- database: Tasks, reminders, lists, nudges
- gmail: Email drafts, replies, search
- second-brain: Store and retrieve notes, ideas, reflections
- general: Conversation, advice, brainstorming (no tools needed)
- meta: "What can you do?" - capability descriptions

OUTPUT FORMAT (MUST BE VALID JSON):
You MUST respond with ONLY valid JSON, no additional text or explanation.
{
  "intent_type": "operation" | "conversation" | "meta",
  "confidence": 0.0-1.0,
  "risk_level": "low" | "medium" | "high",
  "needs_approval": true/false,
  "missing_fields": ["field1", "field2"],
  "plan": [
    {
      "id": "A",
      "capability": "calendar",
      "action": "find_event",
      "constraints": { "summary": "meeting with John" },
      "changes": {},
      "depends_on": []
    }
  ]
}

RULES:
1. Detect ambiguity → set confidence < 0.7, add to missing_fields
2. Multi-step requests → create multiple plan steps with dependencies
3. Destructive actions (delete, cancel) → risk_level = "medium" or "high"
4. Never specify tool schemas or API arguments - that's the Resolver's job
5. If user asks about capabilities → intent_type = "meta", no plan needed
6. Conversational requests → intent_type = "conversation", capability = "general"

ACTIONS BY CAPABILITY:
- calendar: find_event, create_event, update_event, delete_event, list_events
- database: create_task, update_task, delete_task, complete_task, list_tasks, create_list, update_list, delete_list
- gmail: draft_email, reply_email, send_email, search_emails
- second-brain: store_note, search_notes, get_summary
- general: respond (no action needed)
- meta: describe_capabilities (no action needed)`;

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
    
    // Build user message with context
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
    
    // Add user capabilities
    userMessage += `User capabilities:\n`;
    userMessage += `- Calendar: ${state.user.capabilities.calendar ? 'connected' : 'not connected'}\n`;
    userMessage += `- Gmail: ${state.user.capabilities.gmail ? 'connected' : 'not connected'}\n`;
    userMessage += `- Database: available\n`;
    userMessage += `- Second Brain: available\n\n`;
    
    // Add recent context if available
    if (state.recentMessages.length > 0) {
      userMessage += `Recent conversation:\n`;
      const recent = state.recentMessages.slice(-3);
      for (const msg of recent) {
        userMessage += `${msg.role}: ${msg.content.substring(0, 100)}...\n`;
      }
      userMessage += '\n';
    }
    
    // Add long-term summary if available
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
      
      // Call LLM - system prompt already instructs JSON format
      // We don't use responseFormat as it's not supported by all models (e.g., gpt-5.1)
      const response = await callLLMJSON<PlannerOutput>({
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        model: modelConfig.model,
        temperature: modelConfig.temperature || 0.7,
        maxTokens: modelConfig.maxTokens || 2000,
      }, requestId);
      
      // Validate response structure
      if (!response.intentType || !response.plan) {
        console.warn('[PlannerNode] Invalid LLM response, falling back to stub');
        return this.stubPlannerOutput(state.input.enhancedMessage || state.input.message, state);
      }
      
      // Ensure confidence is between 0 and 1
      if (response.confidence !== undefined) {
        response.confidence = Math.max(0, Math.min(1, response.confidence));
      } else {
        response.confidence = 0.8;
      }
      
      // Ensure riskLevel is valid
      if (!response.riskLevel || !['low', 'medium', 'high'].includes(response.riskLevel)) {
        response.riskLevel = 'low';
      }
      
      return response;
    } catch (error: any) {
      console.error('[PlannerNode] LLM call failed, using stub:', error);
      // Fallback to stub on error
      return this.stubPlannerOutput(state.input.enhancedMessage || state.input.message, state);
    }
  }
  
  /**
   * Stub implementation for testing before LLM integration
   */
  private stubPlannerOutput(message: string, state: MemoState): PlannerOutput {
    const lowerMessage = message.toLowerCase();
    
    // Meta intent
    if (lowerMessage.includes('what can you do') || lowerMessage.includes('help') || lowerMessage.includes('מה אתה יכול')) {
      return {
        intentType: 'meta',
        confidence: 0.95,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [],
      };
    }
    
    // Calendar intents
    if (lowerMessage.includes('meeting') || lowerMessage.includes('פגישה') || lowerMessage.includes('calendar') || lowerMessage.includes('יומן')) {
      const isCreate = lowerMessage.includes('schedule') || lowerMessage.includes('create') || lowerMessage.includes('add') || lowerMessage.includes('קבע');
      const isDelete = lowerMessage.includes('delete') || lowerMessage.includes('cancel') || lowerMessage.includes('בטל');
      
      return {
        intentType: 'operation',
        confidence: 0.8,
        riskLevel: isDelete ? 'medium' : 'low',
        needsApproval: isDelete,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'calendar' as Capability,
          action: isCreate ? 'create_event' : isDelete ? 'delete_event' : 'find_event',
          constraints: { summary: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // Task intents
    if (lowerMessage.includes('task') || lowerMessage.includes('remind') || lowerMessage.includes('משימה') || lowerMessage.includes('תזכיר')) {
      const isCreate = lowerMessage.includes('add') || lowerMessage.includes('create') || lowerMessage.includes('הוסף');
      
      return {
        intentType: 'operation',
        confidence: 0.85,
        riskLevel: 'low',
        needsApproval: false,
        missingFields: [],
        plan: [{
          id: 'A',
          capability: 'database' as Capability,
          action: isCreate ? 'create_task' : 'list_tasks',
          constraints: { text: message },
          changes: {},
          dependsOn: [],
        }],
      };
    }
    
    // Default: conversation
    return {
      intentType: 'conversation',
      confidence: 0.7,
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
}

/**
 * Factory function for LangGraph node registration
 */
export function createPlannerNode() {
  const node = new PlannerNode();
  return node.asNodeFunction();
}

export { PLANNER_SYSTEM_PROMPT };

