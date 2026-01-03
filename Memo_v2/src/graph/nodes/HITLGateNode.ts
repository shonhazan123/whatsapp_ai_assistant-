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
 * ❌ No LLM
 * ✅ Uses interrupt() for HITL
 */

import { interrupt } from '@langchain/langgraph';
import type { InterruptPayload, InterruptType } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// Confidence threshold for HITL trigger
const CONFIDENCE_THRESHOLD = 0.7;

export class HITLGateNode extends CodeNode {
  readonly name = 'hitl_gate';
  
  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const plannerOutput = state.plannerOutput;
    
    if (!plannerOutput) {
      // No planner output - should not happen, but handle gracefully
      return {
        error: 'HITLGateNode received state without planner output',
      };
    }
    
    // Check if we're resuming from an interrupt (disambiguation already resolved)
    if (state.disambiguation?.resolved) {
      // User already responded, continue with their selection
      return {};
    }
    
    // Check HITL conditions
    const hitlCheck = this.checkHITLConditions(state);
    
    if (hitlCheck.shouldInterrupt) {
      // Build interrupt payload
      const payload = this.buildInterruptPayload(hitlCheck, state);
      
      // Store disambiguation context before interrupt
      const updatedState: Partial<MemoState> = {
        disambiguation: hitlCheck.disambiguationContext ? {
          ...hitlCheck.disambiguationContext,
          resolved: false,
        } : undefined,
      };
      
      // This will pause the graph and return the payload
      // When resumed, userResponse will contain the user's reply
      const userResponse = interrupt(payload);
      
      // === CODE BELOW RUNS AFTER USER REPLIES ===
      
      // Update state with user's selection
      return {
        ...updatedState,
        disambiguation: updatedState.disambiguation ? {
          ...updatedState.disambiguation,
          userSelection: userResponse as string,
          resolved: true,
        } : {
          type: 'calendar_event',
          candidates: [],
          resolverStepId: '',
          userSelection: userResponse as string,
          resolved: true,
        },
      };
    }
    
    // No HITL needed, continue to resolver router
    return {};
  }
  
  // ========================================================================
  // HITL Condition Checking
  // ========================================================================
  
  private checkHITLConditions(state: MemoState): HITLCheckResult {
    const plannerOutput = state.plannerOutput!;
    
    // 1. Low confidence
    if (plannerOutput.confidence < CONFIDENCE_THRESHOLD) {
      return {
        shouldInterrupt: true,
        reason: 'clarification',
        details: `Confidence ${plannerOutput.confidence} below threshold ${CONFIDENCE_THRESHOLD}`,
      };
    }
    
    // 2. Missing fields
    if (plannerOutput.missingFields.length > 0) {
      return {
        shouldInterrupt: true,
        reason: 'clarification',
        details: `Missing: ${plannerOutput.missingFields.join(', ')}`,
        missingFields: plannerOutput.missingFields,
      };
    }
    
    // 3. High risk operations
    if (plannerOutput.riskLevel === 'high') {
      return {
        shouldInterrupt: true,
        reason: 'confirmation',
        details: 'High risk operation requires confirmation',
      };
    }
    
    // 4. Explicit approval needed
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
  // Interrupt Payload Building - Bulding the message that will be sent to the user
  // ========================================================================
  
  private buildInterruptPayload(
    hitlCheck: HITLCheckResult,
    state: MemoState
  ): InterruptPayload {
    const language = state.user.language;
    
    return {
      type: hitlCheck.reason as InterruptType || 'clarification',
      question: this.generateQuestion(hitlCheck, state, language),
      options: this.generateOptions(hitlCheck, state),
      metadata: {
        stepId: state.plannerOutput?.plan[0]?.id,
        entityType: hitlCheck.disambiguationContext?.type,
        candidates: hitlCheck.disambiguationContext?.candidates,
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
  // Message Generation
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
    
    if (language === 'he') {
      return `⚠️ זו פעולה משמעותית (${action}).\nאתה בטוח שאתה רוצה להמשיך?`;
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
    if (!context) {
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
      date: { he: 'תאריך', en: 'date' },
      time: { he: 'שעה', en: 'time' },
      title: { he: 'כותרת', en: 'title' },
      summary: { he: 'תיאור', en: 'description' },
      duration: { he: 'משך', en: 'duration' },
      attendees: { he: 'משתתפים', en: 'attendees' },
      category: { he: 'קטגוריה', en: 'category' },
      priority: { he: 'עדיפות', en: 'priority' },
    };
    
    const lang = language === 'other' ? 'en' : language;
    return fieldDescriptions[field]?.[lang] || field;
  }
}

interface HITLCheckResult {
  shouldInterrupt: boolean;
  reason?: 'clarification' | 'confirmation' | 'approval' | 'disambiguation';
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
