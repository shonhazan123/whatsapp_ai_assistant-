/**
 * Canonical HITL Contract Types
 *
 * Single source of truth for the HITL control-plane.
 * One pendingHITL at a time, deterministic resume routing via returnTo.
 */

// ============================================================================
// HITL KIND + REASON
// ============================================================================

export type HITLKind = 'clarification' | 'approval' | 'disambiguation';

export type HITLSource =
  | 'planner'
  | 'entity_resolution'
  | 'risk_engine'
  | 'tool_policy'
  | 'entity_policy';

export type HITLPolicySource =
  | 'risk_engine'
  | 'planner'
  | 'tool_policy'
  | 'entity_policy';

export type HITLReason =
  | 'intent_unclear'
  | 'missing_fields'
  | 'low_confidence_plan'
  | 'confirmation'
  | 'high_risk'
  | 'needs_approval'
  | 'disambiguation'
  | 'tool_requires_review'
  | 'ambiguous_scope'
  | 'policy_violation';

// ============================================================================
// EXPECTED INPUT (for resume validation)
// ============================================================================

export type HITLExpectedInput =
  | 'yes_no'
  | 'single_choice'
  | 'multi_choice'
  | 'free_text';

// ============================================================================
// RETURN-TO (deterministic resume routing)
// ============================================================================

export interface HITLReturnTo {
  node: 'planner' | 'resolver_router' | 'entity_resolution';
  mode: 'replan' | 'continue' | 'apply_selection';
}

// ============================================================================
// PENDING HITL (the canonical contract object)
// ============================================================================

export interface PendingHITLOption {
  id: string;
  label: string;
}

export interface PendingHITL {
  version: 1;
  hitlId: string;
  kind: HITLKind;
  source: HITLSource;
  reason: HITLReason;
  originStepId: string;
  returnTo: HITLReturnTo;
  expectedInput: HITLExpectedInput;
  question: string;
  options?: PendingHITLOption[];
  policySource?: HITLPolicySource;
  expiresAt: string; // ISO timestamp, default TTL = 5 minutes
  context?: {
    resolverStepId?: string;
    originalArgs?: Record<string, any>;
    candidates?: Array<{
      id: string;
      displayText: string;
      entity?: any;
      score?: number;
      metadata?: Record<string, any>;
    }>;
    disambiguationKind?: 'pick_one' | 'pick_many' | 'recurring_scope' | 'conflict_override';
    allowMultiple?: boolean;
  };
  createdAt: string; // ISO timestamp
}

// ============================================================================
// HITL INTERPRETER (LLM-based reply classification)
// ============================================================================

export type HITLInterpreterDecision =
  | 'continue'
  | 're_ask'
  | 'switch_intent'
  | 'cancel'
  | 'continue_with_modifications';

export interface HITLInterpreterOutput {
  decision: HITLInterpreterDecision;
  parsed?: {
    approved?: boolean;
    answer?: string;
    modifications?: Record<string, unknown>;
  };
}

// ============================================================================
// HITL RESULT ENTRY (stored after valid resume)
// ============================================================================

export interface HITLResultEntry {
  raw: string;
  parsed: any;
  at: string; // ISO timestamp
  returnTo?: HITLReturnTo; // Audit trail
  interpreted?: HITLInterpreterOutput;
}

// ============================================================================
// EXECUTED OPERATION (PII-safe idempotency ledger)
// ============================================================================

export interface ExecutedOperation {
  at: string; // ISO timestamp
  stepId: string;
  capability: string;
  argsHash: string;
  success: boolean;
  resultHash: string;
  externalIds?: Record<string, string | string[]>;
}

// ============================================================================
// HITL TTL CONSTANT
// ============================================================================

export const HITL_TTL_MS = 5 * 60 * 1000; // 5 minutes
