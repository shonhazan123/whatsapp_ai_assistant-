/**
 * Core Type Definitions for Memo V2
 * 
 * Defines all interfaces used across the LangGraph nodes.
 */

// ============================================================================
// USER CONTEXT
// ============================================================================

export interface UserContext {
  phone: string;
  timezone: string;
  language: 'he' | 'en' | 'other';
  planTier: 'free' | 'pro' | 'enterprise';
  googleConnected: boolean;
  capabilities: {
    calendar: boolean;
    gmail: boolean;
    database: boolean;
    secondBrain: boolean;
  };
}

// ============================================================================
// INPUT
// ============================================================================

export type TriggerType = 'user' | 'cron' | 'nudge' | 'event';

export interface ImageContext {
  imageId: string;
  analysisResult: ImageAnalysisResult;
  imageType: 'structured' | 'random';
  extractedAt: number;
}

export interface ImageAnalysisResult {
  description: string;
  extractedText?: string;
  entities?: Array<{ type: string; value: string }>;
  structuredData?: Record<string, any>;
}

export interface MessageInput {
  message: string;
  enhancedMessage?: string; // With reply/image context
  triggerType: TriggerType;
  whatsappMessageId?: string;
  replyToMessageId?: string;
  imageContext?: ImageContext;
  
  // Added for EntityResolutionNode context building
  userPhone: string;
  timezone?: string;
  language?: 'he' | 'en' | 'other';
}

// ============================================================================
// TIME CONTEXT
// ============================================================================

export interface TimeContext {
  formatted: string; // "[Current time: Day, DD/MM/YYYY HH:mm (ISO+offset), Timezone: Asia/Jerusalem]"
  iso: string;
  timezone: string;
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  date: Date; // Actual Date object for easy manipulation
}

// ============================================================================
// MEMORY
// ============================================================================

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  whatsappMessageId?: string;
  replyToMessageId?: string;
  metadata?: {
    disambiguationContext?: DisambiguationContext;
    recentTasks?: RecentTaskSnapshot[];
    imageContext?: ImageContext;
  };
}

export interface DisambiguationContext {
  type: 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error';
  
  // For disambiguation
  candidates?: Array<{ id: string; displayText: string; entity?: any; score?: number; metadata?: Record<string, any>; [key: string]: any }>;
  question?: string;
  allowMultiple?: boolean;  // "which one or both?"
  
  // For errors
  error?: string;
  searchedFor?: string;
  suggestions?: string[];
  
  // State tracking
  resolverStepId: string;
  originalArgs?: Record<string, any>;
  userSelection?: string | number | number[];  // Filled after interrupt() resumes
  resolved?: boolean;       // True after user responds
}

// ============================================================================
// INTERRUPT PAYLOAD (for LangGraph HITL)
// ============================================================================

export type InterruptType = 'disambiguation' | 'clarification' | 'confirmation' | 'approval';
export type HITLReason = 'disambiguation' | 'not_found' | 'clarification' | 'confirmation' | 'approval' | 'low_confidence' | 'high_risk';

export interface InterruptPayload {
  type: InterruptType;
  question: string;
  options?: string[];
  metadata?: {
    stepId?: string;
    entityType?: string;
    candidates?: Array<{ id: string; displayText: string }>;
  };
}

export interface RecentTaskSnapshot {
  id: string;
  text: string;
  category?: string;
  updatedAt: number;
}

// ============================================================================
// PLANNER OUTPUT
// ============================================================================

export type IntentType = 'operation' | 'conversation' | 'meta';
export type RiskLevel = 'low' | 'medium' | 'high';
export type Capability = 'calendar' | 'database' | 'gmail' | 'second-brain' | 'general' | 'meta';

export interface PlanStep {
  id: string;
  capability: Capability;
  action: string; // Semantic action like 'create_event', 'find_task', 'draft_email'
  constraints: Record<string, any>;
  changes: Record<string, any>;
  dependsOn: string[];
}

export interface PlannerOutput {
  intentType: IntentType;
  confidence: number; // 0.0 - 1.0
  riskLevel: RiskLevel;
  needsApproval: boolean;
  missingFields: string[];
  plan: PlanStep[];
}

// ============================================================================
// RESOLVER OUTPUT
// ============================================================================

export interface ResolverResultExecute {
  stepId: string;
  type: 'execute';
  args: Record<string, any>; // Tool call arguments
}

export interface ResolverResultClarify {
  stepId: string;
  type: 'clarify';
  question: string;
  options?: string[];
}

export type ResolverResult = ResolverResultExecute | ResolverResultClarify;

// ============================================================================
// EXECUTION RESULTS
// ============================================================================

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  data?: any;
  error?: string;
  durationMs: number;
}

// ============================================================================
// FAILED OPERATION CONTEXT (for contextual error responses)
// ============================================================================

export interface FailedOperationContext {
  stepId: string;
  capability: string;         // "database", "calendar", etc.
  operation: string;          // "delete task", "update event", etc.
  searchedFor?: string;       // What was being looked for (e.g., task name)
  userRequest: string;        // Original user message for this step
  errorMessage: string;       // The actual error
}

// ============================================================================
// RESPONSE
// ============================================================================

export interface ResponseContext {
  isRecurring: boolean;
  isNudge: boolean;
  hasDueDate: boolean;
  isToday: boolean;
  isTomorrowOrLater: boolean;
}

export interface FormattedResponse {
  agent: string;
  operation: string;
  entityType: string;
  rawData: any;
  formattedData: any; // With human-readable dates
  context: ResponseContext;
  failedOperations?: FailedOperationContext[];  // For contextual error responses
}

// ============================================================================
// REFS (Running Context for multi-step)
// ============================================================================

export interface StateRefs {
  calendarEvents?: any[];
  selectedEventId?: string;
  tasks?: any[];
  selectedTaskId?: string;
  contacts?: any[];
  selectedContactId?: string;
  emails?: any[];
  selectedEmailId?: string;
}

// ============================================================================
// TRIGGER INPUT (Entry point)
// ============================================================================

export interface TriggerInput {
  userPhone: string;
  message: string;
  triggerType: TriggerType;
  whatsappMessageId?: string;
  replyToMessageId?: string;
}

