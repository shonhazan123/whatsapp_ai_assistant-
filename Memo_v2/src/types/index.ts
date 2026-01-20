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
  candidates?: Array<{ id: string; displayText: string; entity?: any; score?: number; metadata?: Record<string, any>;[key: string]: any }>;
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
    interruptedAt?: number; // Timestamp when interrupt was triggered, for timeout tracking
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
// CAPABILITY-SPECIFIC EXECUTION RESULTS
// V1 services return snake_case fields - use ONLY snake_case, not camelCase
// ============================================================================

/**
 * Reminder recurrence pattern (matches V1 TaskService.ReminderRecurrence)
 */
export interface ReminderRecurrence {
  type: 'daily' | 'weekly' | 'monthly' | 'nudge';
  time?: string;        // "HH:mm" format (not used for nudge)
  days?: number[];      // For weekly: [0-6] where 0=Sunday
  dayOfMonth?: number;  // For monthly: 1-31
  interval?: string;    // For nudge: "10 minutes", "1 hour"
  until?: string;       // Optional ISO date string
  timezone?: string;    // Optional timezone override
}

/**
 * Database Task Result (from V1 TaskService)
 * IMPORTANT: V1 returns snake_case fields (due_date, reminder_recurrence, etc.)
 */
export interface DatabaseTaskResult {
  id: string;
  text: string;
  category?: string;
  due_date?: string;                          // snake_case from V1
  reminder?: string;                          // INTERVAL string for one-time reminders
  reminder_recurrence?: ReminderRecurrence | null;  // snake_case from V1
  next_reminder_at?: string | null;           // snake_case from V1
  nudge_count?: number;
  completed: boolean;
  created_at?: string;                        // snake_case from V1
}

/**
 * Database List Result (from V1 ListService)
 */
export interface DatabaseListResult {
  id: string;
  name: string;
  is_checklist: boolean;
  items?: Array<{ id: string; text: string; completed?: boolean }>;
  created_at?: string;
}

/**
 * Calendar Event Result (from CalendarServiceAdapter)
 */
export interface CalendarEventResult {
  id?: string;
  summary: string;
  start?: string;
  end?: string;
  htmlLink?: string;
  // For recurring events
  days?: string[];
  startTime?: string;
  endTime?: string;
  recurrence?: string;
  isRecurringSeries?: boolean;
  // For bulk operations
  deleted?: number;
  updated?: number;
  events?: CalendarEventResult[];
  summaries?: string[];
}

/**
 * Gmail Result (from GmailServiceAdapter)
 */
export interface GmailResult {
  messageId?: string;
  threadId?: string;
  from?: string;
  to?: string[];
  subject?: string;
  body?: string;
  date?: string;
  preview?: boolean;
}

/**
 * Second Brain Result (from SecondBrainServiceAdapter)
 */
export interface SecondBrainResult {
  id?: string;
  text: string;
  metadata?: Record<string, any>;
  similarity?: number;
}

// ============================================================================
// CAPABILITY-SPECIFIC RESPONSE CONTEXTS
// Each capability has its own context structure with relevant flags
// ============================================================================

/**
 * Database Response Context
 * Flags specific to task/reminder/list operations
 */
export interface DatabaseResponseContext {
  isReminder: boolean;        // Task has due_date
  isTask: boolean;            // Task has NO due_date
  isNudge: boolean;           // Has nudge-type recurrence
  isRecurring: boolean;       // Has any reminder_recurrence (daily/weekly/monthly)
  hasDueDate: boolean;        // Has due_date field
  isToday: boolean;           // due_date is today
  isTomorrowOrLater: boolean; // due_date is tomorrow or later
  isOverdue: boolean;         // due_date is in the past
  isListing: boolean;         // getAll operation
  isEmpty: boolean;           // No results returned
}

/**
 * Calendar Response Context
 * Flags specific to calendar event operations
 */
export interface CalendarResponseContext {
  isRecurring: boolean;       // Event has recurrence pattern
  isRecurringSeries: boolean; // Operating on entire recurring series
  isToday: boolean;           // Event start is today
  isTomorrowOrLater: boolean; // Event start is tomorrow or later
  isListing: boolean;         // getEvents operation
  isBulkOperation: boolean;   // deleteByWindow, updateByWindow
  isEmpty: boolean;           // No events returned
}

/**
 * Gmail Response Context
 * Flags specific to email operations
 */
export interface GmailResponseContext {
  isPreview: boolean;         // sendPreview operation
  isSent: boolean;            // sendConfirm operation
  isReply: boolean;           // reply operation
  isListing: boolean;         // listEmails operation
  isEmpty: boolean;           // No emails returned
}

/**
 * Second Brain Response Context
 * Flags specific to memory operations
 */
export interface SecondBrainResponseContext {
  isStored: boolean;          // storeMemory operation
  isSearch: boolean;          // searchMemory operation
  isEmpty: boolean;           // No results returned
}

// ============================================================================
// RESPONSE CONTEXT (Main Structure)
// ============================================================================

/**
 * Main ResponseContext - holds capability-specific nested contexts
 * Only ONE capability context will be populated based on the source
 */
export interface ResponseContext {
  // Capability indicator - tells which sub-context is populated
  capability: 'database' | 'calendar' | 'gmail' | 'second-brain' | 'general';

  // Capability-specific contexts (only the matching one is populated)
  database?: DatabaseResponseContext;
  calendar?: CalendarResponseContext;
  gmail?: GmailResponseContext;
  secondBrain?: SecondBrainResponseContext;
}

/**
 * Formatted Response (sent to ResponseWriterNode)
 */
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

