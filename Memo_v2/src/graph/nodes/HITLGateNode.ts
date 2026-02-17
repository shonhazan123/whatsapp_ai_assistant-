/**
 * HITLGateNode - Human-In-The-Loop Gate
 * 
 * Uses LangGraph's native interrupt() mechanism for HITL.
 * 
 * Triggers interrupt() when:
 * - confidence < threshold (0.7)
 * - missing_fields not empty
 * - risk_level = high
 * - needs_approval = true
 * 
 * When interrupted:
 * 1. Graph pauses via interrupt()
 * 2. State is persisted via checkpointer
 * 3. Interrupt payload returned to webhook
 * 4. User replies
 * 5. Graph resumes via Command({ resume: userInput })
 * 6. This node receives userInput and continues
 * 
 * ✅ Uses LLM for generating contextual clarification messages
 * ✅ Uses interrupt() for HITL
 */

import { interrupt } from '@langchain/langgraph';
import { callLLM } from '../../services/llm/LLMService.js';
import { getMemoryService } from '../../services/memory/index.js';
import type { InterruptPayload, InterruptType } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// Confidence threshold for HITL trigger
const CONFIDENCE_THRESHOLD = 0.7;

// ============================================================================
// CLARIFICATION PROMPT - For LLM-based disambiguation message generation
// ============================================================================

const CLARIFICATION_SYSTEM_PROMPT = `You are a friendly WhatsApp assistant helping clarify an ambiguous user request.

## Your Task
Generate a SHORT, conversational message asking the user to clarify their intent.

## Context Provided
- User's original message
- Detected language (respond in this language ONLY)
- Possible interpretations (routing suggestions)
- What's missing or unclear (from planner)
- What the planner thinks they meant (if any)

## Rules
1. RESPOND ONLY in the user's language (Hebrew/English)
2. Be conversational and friendly, NOT robotic
3. Keep it SHORT (2-4 sentences max)
4. NEVER expose internal names like "calendar_mutate_resolver" or "database_task_resolver"
5. If multiple options exist, present them as friendly alternatives
6. If something specific is missing (like time/date), ask for it naturally
7. Include a brief example if it helps clarify
8. Use the user's original words when referring to what they asked

## Capability Descriptions (use these friendly terms, not internal names)
- calendar (create/edit): "להוסיף/לערוך אירוע ביומן" / "add/edit calendar event"
- calendar (query): "לבדוק מה יש ביומן" / "check your calendar"  
- database (reminder): "ליצור תזכורת" / "create a reminder"
- database (task): "ליצור משימה" / "create a task"
- gmail: "לטפל במייל" / "handle email"
- second-brain: "לשמור/לחפש מידע" / "save/search information"

## Missing Field Translations
- target_unclear: Ask WHICH specific items (by name or time window)
- time_unclear: Ask WHEN
- intent_unclear: Ask WHAT they want to do (with friendly alternatives)
- which_one: Ask which specific item from options

## Output
Return ONLY the clarification message text. No JSON, no markdown, no explanations.`;

export class HITLGateNode extends CodeNode {
  readonly name = 'hitl_gate';
  
  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    console.log(`[HITLGateNode] Processing - disambiguation.resolved: ${state.disambiguation?.resolved}, needsHITL: ${state.needsHITL}`);
    
    // Check if we're resuming from an interrupt (disambiguation already resolved)
    if (state.disambiguation?.resolved) {
      // User already responded, continue with their selection
      console.log(`[HITLGateNode] Resuming from resolved disambiguation`);
      return { needsHITL: false };
    }
    
    // Check if EntityResolutionNode triggered HITL (disambiguation/not_found/clarification)
    if (state.needsHITL && state.disambiguation) {
      console.log(`[HITLGateNode] EntityResolution requested HITL: ${state.hitlReason}`);
      return this.handleEntityResolutionHITL(state);
    }
    
    const plannerOutput = state.plannerOutput;
    
    if (!plannerOutput) {
      // No planner output - should not happen, but handle gracefully
      console.error(`[HITLGateNode] No planner output in state!`);
      return {
        error: 'HITLGateNode received state without planner output',
      };
    }
    
    // Check HITL conditions from planner
    const hitlCheck = this.checkHITLConditions(state);
    console.log(`[HITLGateNode] HITL check: shouldInterrupt=${hitlCheck.shouldInterrupt}, reason=${hitlCheck.reason}, details=${hitlCheck.details}`);
    
    if (hitlCheck.shouldInterrupt) {
      // Build interrupt payload (async for LLM-based clarification)
      const payload = await this.buildInterruptPayload(hitlCheck, state);
      console.log(`[HITLGateNode] Triggering interrupt with question: "${payload.question?.substring(0, 100)}..."`);
      
      // CRITICAL: Add the interrupt message (question) to memory BEFORE interrupting
      // This ensures the disambiguation/clarification message is in conversation history
      this.addInterruptMessageToMemory(state, payload.question);
      
      // Determine hitlType for routing after resume
      const hitlType = hitlCheck.reason === 'intent_unclear' ? 'intent_unclear' as const :
                       hitlCheck.missingFields?.length ? 'missing_fields' as const : 
                       'confirmation' as const;
      
      console.log(`[HITLGateNode] Setting hitlType=${hitlType} for routing after resume`);
      
      // Store disambiguation context, hitlType, and interrupt timestamp before interrupt
      const updatedState: Partial<MemoState> = {
        hitlType,
        disambiguation: hitlCheck.disambiguationContext ? {
          ...hitlCheck.disambiguationContext,
          resolved: false,
        } : undefined,
        interruptedAt: Date.now(), // Set timestamp for timeout tracking
      };
      
      // This will pause the graph and return the payload
      // When resumed, userResponse will contain the user's reply
      const userResponse = interrupt(payload);
      
      // === CODE BELOW RUNS AFTER USER REPLIES ===
      console.log(`[HITLGateNode] Resumed from interrupt with user response: "${userResponse}"`);
      
      // CRITICAL: Add user's response to memory
      // This ensures the clarification conversation is in history
      this.addUserResponseToMemory(state, userResponse as string);
      
      // Update state with user's selection
      // IMPORTANT: Clear any previous error state and interruptedAt when resuming successfully
      // NOTE: Only update disambiguation if it already exists (entity resolution HITL)
      // For planner HITL (confirmation/clarification), don't create fake disambiguation
      // as it would confuse EntityResolutionNode
      return {
        ...updatedState,
        error: undefined, // Clear error on successful resume
        interruptedAt: undefined, // Clear timeout tracking
        disambiguation: updatedState.disambiguation ? {
          ...updatedState.disambiguation,
          userSelection: userResponse as string,
          resolved: true,
        } : undefined, // Don't create fake disambiguation for planner HITL
        needsHITL: false,
        // Store planner HITL response separately so we know user confirmed
        plannerHITLResponse: !updatedState.disambiguation ? userResponse as string : undefined,
      };
    }
    
    // No HITL needed, continue to resolver router
    console.log(`[HITLGateNode] No HITL needed, proceeding to resolver`);
    return { needsHITL: false };
  }
  
  /**
   * Handle HITL triggered by EntityResolutionNode
   */
  private handleEntityResolutionHITL(state: MemoState): Partial<MemoState> {
    const disambiguation = state.disambiguation!;
    const language = state.user.language;
    
    // Build payload based on disambiguation type
    let question: string;
    let options: string[] | undefined;
    
    if (disambiguation.type === 'error') {
      // Not found or clarify query - ask user to clarify
      question = disambiguation.error || (language === 'he' 
        ? 'לא הצלחתי למצוא מה שחיפשת. אפשר לנסות לנסח אחרת?' 
        : 'I couldn\'t find what you\'re looking for. Can you try rephrasing?');
      
      if (disambiguation.suggestions && disambiguation.suggestions.length > 0) {
        question += '\n\n' + (language === 'he' ? 'הצעות:' : 'Suggestions:');
        question += '\n• ' + disambiguation.suggestions.join('\n• ');
      }
    } else {
      // Disambiguation with candidates
      question = disambiguation.question || this.getDisambiguationMessage(language, disambiguation);
      options = disambiguation.candidates?.map((c, i) => `${i + 1}. ${c.displayText}`);
    }
    
    // Set interrupt timestamp for timeout tracking
    const interruptTimestamp = Date.now();
    console.log(`[HITLGateNode] Setting interruptedAt=${interruptTimestamp} for timeout tracking`);
    
    const payload: InterruptPayload = {
      type: disambiguation.type === 'error' ? 'clarification' : 'disambiguation',
      question,
      options,
      metadata: {
        stepId: disambiguation.resolverStepId,
        entityType: disambiguation.type,
        candidates: disambiguation.candidates,
        interruptedAt: interruptTimestamp, // Include timestamp in payload for timeout tracking
      },
    };
    
    // CRITICAL: Add the interrupt message (question) to memory BEFORE interrupting
    // This ensures the disambiguation/clarification message is in conversation history
    this.addInterruptMessageToMemory(state, question);
    
    // Interrupt and wait for user response
    const userResponse = interrupt(payload);
    
    // === CODE BELOW RUNS AFTER USER REPLIES ===
    console.log(`[HITLGateNode] Resumed from entity resolution HITL with user response: "${userResponse}"`);
    
    // CRITICAL: Add user's response to memory
    this.addUserResponseToMemory(state, userResponse as string);
    
    // Parse user response
    const selection = this.parseUserSelection(userResponse as string);
    
    // Set userSelection but keep resolved: false so EntityResolutionNode can process it
    // EntityResolutionNode will set resolved: true after successfully applying the selection
    return {
      disambiguation: {
        ...disambiguation,
        userSelection: selection,
        resolved: false, // Let EntityResolutionNode process and set resolved: true
      },
      needsHITL: false,
      interruptedAt: undefined, // Clear timeout tracking on resume
    };
  }
  
  /**
   * Parse user's selection from their response
   */
  private parseUserSelection(response: string): string | number | number[] {
    const trimmed = response.trim().toLowerCase();
    
    // Check for "both" / "all"
    if (trimmed === 'both' || trimmed === 'all' || trimmed === 'שניהם' || trimmed === 'כולם') {
      return trimmed;
    }
    
    // Check for number(s)
    const numbers = trimmed.match(/\d+/g);
    if (numbers) {
      if (numbers.length === 1) {
        return parseInt(numbers[0], 10);
      }
      return numbers.map(n => parseInt(n, 10));
    }
    
    // Return as-is for text selection
    return response;
  }
  
  // ========================================================================
  // HITL Condition Checking
  // ========================================================================
  
  private checkHITLConditions(state: MemoState): HITLCheckResult {
    const plannerOutput = state.plannerOutput!;
    
    // 1. Check for intent_unclear FIRST (triggers re-planning flow after HITL)
    // This is separate from other missing fields because it routes back to planner
    if (plannerOutput.missingFields.includes('intent_unclear')) {
      return {
        shouldInterrupt: true,
        reason: 'intent_unclear',
        details: 'Unclear what action user wants to take - will re-plan after clarification',
        missingFields: plannerOutput.missingFields,
      };
    }
    
    // 2. Low confidence (without intent_unclear)
    if (plannerOutput.confidence < CONFIDENCE_THRESHOLD) {
      return {
        shouldInterrupt: true,
        reason: 'clarification',
        details: `Confidence ${plannerOutput.confidence} below threshold ${CONFIDENCE_THRESHOLD}`,
      };
    }
    
    // 3. Other missing fields (not intent_unclear)
    if (plannerOutput.missingFields.length > 0) {
      return {
        shouldInterrupt: true,
        reason: 'clarification',
        details: `Missing: ${plannerOutput.missingFields.join(', ')}`,
        missingFields: plannerOutput.missingFields,
      };
    }
    
    // 4. High risk operations
    if (plannerOutput.riskLevel === 'high') {
      return {
        shouldInterrupt: true,
        reason: 'confirmation',
        details: 'High risk operation requires confirmation',
      };
    }
    
    // 5. Explicit approval needed
    if (plannerOutput.needsApproval) {
      return {
        shouldInterrupt: true,
        reason: 'approval',
        details: 'Operation requires explicit user approval',
      };
    }
    
    return { shouldInterrupt: false };
  }
  
  // ========================================================================
  // Interrupt Payload Building - Building the message that will be sent to the user
  // ========================================================================
  
  private async buildInterruptPayload(
    hitlCheck: HITLCheckResult,
    state: MemoState
  ): Promise<InterruptPayload> {
    const language = state.user.language;
    
    // Use LLM for clarification cases (low confidence, missing fields, intent_unclear)
    // This provides more natural, contextual messages
    let question: string;
    
    if (hitlCheck.reason === 'clarification' || hitlCheck.reason === 'intent_unclear') {
      // Use LLM to generate a contextual clarification message
      question = await this.generateClarificationWithLLM(hitlCheck, state);
    } else {
      // Use existing methods for confirmation/approval (these are more structured)
      question = this.generateQuestion(hitlCheck, state, language);
    }
    
    return {
      type: hitlCheck.reason as InterruptType || 'clarification',
      question,
      options: this.generateOptions(hitlCheck, state),
      metadata: {
        stepId: state.plannerOutput?.plan[0]?.id,
        entityType: hitlCheck.disambiguationContext?.type,
        candidates: hitlCheck.disambiguationContext?.candidates,
        interruptedAt: Date.now(), // Include timestamp for timeout tracking
      },
    };
  }
  
  private generateQuestion(
    hitlCheck: HITLCheckResult,
    state: MemoState,
    language: 'he' | 'en' | 'other'
  ): string {
    switch (hitlCheck.reason) {
      case 'clarification':
        if (hitlCheck.missingFields?.length) {
          return this.getMissingFieldsMessage(language, hitlCheck.missingFields);
        }
        return this.getLowConfidenceMessage(language, state);
      
      case 'confirmation':
        return this.getConfirmationMessage(language, state);
      
      case 'approval':
        return this.getApprovalMessage(language, state);
      
      case 'disambiguation':
        return this.getDisambiguationMessage(language, hitlCheck.disambiguationContext!);
      
      default:
        return language === 'he' 
          ? 'אני צריך עוד מידע. אפשר לפרט?' 
          : 'I need more information. Can you elaborate?';
    }
  }
  
  private generateOptions(
    hitlCheck: HITLCheckResult,
    state: MemoState
  ): string[] | undefined {
    // For disambiguation, return the candidate display texts
    if (hitlCheck.disambiguationContext?.candidates) {
      return hitlCheck.disambiguationContext.candidates.map(
        (c, i) => `${i + 1}. ${c.displayText}`
      );
    }
    
    // For confirmation/approval, return yes/no options
    if (hitlCheck.reason === 'confirmation' || hitlCheck.reason === 'approval') {
      return state.user.language === 'he' 
        ? ['כן', 'לא'] 
        : ['Yes', 'No'];
    }
    
    return undefined;
  }
  
  // ========================================================================
  // LLM-Based Clarification Message Generation
  // ========================================================================
  
  /**
   * Generate a contextual, conversational clarification message using LLM
   * Uses routing suggestions and planner output to craft a helpful response
   */
  private async generateClarificationWithLLM(
    hitlCheck: HITLCheckResult,
    state: MemoState
  ): Promise<string> {
    const language = state.user.language;
    const userMessage = state.input.enhancedMessage || state.input.message;
    
    // Build context for LLM
    const context = {
      userMessage,
      language,
      routingSuggestions: state.routingSuggestions?.slice(0, 3) || [],
      plannerOutput: state.plannerOutput ? {
        confidence: state.plannerOutput.confidence,
        missingFields: state.plannerOutput.missingFields,
        plan: state.plannerOutput.plan.map(p => ({
          capability: p.capability,
          action: p.action,
        })),
      } : null,
      hitlReason: hitlCheck.reason,
      hitlDetails: hitlCheck.details,
    };
    
    const userPrompt = `## User Message
"${userMessage}"

## Language
${language === 'he' ? 'Hebrew (עברית) - respond in Hebrew only' : 'English - respond in English only'}

## Routing Suggestions (possible interpretations based on pattern matching)
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
Reason: ${hitlCheck.reason || 'unclear intent'}
Details: ${hitlCheck.details || 'Low confidence in understanding'}
${hitlCheck.missingFields?.length ? `Missing fields: ${hitlCheck.missingFields.join(', ')}` : ''}

Generate a friendly, conversational clarification message in ${language === 'he' ? 'Hebrew' : 'English'}:`;

    try {
      console.log(`[HITLGateNode] Generating LLM clarification for: "${userMessage.substring(0, 50)}..."`);
      
      const response = await callLLM({
        messages: [
          { role: 'system', content: CLARIFICATION_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        model: 'gpt-4o-mini', // Fast, cheap model for this task
        temperature: 0.7,
        maxTokens: 200,
      });
      
      const clarificationMessage = response.content?.trim();
      
      if (clarificationMessage) {
        console.log(`[HITLGateNode] LLM generated clarification: "${clarificationMessage.substring(0, 100)}..."`);
        return clarificationMessage;
      }
      
      // Fallback if LLM returns empty
      console.warn('[HITLGateNode] LLM returned empty clarification, using fallback');
      return this.getFallbackClarificationMessage(language, hitlCheck);
    } catch (error) {
      console.error('[HITLGateNode] LLM clarification failed, using fallback:', error);
      return this.getFallbackClarificationMessage(language, hitlCheck);
    }
  }
  
  /**
   * Fallback clarification message when LLM fails
   */
  private getFallbackClarificationMessage(
    language: 'he' | 'en' | 'other',
    hitlCheck: HITLCheckResult
  ): string {
    // Use existing methods as fallback
    if (hitlCheck.missingFields?.length) {
      return this.getMissingFieldsMessage(language, hitlCheck.missingFields);
    }
    
    return language === 'he'
      ? 'לא הצלחתי להבין בדיוק. אפשר לנסח אחרת?'
      : "I couldn't quite understand. Could you rephrase?";
  }
  
  // ========================================================================
  // Legacy Message Generation (used as fallback and for non-clarification cases)
  // ========================================================================
  
  private getLowConfidenceMessage(language: 'he' | 'en' | 'other', state: MemoState): string {
    if (language === 'he') {
      return `לא בטוח שהבנתי נכון. התכוונת ל:\n` +
        `• ${this.describeIntent(state, 'he')}\n\n` +
        `אנא אשר או תקן אותי.`;
    }
    
    return `I'm not sure I understood correctly. Did you mean to:\n` +
      `• ${this.describeIntent(state, 'en')}\n\n` +
      `Please confirm or correct me.`;
  }
  
  private getMissingFieldsMessage(language: 'he' | 'en' | 'other', fields: string[]): string {
    const fieldDescriptions = fields.map(f => this.describeField(f, language)).join('\n• ');
    
    if (language === 'he') {
      return `אני צריך עוד כמה פרטים:\n• ${fieldDescriptions}`;
    }
    
    return `I need a few more details:\n• ${fieldDescriptions}`;
  }
  
  private getConfirmationMessage(language: 'he' | 'en' | 'other', state: MemoState): string {
    const action = state.plannerOutput?.plan[0]?.action || 'this action';
    const isDeleteEvents =
      action === 'delete event' || action === 'delete events by window';

    if (language === 'he') {
      if (isDeleteEvents) {
        return `🙂 רק מוודאה שאתה בטוח שברצונך לבצע מחיקה (:`;
      }
      return `⚠️ זו פעולה משמעותית (${action}).\nאתה בטוח שאתה רוצה להמשיך?`;
    }



    if (isDeleteEvents) {
      return `Just making sure you want to go ahead with deleting (single or multiple events) (:`;
    }
    return `⚠️ This is a significant action (${action}).\nAre you sure you want to proceed?`;
  }
  
  private getApprovalMessage(language: 'he' | 'en' | 'other', state: MemoState): string {
    const description = this.describeIntent(state, language);
    
    if (language === 'he') {
      return `אני עומד ל${description}.\nתאשר בבקשה (כן/לא).`;
    }
    
    return `I'm about to ${description}.\nPlease confirm (yes/no).`;
  }
  
  private getDisambiguationMessage(
    language: 'he' | 'en' | 'other',
    context: MemoState['disambiguation']
  ): string {
    if (!context || !context.candidates || context.candidates.length === 0) {
      return language === 'he' ? 'איזה אחד?' : 'Which one?';
    }
    
    const options = context.candidates
      .map((c, i) => `${i + 1}. ${c.displayText}`)
      .join('\n');
    
    if (language === 'he') {
      return `מצאתי כמה אפשרויות:\n${options}\n\nאיזה אחד התכוונת?`;
    }
    
    return `I found multiple matches:\n${options}\n\nWhich one did you mean?`;
  }
  
  // ========================================================================
  // Helper methods
  // ========================================================================
  
  /**
   * Add the interrupt message to memory as an assistant message
   * This ensures the disambiguation/clarification question is in conversation history
   */
  private addInterruptMessageToMemory(state: MemoState, question: string | undefined): void {
    if (!question) return;
    
    try {
      const memoryService = getMemoryService();
      const userPhone = state.user.phone || state.input.userPhone;
      
      memoryService.addAssistantMessage(userPhone, question);
      console.log(`[HITLGateNode] Added interrupt message to memory for ${userPhone}`);
    } catch (error) {
      console.error('[HITLGateNode] Error adding interrupt message to memory:', error);
      // Don't fail the interrupt if this fails
    }
  }
  
  /**
   * Add the user's response to memory after HITL resume
   * This ensures the clarification conversation is in history
   */
  private addUserResponseToMemory(state: MemoState, response: string | undefined): void {
    if (!response) return;
    
    try {
      const memoryService = getMemoryService();
      const userPhone = state.user.phone || state.input.userPhone;
      
      memoryService.addUserMessage(userPhone, response, {});
      console.log(`[HITLGateNode] Added user response to memory for ${userPhone}`);
    } catch (error) {
      console.error('[HITLGateNode] Error adding user response to memory:', error);
      // Don't fail the resume if this fails
    }
  }
  
  private describeIntent(state: MemoState, language: 'he' | 'en' | 'other'): string {
    const plan = state.plannerOutput?.plan[0];
    if (!plan) {
      return language === 'he' ? 'לעזור לך' : 'help you';
    }
    
    const actionDescriptions: Record<string, Record<string, string>> = {
      create_event: { he: 'ליצור אירוע ביומן', en: 'create a calendar event' },
      update_event: { he: 'לעדכן אירוע ביומן', en: 'update a calendar event' },
      delete_event: { he: 'למחוק אירוע מהיומן', en: 'delete a calendar event' },
      find_event: { he: 'לחפש אירועים ביומן', en: 'find calendar events' },
      create_task: { he: 'ליצור משימה', en: 'create a task' },
      update_task: { he: 'לעדכן משימה', en: 'update a task' },
      delete_task: { he: 'למחוק משימה', en: 'delete a task' },
      complete_task: { he: 'לסמן משימה כהושלמה', en: 'mark a task as complete' },
      list_tasks: { he: 'להציג את המשימות שלך', en: 'show your tasks' },
      respond: { he: 'לענות לך', en: 'respond to you' },
    };
    
    const lang = language === 'other' ? 'en' : language;
    return actionDescriptions[plan.action]?.[lang] || plan.action;
  }
  
  private describeField(field: string, language: 'he' | 'en' | 'other'): string {
    const fieldDescriptions: Record<string, Record<string, string>> = {
      // Standard fields
      date: { he: 'תאריך', en: 'date' },
      time: { he: 'שעה', en: 'time' },
      title: { he: 'כותרת', en: 'title' },
      summary: { he: 'תיאור', en: 'description' },
      duration: { he: 'משך', en: 'duration' },
      attendees: { he: 'משתתפים', en: 'attendees' },
      category: { he: 'קטגוריה', en: 'category' },
      priority: { he: 'עדיפות', en: 'priority' },
      
      // Special planner fields
      google_connection_required: { 
        he: 'כדי להשתמש ביומן או במייל, צריך לחבר את חשבון Google שלך. שלחתי לך קישור בהודעה נפרדת 🔗', 
        en: 'To use calendar or email, you need to connect your Google account. I sent you a link in a separate message 🔗' 
      },
      what_to_delete: { 
        he: 'מה בדיוק למחוק?', 
        en: 'What exactly should I delete?' 
      },
      target_item: { 
        he: 'איזה פריט התכוונת?', 
        en: 'Which item did you mean?' 
      },
      unclear_intent: { 
        he: 'לא הבנתי בדיוק מה לעשות. אפשר לנסח אחרת?', 
        en: 'I didn\'t understand exactly what to do. Can you rephrase?' 
      },
    };
    
    const lang = language === 'other' ? 'en' : language;
    return fieldDescriptions[field]?.[lang] || field;
  }
}

interface HITLCheckResult {
  shouldInterrupt: boolean;
  reason?: 'clarification' | 'confirmation' | 'approval' | 'disambiguation' | 'intent_unclear';
  details?: string;
  missingFields?: string[];
  disambiguationContext?: MemoState['disambiguation'];
}

/**
 * Factory function for LangGraph node registration
 */
export function createHITLGateNode() {
  const node = new HITLGateNode();
  return node.asNodeFunction();
}
