/**
 * Core Type Definitions for Memo V2
 *
 * Defines all interfaces used across the LangGraph nodes.
 */

// Re-export canonical HITL contract types
export type {
	ExecutedOperation,
	HITLExpectedInput,
	HITLKind,
	HITLPolicySource,
	HITLResultEntry,
	HITLReturnTo,
	HITLSource,
	PendingHITL,
	PendingHITLOption,
} from './hitl.js';
export { HITL_TTL_MS } from './hitl.js';
export type { HITLReason as HITLReasonCanonical } from './hitl.js';

// ============================================================================
// USER CONTEXT
// ============================================================================

export interface UserContext {
	phone: string;
	timezone: string;
	language: "he" | "en" | "other";
	planTier: "free" | "standard" | "pro";
	googleConnected: boolean;
	/** User's display name from users.settings.user_name; set at context assembly. */
	userName?: string;
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

export type TriggerType = "user" | "cron" | "nudge" | "event";

import type { ImageAnalysisResult as ImageAnalysisResultFromImage } from "./imageAnalysis.js";

export interface ImageContext {
	imageId: string;
	analysisResult: ImageAnalysisResultFromImage;
	imageType: "structured" | "random";
	extractedAt: number;
}

/** Re-export full image analysis result type (from imageAnalysis.ts) */
export type ImageAnalysisResult = ImageAnalysisResultFromImage;

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
	language?: "he" | "en" | "other";
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
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string; // ISO string format (e.g., "2026-01-22T13:36:28.777Z")
	// Note: V1 ConversationWindow uses number (milliseconds), but ContextAssemblyNode converts to ISO string
	whatsappMessageId?: string;
	replyToMessageId?: string;
	metadata?: {
		disambiguationContext?: DisambiguationContext;
		recentTasks?: RecentTaskSnapshot[];
		imageContext?: ImageContext;
	};
}

export interface DisambiguationContext {
	type: "calendar" | "database" | "gmail" | "second-brain" | "error";

	// Machine-only disambiguation (candidates + metadata)
	candidates?: Array<{
		id: string;
		displayText: string;
		entity?: any;
		score?: number;
		metadata?: Record<string, any>;
		[key: string]: any;
	}>;
	allowMultiple?: boolean;
	disambiguationKind?:
		| "pick_one"
		| "pick_many"
		| "recurring_scope"
		| "conflict_override";

	// For errors
	error?: string;
	searchedFor?: string;
	suggestions?: string[];

	// State tracking
	resolverStepId: string;
	originalArgs?: Record<string, any>;
	userSelection?: string | number | number[];
	resolved?: boolean;
}

// ============================================================================
// INTERRUPT PAYLOAD (for LangGraph HITL)
// ============================================================================

export type InterruptType =
	| "disambiguation"
	| "clarification"
	| "confirmation"
	| "approval";
export type HITLReason =
	| "disambiguation"
	| "not_found"
	| "clarification"
	| "confirmation"
	| "approval"
	| "low_confidence"
	| "high_risk";

export interface InterruptPayload {
	type: InterruptType;
	question: string;
	options?: string[];
	metadata?: {
		stepId?: string;
		entityType?: string;
		candidates?: Array<{ id: string; displayText: string }>;
		interruptedAt?: number;
		hitlId?: string;
		kind?: import('./hitl.js').HITLKind;
		source?: import('./hitl.js').HITLSource;
		expectedInput?: import('./hitl.js').HITLExpectedInput;
		returnTo?: import('./hitl.js').HITLReturnTo;
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

export type IntentType = "operation" | "conversation" | "meta";
export type RiskLevel = "low" | "medium" | "high";
export type Capability =
	| "calendar"
	| "database"
	| "gmail"
	| "second-brain"
	| "general"
	| "meta";

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

/**
 * Routing Suggestion (from pattern matching in PlannerNode)
 * Used by HITLGateNode to generate contextual clarification messages
 */
export interface RoutingSuggestion {
	resolverName: string;
	capability: Capability;
	score: number;
	matchedPatterns: string[];
}

// ============================================================================
// RESOLVER OUTPUT
// ============================================================================

export interface ResolverResultExecute {
	stepId: string;
	type: "execute";
	args: Record<string, any>; // Tool call arguments
}

export interface ResolverResultClarify {
	stepId: string;
	type: "clarify";
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
	capability: string; // "database", "calendar", etc.
	operation: string; // "delete task", "update event", etc.
	searchedFor?: string; // What was being looked for (e.g., task name)
	userRequest: string; // Original user message for this step
	errorMessage: string; // The actual error
}

// ============================================================================
// CAPABILITY-SPECIFIC EXECUTION RESULTS
// V1 services return snake_case fields - use ONLY snake_case, not camelCase
// ============================================================================

/**
 * Reminder recurrence pattern (matches V1 TaskService.ReminderRecurrence)
 */
export interface ReminderRecurrence {
	type: "daily" | "weekly" | "monthly" | "nudge";
	time?: string; // "HH:mm" format (not used for nudge)
	days?: number[]; // For weekly: [0-6] where 0=Sunday
	dayOfMonth?: number; // For monthly: 1-31
	interval?: string; // For nudge: "10 minutes", "1 hour"
	until?: string; // Optional ISO date string
	timezone?: string; // Optional timezone override
}

/**
 * Database Task Result (from V1 TaskService)
 * IMPORTANT: V1 returns snake_case fields (due_date, reminder_recurrence, etc.)
 */
export interface DatabaseTaskResult {
	id: string;
	text: string;
	category?: string;
	due_date?: string; // snake_case from V1
	reminder?: string; // INTERVAL string for one-time reminders
	reminder_recurrence?: ReminderRecurrence | null; // snake_case from V1
	next_reminder_at?: string | null; // snake_case from V1
	nudge_count?: number;
	completed: boolean;
	created_at?: string; // snake_case from V1
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
 *
 * Note: This interface covers multiple response formats:
 * - Raw events from getEvents (id, summary, start, end, attendees, description, location, recurringEventId)
 * - Created recurring events (days, startTime, endTime, recurrence)
 * - Bulk operation results (deleted, updated, events, summaries)
 * - Series operations (isRecurringSeries)
 */
export interface CalendarEventResult {
	id?: string;
	summary: string;
	start?: string;
	end?: string;
	htmlLink?: string;
	// From V1 CalendarService.getEvents() - raw Google API fields
	attendees?: string[];
	description?: string;
	location?: string;
	recurringEventId?: string; // Present when event is instance of a recurring series
	// For created recurring events (from createRecurring)
	days?: string[];
	startTime?: string;
	endTime?: string;
	recurrence?: string;
	isRecurringSeries?: boolean; // Set when operating on entire recurring series
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
	type?: "note" | "contact" | "kv";
	content?: string;
	text?: string; // Legacy compat — prefer content
	summary?: string;
	tags?: string[];
	metadata?: Record<string, any>;
	similarity?: number;
	overridden?: boolean;
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
	isReminder: boolean; // Task has due_date
	isTask: boolean; // Task has NO due_date
	isNudge: boolean; // Has nudge-type recurrence
	isRecurring: boolean; // Has any reminder_recurrence (daily/weekly/monthly)
	hasDueDate: boolean; // Has due_date field
	isToday: boolean; // due_date is today
	isTomorrowOrLater: boolean; // due_date is tomorrow or later
	isOverdue: boolean; // due_date is in the past
	isListing: boolean; // getAll operation
	isEmpty: boolean; // No results returned
}

/**
 * Calendar Response Context
 * Flags specific to calendar event operations
 */
export interface CalendarResponseContext {
	isRecurring: boolean; // Event has recurrence pattern
	isRecurringSeries: boolean; // Operating on entire recurring series
	isToday: boolean; // Event start is today
	isTomorrowOrLater: boolean; // Event start is tomorrow or later
	isListing: boolean; // getEvents operation
	isBulkOperation: boolean; // deleteByWindow, updateByWindow
	isEmpty: boolean; // No events returned
}

/**
 * Gmail Response Context
 * Flags specific to email operations
 */
export interface GmailResponseContext {
	isPreview: boolean; // sendPreview operation
	isSent: boolean; // sendConfirm operation
	isReply: boolean; // reply operation
	isListing: boolean; // listEmails operation
	isEmpty: boolean; // No emails returned
}

/**
 * Second Brain Response Context
 * Flags specific to memory operations
 */
export interface SecondBrainResponseContext {
	isStored: boolean; // storeMemory operation
	isSearch: boolean; // searchMemory operation
	isOverride: boolean; // Memory was overridden (delete+insert)
	memoryType: "note" | "contact" | "kv" | null; // Type of memory stored/found
	isEmpty: boolean; // No results returned
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
	capability: "database" | "calendar" | "gmail" | "second-brain" | "general" | "meta";

	// Capability-specific contexts (only the matching one is populated)
	database?: DatabaseResponseContext;
	calendar?: CalendarResponseContext;
	gmail?: GmailResponseContext;
	secondBrain?: SecondBrainResponseContext;
}

/**
 * Step Result (for multi-capability responses)
 * Contains data and context for a single execution step
 */
export interface StepResult {
	stepId: string;
	capability: Capability;
	action: string;
	data: any;
	context: ResponseContext;
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
	failedOperations?: FailedOperationContext[]; // For contextual error responses
	stepResults?: StepResult[]; // For multi-capability responses (when > 1 step)
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
// AUTH CONTEXT (State-first user auth, hydrated once at graph start)
// ============================================================================

import type {
	UserRecord,
	UserGoogleToken,
	UserPlanType,
} from "../legacy/services/database/UserService.js";

// Re-export for convenience
export type { UserRecord, UserGoogleToken, UserPlanType };

/**
 * AuthContext - Full hydrated user authentication & authorization context.
 *
 * Populated ONCE by ContextAssemblyNode at graph start, then passed through
 * LangGraph shared state to all downstream nodes (executors, adapters).
 *
 * Eliminates redundant DB fetches that previously happened in every adapter.
 */
export interface AuthContext {
	/** Full DB user record (users table) */
	userRecord: UserRecord;
	/** Plan tier derived from user record */
	planTier: UserPlanType;
	/** Google OAuth tokens (null if not connected) */
	googleTokens: UserGoogleToken | null;
	/** Whether Google account is connected with valid tokens */
	googleConnected: boolean;
	/** Pre-computed capability flags (from scopes + plan) */
	capabilities: {
		calendar: boolean;
		gmail: boolean;
		database: boolean;
		secondBrain: boolean;
	};
	/** Timestamp (ms) when this context was hydrated — for staleness checks */
	hydratedAt: number;
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
