/**
 * CapabilityCheckNode - Validates user capabilities against plan requirements
 * 
 * This node runs after the planner and checks if the plan requires capabilities
 * (calendar/gmail) that the user doesn't have connected.
 * 
 * If capabilities are missing:
 * - Sets finalResponse with fixed Hebrew message
 * - Routes directly to response_writer (bypassing execution)
 * 
 * If all required capabilities are available:
 * - Passes through unchanged (continues to hitl_gate)
 * 
 * ❌ No LLM
 * ✅ Pure code validation
 */

import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

// Fixed messages for missing capabilities
const MESSAGES = {
  both: 'אני רואה שהיומן וה-Gmail שלך לא מחוברים, לחץ כאן כדי לקשר אותם -> https://example.com/connect',
  calendar: 'אני רואה שהיומן שלך לא מחובר, לחץ כאן כדי לקשר אותו -> https://example.com/connect',
  gmail: 'אני רואה שה-Gmail שלך לא מחובר, לחץ כאן כדי לקשר אותו -> https://example.com/connect',
};

export class CapabilityCheckNode extends CodeNode {
  readonly name = 'capability_check';

  protected validate(state: MemoState): { valid: boolean; reason?: string } {
    if (!state.plannerOutput) {
      return { valid: false, reason: 'No planner output to validate' };
    }
    return { valid: true };
  }

  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    const plan = state.plannerOutput?.plan || [];

    if (plan.length === 0) {
      // No plan steps, nothing to check
      console.log('[CapabilityCheckNode] No plan steps to validate');
      return {};
    }

    // Check which capabilities are needed and missing
    let needsCalendar = false;
    let needsGmail = false;

    for (const step of plan) {
      if (step.capability === 'calendar') {
        needsCalendar = true;
      }
      if (step.capability === 'gmail') {
        needsGmail = true;
      }
    }

    // Check if user has the required capabilities
    const missingCalendar = needsCalendar && !state.user.capabilities.calendar;
    const missingGmail = needsGmail && !state.user.capabilities.gmail;

    // If no capabilities are missing, continue normally
    if (!missingCalendar && !missingGmail) {
      console.log('[CapabilityCheckNode] All required capabilities are available');
      return {};
    }

    // Build appropriate message based on what's missing
    let message: string;
    if (missingCalendar && missingGmail) {
      message = MESSAGES.both;
      console.log('[CapabilityCheckNode] Both calendar and gmail are missing');
    } else if (missingCalendar) {
      message = MESSAGES.calendar;
      console.log('[CapabilityCheckNode] Calendar is missing');
    } else {
      message = MESSAGES.gmail;
      console.log('[CapabilityCheckNode] Gmail is missing');
    }

    // Set finalResponse to bypass execution and go directly to response_writer
    return {
      finalResponse: message,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createCapabilityCheckNode() {
  const node = new CapabilityCheckNode();
  return node.asNodeFunction();
}
