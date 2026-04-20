/**
 * MemoState - The central state object for the LangGraph
 * 
 * This is the contract between all nodes. State is explicit,
 * immutable per node execution, and the single source of truth.
 * 
 * Uses LangGraph's Annotation API for full type safety.
 */

import { Annotation } from '@langchain/langgraph';
import type {
  AuthContext,
  ConversationContext,
  ConversationMessage,
  DisambiguationContext,
  ExecutedOperation,
  ExecutionResult,
  FormattedResponse,
  HITLResultEntry,
  LatestAction,
  MessageInput,
  PendingHITL,
  PlannerOutput,
  ResolverResult,
  RoutingSuggestion,
  StateRefs,
  TimeContext,
  UserContext,
} from '../../types/index.js';

// ============================================================================
// LLM STEP (per-call trace record, accumulated across nodes)
// ============================================================================

export interface LLMStep {
  /** Caller-provided name identifying this LLM call (e.g. "planner", "resolver:calendar", "hitl:clarify") */
  node: string;
  model: string;
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  cost: number;
  /** Full messages array sent to the LLM (for debugging what went in) */
  input: Array<{ role: string; content: string }>;
  /** Full raw LLM response content (for debugging what came back) */
  output: string;
  /**
   * When false, this step is excluded from trace aggregates (tokens, cost, LLM call count).
   * Used for synthetic debug rows (e.g. the human-readable context window on `reply_context`).
   */
  countInAggregates?: boolean;
}

// ============================================================================
// METADATA TYPE (used in Annotation)
// ============================================================================

export interface ExecutionMetadata {
  startTime: number;
  nodeExecutions: Array<{
    node: string;
    startTime: number;
    endTime: number;
    durationMs: number;
  }>;
  llmCalls: number;
  totalTokens: number;
  totalCost: number;
}

/**
 * Delta shape returned by nodes — the reducer accumulates these into ExecutionMetadata.
 * Nodes should NEVER spread state.metadata; return only new entries.
 */
export type MetadataDelta = Partial<Pick<ExecutionMetadata, 'nodeExecutions' | 'llmCalls' | 'totalTokens' | 'totalCost'>>;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const defaultUser: UserContext = {
  phone: '',
  timezone: 'Asia/Jerusalem',
  language: 'he',
  planTier: 'free',
  googleConnected: false,
  userName: undefined,
  capabilities: {
    calendar: false,
    gmail: false,
    database: true,
    secondBrain: true,
  },
};

const defaultInput: MessageInput = {
  message: '',
  triggerType: 'user',
  userPhone: '',
};

const defaultNow: TimeContext = {
  formatted: '',
  iso: new Date().toISOString(),
  timezone: 'Asia/Jerusalem',
  dayOfWeek: new Date().getDay(),
  date: new Date(),
};

const defaultMetadata: ExecutionMetadata = {
  startTime: Date.now(),
  nodeExecutions: [],
  llmCalls: 0,
  totalTokens: 0,
  totalCost: 0,
};

// ============================================================================
// MEMO STATE ANNOTATION (LangGraph Type-Safe State Definition)
// ============================================================================

/**
 * MemoStateAnnotation - LangGraph Annotation-based state definition
 */
export const MemoStateAnnotation = Annotation.Root({
  // === USER CONTEXT (lightweight — for prompts, planner, response nodes) ===
  user: Annotation<UserContext>({
    default: () => ({ ...defaultUser }),
    reducer: (_, update) => update, // Last-write-wins
  }),

  // === AUTH CONTEXT (full hydrated auth — for executors & adapters) ===
  // Populated once by ContextAssemblyNode, includes user record, tokens, capabilities.
  // Eliminates redundant DB fetches in service adapters.
  authContext: Annotation<AuthContext | undefined>({
    default: () => undefined,
    reducer: (_, update) => update, // Last-write-wins
  }),

  // === INPUT ===
  input: Annotation<MessageInput>({
    default: () => ({ ...defaultInput }),
    reducer: (_, update) => update,
  }),

  // === TIME CONTEXT ===
  now: Annotation<TimeContext>({
    default: () => ({ ...defaultNow }),
    reducer: (_, update) => update,
  }),

  // === MEMORY ===
  recentMessages: Annotation<ConversationMessage[]>({
    default: () => [],
    // Last-write-wins: nodes return the full tail they want (conversation_context, memory_update, HITL merge).
    reducer: (existing, incoming) => {
      if (incoming === undefined) return existing;
      return incoming;
    },
  }),

  longTermSummary: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  /** Rolling conversation summary + recent tail for planner (in-memory; Redis later). */
  conversationContext: Annotation<ConversationContext | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === LATEST ACTIONS (GeneralResolver only — operational "what did you last do") ===
  latestActions: Annotation<LatestAction[]>({
    default: () => [],
    reducer: (_, update) => update,
  }),

  // === PLANNER OUTPUT ===
  plannerOutput: Annotation<PlannerOutput | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === ROUTING SUGGESTIONS (for disambiguation context) ===
  // Pattern-matched suggestions from PlannerNode, used by HITLGateNode
  // to generate contextual clarification messages
  routingSuggestions: Annotation<RoutingSuggestion[] | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === DISAMBIGUATION (machine-only: candidates + metadata, no user-facing strings) ===
  disambiguation: Annotation<DisambiguationContext | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === CANONICAL HITL CONTRACT ===
  pendingHITL: Annotation<PendingHITL | null>({
    default: () => null,
    reducer: (_, update) => update,
  }),

  hitlResults: Annotation<Record<string, HITLResultEntry>>({
    default: () => ({}),
    reducer: (existing, incoming) => {
      if (!incoming || Object.keys(incoming).length === 0) return existing;
      return { ...existing, ...incoming };
    },
  }),

  // === IDENTITY (immutable per request chain) ===
  threadId: Annotation<string>({
    default: () => '',
    reducer: (existing, update) => update || existing,
  }),

  traceId: Annotation<string>({
    default: () => '',
    reducer: (existing, update) => {
      if (existing) return existing; // Immutable once set
      return update || existing;
    },
  }),

  // === IDEMPOTENCY LEDGER (PII-safe, persistent) ===
  executedOperations: Annotation<Record<string, ExecutedOperation>>({
    default: () => ({}),
    reducer: (existing, incoming) => {
      if (!incoming || Object.keys(incoming).length === 0) return existing;
      return { ...existing, ...incoming };
    },
  }),

  // === RESOLVER RESULTS ===
  resolverResults: Annotation<Map<string, ResolverResult>>({
    default: () => new Map(),
    // Reducer: merge maps
    reducer: (existing, incoming) => {
      if (!incoming || incoming.size === 0) return existing;
      const merged = new Map(existing);
      incoming.forEach((v, k) => merged.set(k, v));
      return merged;
    },
  }),

  // === EXECUTOR ARGS (resolved from EntityResolutionNode) ===
  executorArgs: Annotation<Map<string, any>>({
    default: () => new Map(),
    reducer: (existing, incoming) => {
      if (!incoming || incoming.size === 0) return existing;
      const merged = new Map(existing);
      incoming.forEach((v, k) => merged.set(k, v));
      return merged;
    },
  }),

  // === EXECUTION RESULTS ===
  executionResults: Annotation<Map<string, ExecutionResult>>({
    default: () => new Map(),
    reducer: (existing, incoming) => {
      if (!incoming || incoming.size === 0) return existing;
      const merged = new Map(existing);
      incoming.forEach((v, k) => merged.set(k, v));
      return merged;
    },
  }),

  // === RUNNING CONTEXT (for multi-step) ===
  refs: Annotation<StateRefs>({
    default: () => ({}),
    // Reducer: shallow merge
    reducer: (existing, incoming) => ({ ...existing, ...incoming }),
  }),

  // === RESPONSE ===
  formattedResponse: Annotation<FormattedResponse | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  finalResponse: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === CONTROL ===
  error: Annotation<string | undefined>({
    default: () => undefined,
    reducer: (_, update) => update,
  }),

  // === LLM STEPS (accumulated per-call trace records) ===
  llmSteps: Annotation<LLMStep[]>({
    default: () => [],
    reducer: (existing, incoming) => [...existing, ...(incoming || [])],
  }),

  // === METADATA ===
  // Nodes return **deltas only** (e.g. one nodeExecution entry, llmCalls: 1).
  // The reducer accumulates them into the running totals.
  metadata: Annotation<ExecutionMetadata>({
    default: () => ({ ...defaultMetadata, startTime: Date.now() }),
    reducer: (existing, incoming) => ({
      startTime: existing.startTime,
      nodeExecutions: [...existing.nodeExecutions, ...(incoming.nodeExecutions || [])],
      llmCalls: existing.llmCalls + (incoming.llmCalls || 0),
      totalTokens: existing.totalTokens + (incoming.totalTokens || 0),
      totalCost: existing.totalCost + (incoming.totalCost || 0),
    }),
  }),
});

// ============================================================================
// TYPE EXPORT (Inferred from Annotation)
// ============================================================================

/**
 * MemoState type - automatically inferred from Annotation
 * This ensures the type always matches the state definition
 */
export type MemoState = typeof MemoStateAnnotation.State;

// ============================================================================
// STATE FACTORY (for manual state creation if needed)
// ============================================================================

/**
 * Create an initial state with optional partial overrides
 * Useful for testing and manual state construction
 */
export function createInitialState(partial: Partial<MemoState> = {}): MemoState {
  return {
    user: partial.user || { ...defaultUser },
    authContext: partial.authContext,
    input: partial.input || { ...defaultInput },
    now: partial.now || {
      ...defaultNow,
      iso: new Date().toISOString(),
      dayOfWeek: new Date().getDay(),
      date: new Date(),
    },
    recentMessages: partial.recentMessages || [],
    longTermSummary: partial.longTermSummary,
    conversationContext: partial.conversationContext,
    latestActions: partial.latestActions || [],
    plannerOutput: partial.plannerOutput,
    routingSuggestions: partial.routingSuggestions,
    disambiguation: partial.disambiguation,
    pendingHITL: partial.pendingHITL || null,
    hitlResults: partial.hitlResults || {},
    threadId: partial.threadId || '',
    traceId: partial.traceId || '',
    executedOperations: partial.executedOperations || {},
    resolverResults: partial.resolverResults || new Map(),
    executorArgs: partial.executorArgs || new Map(),
    executionResults: partial.executionResults || new Map(),
    refs: partial.refs || {},
    formattedResponse: partial.formattedResponse,
    finalResponse: partial.finalResponse,
    error: partial.error,
    llmSteps: partial.llmSteps || [],
    metadata: partial.metadata || { ...defaultMetadata, startTime: Date.now() },
  };
}

// ============================================================================
// LEGACY EXPORT (for backward compatibility during migration)
// ============================================================================

/**
 * @deprecated Use MemoStateAnnotation directly with StateGraph
 * This export exists for backward compatibility during migration
 */
export const memoStateChannels = MemoStateAnnotation;
