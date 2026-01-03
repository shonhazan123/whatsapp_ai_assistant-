# Memo V2 — State Schema Reference

> Complete TypeScript type definitions for the LangGraph state

---

## Core State

```typescript
/**
 * Main state object that flows through the LangGraph
 * All nodes read from and write to this state
 */
export interface MemoState {
	// ============================================
	// USER CONTEXT
	// Populated by: ContextAssemblyNode
	// Read by: All nodes
	// ============================================
	user: UserContext;

	// ============================================
	// INPUT
	// Populated by: ContextAssemblyNode, ReplyContextNode
	// Read by: PlannerNode, Resolvers
	// ============================================
	input: InputContext;

	// ============================================
	// TIME CONTEXT
	// Populated by: ContextAssemblyNode
	// Read by: PlannerNode, Resolvers, ResponseFormatter
	// ============================================
	now: TimeContext;

	// ============================================
	// MEMORY
	// Populated by: ContextAssemblyNode
	// Updated by: MemoryUpdateNode
	// ============================================
	recent_messages: ConversationMessage[];
	long_term_summary?: string;

	// ============================================
	// PLANNER OUTPUT
	// Populated by: PlannerNode
	// Read by: HITLGateNode, ResolverRouterNode
	// ============================================
	planner_output?: PlannerOutput;

	// ============================================
	// DISAMBIGUATION
	// Populated by: Resolvers, HITLGateNode
	// Read by: ReplyContextNode
	// Cleared by: ReplyContextNode (on resolution)
	// ============================================
	disambiguation?: DisambiguationState;

	// ============================================
	// RESOLVER RESULTS
	// Populated by: Resolver nodes
	// Read by: Executor nodes
	// ============================================
	resolver_results: Record<string, ResolverResult>;

	// ============================================
	// EXECUTION RESULTS
	// Populated by: Executor nodes
	// Read by: JoinNode, ResponseFormatterNode
	// ============================================
	execution_results: Record<string, ExecutionResult>;

	// ============================================
	// RUNNING CONTEXT (for multi-step flows)
	// Populated by: Resolvers, Executors
	// Read by: Resolvers (for dependent steps)
	// ============================================
	refs: EntityReferences;

	// ============================================
	// RESPONSE
	// Populated by: ResponseFormatterNode, ResponseWriterNode
	// Read by: Webhook (final output)
	// ============================================
	formatted_response?: FormattedResponse;
	final_response?: string;

	// ============================================
	// CONTROL FLAGS
	// Note: HITL pause/resume handled by LangGraph interrupt()
	// The should_pause/pause_reason fields have been REMOVED
	// ============================================
	error?: ErrorInfo;

	// ============================================
	// METADATA
	// Populated by: All nodes (via BaseNode)
	// Read by: Logging, cost tracking
	// ============================================
	metadata: ExecutionMetadata;
}
```

---

## User Context

```typescript
export interface UserContext {
	/** WhatsApp phone number (normalized) */
	phone: string;

	/** User's timezone (IANA format) */
	timezone: string;

	/** Detected or stored language preference */
	language: "he" | "en" | "other";

	/** User subscription tier */
	planTier: "free" | "pro" | "enterprise";

	/** Whether Google account is connected */
	googleConnected: boolean;

	/** Capability access (based on tier + connections) */
	capabilities: CapabilityAccess;
}

export interface CapabilityAccess {
	calendar: boolean;
	gmail: boolean;
	database: boolean;
	secondBrain: boolean;
}
```

---

## Input Context

```typescript
export interface InputContext {
	/** Original user message */
	message: string;

	/** Enhanced message (with reply/image context added) */
	enhancedMessage?: string;

	/** How this request was triggered */
	triggerType: TriggerType;

	/** WhatsApp message ID */
	whatsappMessageId?: string;

	/** ID of message being replied to (if any) */
	replyToMessageId?: string;

	/** Image analysis context (if recent image) */
	imageContext?: ImageContext;

	/** Audio transcription (if voice message) */
	audioTranscription?: string;
}

export type TriggerType =
	| "user" // Regular WhatsApp message
	| "cron" // Scheduled job (morning brief)
	| "nudge" // Nudge reminder
	| "event"; // Event-triggered (overdue task)

export interface ImageContext {
	/** Unique image identifier */
	imageId: string;

	/** Analysis result from GPT-4V */
	analysisResult: ImageAnalysisResult;

	/** Type classification */
	imageType: "structured" | "random";

	/** When analysis was performed */
	extractedAt: number;
}

export interface ImageAnalysisResult {
	/** General description */
	description: string;

	/** Extracted structured data (tasks, events, items) */
	extractedData?: {
		tasks?: string[];
		events?: Array<{
			title: string;
			date?: string;
			time?: string;
		}>;
		items?: string[];
	};

	/** Raw text extracted from image */
	extractedText?: string;
}
```

---

## Time Context

```typescript
export interface TimeContext {
	/**
	 * Human-readable format for prompts
	 * Example: "[Current time: Thursday, 02/01/2026 15:30 (2026-01-02T13:30:00.000Z), Timezone: Asia/Jerusalem]"
	 */
	formatted: string;

	/** ISO 8601 timestamp */
	iso: string;

	/** User's timezone (IANA format) */
	timezone: string;

	/** Day of week (0=Sunday, 6=Saturday) */
	dayOfWeek: number;

	/** Day name in user's language */
	dayName: string;

	/** Locale-formatted date */
	localDate: string;

	/** Locale-formatted time */
	localTime: string;
}
```

---

## Conversation Memory

```typescript
export interface ConversationMessage {
	/** Message role */
	role: "user" | "assistant" | "system";

	/** Message content */
	content: string;

	/** Unix timestamp (ms) */
	timestamp: number;

	/** WhatsApp message ID */
	whatsappMessageId?: string;

	/** ID of message being replied to */
	replyToMessageId?: string;

	/** Estimated token count */
	estimatedTokens: number;

	/** Additional metadata */
	metadata?: MessageMetadata;
}

export interface MessageMetadata {
	/** Disambiguation context if this message triggered one */
	disambiguationContext?: DisambiguationContext;

	/** Recent tasks for reference */
	recentTasks?: RecentTaskSnapshot[];

	/** Image context if attached */
	imageContext?: ImageContext;

	/** Function call result (for assistant messages) */
	functionResult?: any;
}

export interface RecentTaskSnapshot {
	id: string;
	text: string;
	completed: boolean;
	dueDate?: string;
}

export interface DisambiguationContext {
	type: EntityType;
	query: string;
	candidates: DisambiguationCandidate[];
	createdAt: number;
	expiresAt: number;
}
```

---

## Planner Output

```typescript
export interface PlannerOutput {
	/** Type of intent detected */
	intent_type: IntentType;

	/** Confidence score (0.0 - 1.0) */
	confidence: number;

	/** Risk assessment */
	risk_level: RiskLevel;

	/** Whether explicit user approval is needed */
	needs_approval: boolean;

	/** Fields that need clarification */
	missing_fields: string[];

	/** Execution plan */
	plan: PlanStep[];
}

export type IntentType =
	| "operation" // Actions (create, update, delete, etc.)
	| "conversation" // Pure questions, advice, brainstorming
	| "meta"; // Questions about Memo itself

export type RiskLevel = "low" | "medium" | "high";

export interface PlanStep {
	/** Unique step identifier */
	id: string;

	/** Target capability */
	capability: CapabilityName;

	/** Semantic action (not the function name) */
	action: string;

	/** Search/filter constraints (for finding entities) */
	constraints: Record<string, any>;

	/** Changes to apply (for mutations) */
	changes: Record<string, any>;

	/** Dependencies on other steps */
	depends_on: string[];
}

export type CapabilityName =
	| "calendar"
	| "database"
	| "gmail"
	| "second-brain"
	| "general"
	| "meta";
```

---

## Disambiguation State

```typescript
export interface DisambiguationState {
	/** Entity type being disambiguated */
	type: EntityType;

	/** Candidates to choose from */
	candidates: DisambiguationCandidate[];

	/** Which resolver step triggered this */
	resolver_step_id: string;

	/** User's selection (filled after interrupt() resumes) */
	userSelection?: string;

	/** Whether disambiguation has been resolved */
	resolved: boolean;
}

export type EntityType =
	| "calendar_event"
	| "task"
	| "list"
	| "email"
	| "contact";

export interface DisambiguationCandidate {
	/** Entity ID */
	id: string;

	/** Display text for user */
	displayText: string;

	/** Entity-specific data */
	[key: string]: any;
}
```

---

## Resolver & Execution Results

```typescript
export interface ResolverResult {
	/** Step ID this result is for */
	stepId: string;

	/** Result type */
	type: "execute" | "clarify";

	/** Tool call arguments (if type = 'execute') */
	args?: Record<string, any>;

	/** Function name to call */
	functionName?: string;

	/** Clarification question (if type = 'clarify') */
	question?: string;

	/** Clarification options (if type = 'clarify') */
	options?: string[];
}

export interface ExecutionResult {
	/** Step ID this result is for */
	stepId: string;

	/** Whether execution succeeded */
	success: boolean;

	/** Result data */
	data?: any;

	/** Error message if failed */
	error?: string;

	/** Execution duration in milliseconds */
	durationMs: number;

	/** Function that was called */
	functionName: string;

	/** Arguments that were passed */
	args: Record<string, any>;
}
```

---

## Entity References

```typescript
/**
 * Running context for multi-step flows
 * Allows later steps to reference results from earlier steps
 */
export interface EntityReferences {
	/** Calendar events from search */
	calendar_events?: CalendarEventRef[];

	/** Selected event ID (after disambiguation or explicit selection) */
	selected_event_id?: string;

	/** Tasks from search */
	tasks?: TaskRef[];

	/** Selected task ID */
	selected_task_id?: string;

	/** Lists from search */
	lists?: ListRef[];

	/** Selected list ID */
	selected_list_id?: string;

	/** Contacts from lookup */
	contacts?: ContactRef[];

	/** Selected contact */
	selected_contact_id?: string;

	/** Emails from search */
	emails?: EmailRef[];

	/** Selected email ID */
	selected_email_id?: string;
}

export interface CalendarEventRef {
	id: string;
	summary: string;
	start: string;
	end: string;
	isRecurring: boolean;
	recurringEventId?: string;
}

export interface TaskRef {
	id: string;
	text: string;
	completed: boolean;
	dueDate?: string;
	hasReminder: boolean;
}

export interface ListRef {
	id: string;
	listName: string;
	isChecklist: boolean;
	itemCount: number;
}

export interface ContactRef {
	id: string;
	name: string;
	email?: string;
	phone?: string;
}

export interface EmailRef {
	id: string;
	subject: string;
	from: string;
	date: string;
	snippet: string;
}
```

---

## Response Types

```typescript
export interface FormattedResponse {
	/** Which capability produced this response */
	agent: CapabilityName;

	/** What operation was performed */
	operation: string;

	/** Entity type involved */
	entityType: string;

	/** Raw data from execution */
	rawData: any;

	/** Formatted data (human-readable dates, etc.) */
	formattedData: any;

	/** Response context for formatting decisions */
	context: ResponseContext;
}

export interface ResponseContext {
	/** Is this a recurring entity? */
	isRecurring: boolean;

	/** Is this a nudge reminder? */
	isNudge: boolean;

	/** Does entity have a due date? */
	hasDueDate: boolean;

	/** Is due date today? */
	isToday: boolean;

	/** Is due date in the future? */
	isTomorrowOrLater: boolean;

	/** Number of entities affected */
	entityCount: number;

	/** Was this a bulk operation? */
	isBulk: boolean;

	/** Were there any errors? */
	hasErrors: boolean;

	/** Partial success? */
	isPartialSuccess: boolean;
}
```

---

## Control & Metadata Types

> **Note**: `PauseReason` has been **REMOVED**. HITL pause/resume is now handled by
> LangGraph's native `interrupt()` mechanism. See `InterruptPayload` below.

```typescript
/**
 * Payload passed to interrupt() when graph needs user input
 * LangGraph handles the pause/resume automatically
 */
export interface InterruptPayload {
	/** Type of interrupt */
	type: InterruptType;

	/** Question to ask user */
	question: string;

	/** Options for user to choose from (optional) */
	options?: string[];

	/** Additional metadata */
	metadata?: {
		stepId?: string;
		entityType?: EntityType;
		candidates?: DisambiguationCandidate[];
	};
}

export type InterruptType =
	| "disambiguation" // Multiple entity matches
	| "clarification" // Need more info
	| "confirmation" // Confirm destructive action
	| "approval"; // Explicit approval needed

/**
 * Execution metadata tracked across all nodes
 */
export interface ExecutionMetadata {
	/** When graph started */
	startTime: number;

	/** Per-node execution tracking */
	nodeExecutions: NodeExecution[];

	/** Total LLM calls made */
	llmCalls: number;

	/** Total tokens used */
	totalTokens: number;

	/** Total cost in USD */
	totalCost: number;
}

export interface NodeExecution {
	node: string;
	startTime: number;
	endTime: number;
	durationMs: number;
}

export interface ErrorInfo {
	/** Error type */
	type: ErrorType;

	/** Error message */
	message: string;

	/** Stack trace (dev only) */
	stack?: string;

	/** Which node failed */
	failedNode?: string;

	/** Which step failed (if resolver/executor) */
	failedStep?: string;
}

export type ErrorType =
	| "validation" // Input validation failed
	| "api_error" // External API error
	| "rate_limit" // Rate limited
	| "auth_error" // Authentication failed
	| "not_found" // Entity not found
	| "permission" // Permission denied
	| "internal"; // Internal error
```

---

## LangGraph Channel Configuration

```typescript
import { Annotation } from "@langchain/langgraph";

/**
 * LangGraph state channels configuration
 */
export const memoStateChannels = Annotation.Root({
	// Scalar values (last-write-wins)
	user: Annotation<UserContext>,
	input: Annotation<InputContext>,
	now: Annotation<TimeContext>,
	planner_output: Annotation<PlannerOutput | undefined>,
	disambiguation: Annotation<DisambiguationState | undefined>,
	refs: Annotation<EntityReferences>,
	formatted_response: Annotation<FormattedResponse | undefined>,
	final_response: Annotation<string | undefined>,
	// NOTE: should_pause and pause_reason REMOVED - using interrupt() instead
	error: Annotation<ErrorInfo | undefined>,
	long_term_summary: Annotation<string | undefined>,

	// Array with sliding window behavior
	recent_messages: Annotation<ConversationMessage[]>({
		reducer: (current, update) => {
			const merged = [...current, ...update];
			// Keep only last 10 messages, max 500 tokens
			return enforceMemoryLimits(merged, 10, 500);
		},
		default: () => [],
	}),

	// Record with merge behavior
	resolver_results: Annotation<Record<string, ResolverResult>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	execution_results: Annotation<Record<string, ExecutionResult>>({
		reducer: (current, update) => ({ ...current, ...update }),
		default: () => ({}),
	}),

	// Metadata with accumulation behavior
	metadata: Annotation<ExecutionMetadata>({
		reducer: (current, update) => ({
			...current,
			...update,
			nodeExecutions: [
				...current.nodeExecutions,
				...(update.nodeExecutions || []),
			],
			llmCalls: current.llmCalls + (update.llmCalls || 0),
			totalTokens: current.totalTokens + (update.totalTokens || 0),
			totalCost: current.totalCost + (update.totalCost || 0),
		}),
		default: () => ({
			startTime: Date.now(),
			nodeExecutions: [],
			llmCalls: 0,
			totalTokens: 0,
			totalCost: 0,
		}),
	}),
});
```

---

## Constants

```typescript
/** Maximum messages in recent_messages */
export const MAX_RECENT_MESSAGES = 10;

/** Maximum tokens in recent_messages */
export const MAX_RECENT_TOKENS = 500;

/** Maximum recent tasks to store */
export const MAX_RECENT_TASKS = 4;

/** Disambiguation expiry time (5 minutes) */
export const DISAMBIGUATION_EXPIRY_MS = 5 * 60 * 1000;

/** Conversation max age (12 hours) */
export const CONVERSATION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Confidence threshold for HITL trigger */
export const CONFIDENCE_THRESHOLD = 0.7;

/** Maximum parallel resolver executions */
export const MAX_PARALLEL_RESOLVERS = 3;
```

---

_See BLUEPRINT.md for how these types are used in the flow._
