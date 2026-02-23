/**
 * Entity Resolution Types
 * 
 * Types for the generic entity resolution system that handles
 * disambiguation across all domains (calendar, database, gmail, etc.)
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type EntityDomain = 'calendar' | 'database' | 'gmail' | 'second-brain';

export type ResolutionOutputType = 'resolved' | 'disambiguation' | 'not_found' | 'clarify_query';

/**
 * A candidate entity returned from resolution
 */
export interface ResolutionCandidate {
  id: string;
  displayText: string;
  entity: any;
  score: number;
  metadata: Record<string, any>;
}

/**
 * Output from entity resolution.
 * Machine-only: no user-facing question text.
 * HITLGateNode is responsible for building the user-facing question.
 */
export interface ResolutionOutput {
  type: ResolutionOutputType;

  // For 'resolved'
  resolvedIds?: string[];
  args?: Record<string, any>;

  // For 'disambiguation' (machine-only: candidates + metadata)
  candidates?: ResolutionCandidate[];
  /** @deprecated — HITLGateNode builds user-facing question. Kept for backward compat. */
  question?: string;
  allowMultiple?: boolean;
  disambiguationKind?: 'pick_one' | 'pick_many' | 'recurring_scope' | 'conflict_override';

  // For 'not_found' / 'clarify_query'
  error?: string;
  searchedFor?: string;
  suggestions?: string[];
  /** @deprecated — Kept for backward compat. Use machine codes instead. */
  validationErrorCode?: 'invalid_selection';

  // For calendar
  isRecurring?: boolean;
  recurringEventId?: string;
}

/**
 * Context passed to resolvers
 */
export interface EntityResolverContext {
  userPhone: string;
  language: 'he' | 'en' | 'other';
  timeContext: {
    now: Date;
    timezone: string;
    formatted: string;
  };
  recentMessages?: any[];
  /** Auth context (for calendar/gmail resolvers that need to call services requiring user tokens) */
  authContext?: import('../../types/index.js').AuthContext;
}

/**
 * Task comparison result for smart disambiguation
 */
export interface TaskComparison {
  textMatch: 'exact' | 'similar' | 'different';
  fieldsMatch: boolean;
  fieldDifferences: string[];
}

/**
 * Task grouping for disambiguation logic
 */
export interface TaskGroups {
  identical: ResolutionCandidate[];          // Exactly same text AND fields
  sameTextDifferentFields: ResolutionCandidate[];  // Same text, different reminder type/category
  similar: ResolutionCandidate[];            // Similar text (fuzzy)
  different: ResolutionCandidate[];          // Different text
}

/**
 * Calendar event comparison result
 */
export interface EventComparison {
  summaryMatch: 'exact' | 'similar' | 'different';
  sameRecurringSeries: boolean;
  timeDifferenceMinutes: number;
}

/**
 * Calendar event grouping for disambiguation
 */
export interface EventGroups {
  sameRecurringSeries: ResolutionCandidate[];  // Same recurring event instances
  exactSummary: ResolutionCandidate[];         // Same summary, different times
  similar: ResolutionCandidate[];              // Similar summary
}

// ============================================================================
// RESOLVER INTERFACE
// ============================================================================

/**
 * Generic interface for domain-specific entity resolvers
 */
export interface IEntityResolver {
  readonly domain: EntityDomain;
  
  /**
   * Resolve entities from args
   * Returns resolved IDs, disambiguation request, or error
   */
  resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput>;
  
  /**
   * Apply user's disambiguation selection
   * Called when user responds to disambiguation
   */
  applySelection(
    selection: number | number[] | string,
    candidates: ResolutionCandidate[],
    args: Record<string, any>
  ): Promise<ResolutionOutput>;
}

// ============================================================================
// STATE TYPES
// ============================================================================

/**
 * Disambiguation context stored in MemoState (machine-only).
 * User-facing question/options are built by HITLGateNode.
 */
export interface DisambiguationState {
  type: EntityDomain | 'error';

  // Machine-only disambiguation
  candidates?: ResolutionCandidate[];
  allowMultiple?: boolean;
  disambiguationKind?: 'pick_one' | 'pick_many' | 'recurring_scope' | 'conflict_override';

  // For errors
  error?: string;
  searchedFor?: string;
  suggestions?: string[];

  // State tracking
  stepId: string;
  originalArgs: Record<string, any>;
  userSelection?: number | number[] | string;
  resolved?: boolean;
}

