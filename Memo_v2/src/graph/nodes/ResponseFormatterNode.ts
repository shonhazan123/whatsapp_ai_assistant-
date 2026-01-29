/**
 * ResponseFormatterNode
 *
 * Formats execution results for human-readable output.
 *
 * Based on V1: src/services/response/ResponseFormatter.ts
 *
 * Responsibilities:
 * - Format dates to human-readable strings
 * - Categorize tasks (overdue, today, upcoming, recurring)
 * - Build CAPABILITY-SPECIFIC response context for templating
 * - Handle Hebrew/English formatting differences
 *
 * IMPORTANT: V1 services return snake_case fields (due_date, reminder_recurrence)
 * This node uses snake_case consistently - NOT camelCase.
 */

import type {
  CalendarEventResult,
  CalendarResponseContext,
  DatabaseResponseContext,
  DatabaseTaskResult,
  FailedOperationContext,
  FormattedResponse,
  GmailResponseContext,
  GmailResult,
  PlanStep,
  ResponseContext,
  SecondBrainResponseContext,
  SecondBrainResult,
  StepResult,
} from "../../types/index.js";
import type { MemoState } from "../state/MemoState.js";
import { CodeNode } from "./BaseNode.js";

// ============================================================================
// DATE FORMATTING UTILITIES
// ============================================================================

/**
 * Format ISO date to human-readable string
 */
function formatDate(
	isoString: string,
	timezone: string,
	language: "he" | "en" | "other",
): string {
	try {
		const date = new Date(isoString);
		const now = new Date();

		// Get locale based on language
		const locale = language === "he" ? "he-IL" : "en-US";

		// Compare dates in user's timezone (sv-SE locale gives YYYY-MM-DD format for easy comparison)
		const dateInUserTz = date.toLocaleDateString("sv-SE", {
			timeZone: timezone,
		});
		const nowInUserTz = now.toLocaleDateString("sv-SE", { timeZone: timezone });

		// Check if today
		const isToday = dateInUserTz === nowInUserTz;

		// Check if tomorrow
		const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const tomorrowInUserTz = tomorrow.toLocaleDateString("sv-SE", {
			timeZone: timezone,
		});
		const isTomorrow = dateInUserTz === tomorrowInUserTz;

		// Format time
		const timeStr = date.toLocaleTimeString(locale, {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZone: timezone,
		});

		if (isToday) {
			return language === "he" ? `היום ב-${timeStr}` : `Today at ${timeStr}`;
		}

		if (isTomorrow) {
			return language === "he" ? `מחר ב-${timeStr}` : `Tomorrow at ${timeStr}`;
		}

		// Full date
		const dateStr = date.toLocaleDateString(locale, {
			weekday: "long",
			day: "numeric",
			month: "long",
			timeZone: timezone,
		});

		return `${dateStr}, ${timeStr}`;
	} catch {
		return isoString;
	}
}

/**
 * Format relative date (e.g., "2 days ago", "in 3 hours")
 */
function formatRelativeDate(
	isoString: string,
	language: "he" | "en" | "other",
): string {
	try {
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = date.getTime() - now.getTime();
		const diffMins = Math.round(diffMs / 60000);
		const diffHours = Math.round(diffMs / 3600000);
		const diffDays = Math.round(diffMs / 86400000);

		if (language === "he") {
			if (diffMins > 0 && diffMins < 60) return `בעוד ${diffMins} דקות`;
			if (diffMins < 0 && diffMins > -60)
				return `לפני ${Math.abs(diffMins)} דקות`;
			if (diffHours > 0 && diffHours < 24) return `בעוד ${diffHours} שעות`;
			if (diffHours < 0 && diffHours > -24)
				return `לפני ${Math.abs(diffHours)} שעות`;
			if (diffDays > 0) return `בעוד ${diffDays} ימים`;
			if (diffDays < 0) return `לפני ${Math.abs(diffDays)} ימים`;
			return "עכשיו";
		}

		if (diffMins > 0 && diffMins < 60) return `in ${diffMins} minutes`;
		if (diffMins < 0 && diffMins > -60)
			return `${Math.abs(diffMins)} minutes ago`;
		if (diffHours > 0 && diffHours < 24) return `in ${diffHours} hours`;
		if (diffHours < 0 && diffHours > -24)
			return `${Math.abs(diffHours)} hours ago`;
		if (diffDays > 0) return `in ${diffDays} days`;
		if (diffDays < 0) return `${Math.abs(diffDays)} days ago`;
		return "now";
	} catch {
		return isoString;
	}
}

/**
 * Check if a value is a Date object
 */
function isDateObject(value: any): value is Date {
	return value instanceof Date && !isNaN(value.getTime());
}

/**
 * Convert a date value (Date object or ISO string) to ISO string
 */
function toISOString(value: any): string | null {
	if (isDateObject(value)) {
		return value.toISOString();
	}
	if (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
	) {
		return value;
	}
	return null;
}

/**
 * Recursively format dates in an object
 * Handles both Date objects (from PostgreSQL) and ISO strings
 */
function formatDatesInObject(
	obj: any,
	timezone: string,
	language: "he" | "en" | "other",
): any {
	if (obj === null || obj === undefined) return obj;

	// Handle Date objects directly (PostgreSQL returns dates as Date objects)
	if (isDateObject(obj)) {
		return formatDate(obj.toISOString(), timezone, language);
	}

	// Handle ISO date strings
	if (typeof obj === "string") {
		if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(obj)) {
			return formatDate(obj, timezone, language);
		}
		return obj;
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		return obj.map((item) => formatDatesInObject(item, timezone, language));
	}

	// Handle plain objects (not Date objects)
	if (typeof obj === "object") {
		const formatted: Record<string, any> = {};
		const dateFields = [
			"start",
			"end",
			"due_date",
			"created_at",
			"updated_at",
			"next_reminder_at", // snake_case from V1
			"dueDate",
			"createdAt",
			"updatedAt",
			"reminderTime", // camelCase fallback
		];
		const preserveFields = [
			"days",
			"startTime",
			"endTime",
			"recurrence",
			"reminder_recurrence",
		];

		for (const [key, value] of Object.entries(obj)) {
			if (dateFields.includes(key)) {
				// For date fields: keep original ISO string, add formatted version
				const isoString = toISOString(value);
				if (isoString) {
					formatted[key] = isoString; // Always store as ISO string
					formatted[`${key}_formatted`] = formatDate(
						isoString,
						timezone,
						language,
					);
				} else {
					// Not a valid date, just copy the value
					formatted[key] = value;
					formatted[`${key}_formatted`] = value;
				}
			} else if (preserveFields.includes(key)) {
				// Preserve recurring event parameters as-is (not dates, don't format)
				formatted[key] = value;
			} else {
				// Recursively process other fields
				formatted[key] = formatDatesInObject(value, timezone, language);
			}
		}
		return formatted;
	}

	return obj;
}

// ============================================================================
// TASK CATEGORIZATION
// ============================================================================

interface CategorizedTasks {
	overdue: DatabaseTaskResult[];
	today: DatabaseTaskResult[];
	upcoming: DatabaseTaskResult[];
	recurring: DatabaseTaskResult[];
	noDueDate: DatabaseTaskResult[];
}

/**
 * Categorize tasks by their due date status
 * IMPORTANT: V1 TaskService returns snake_case fields (due_date, reminder_recurrence)
 */
function categorizeTasks(tasks: DatabaseTaskResult[]): CategorizedTasks {
	const now = new Date();
	const todayEnd = new Date(now);
	todayEnd.setHours(23, 59, 59, 999);

	const categories: CategorizedTasks = {
		overdue: [],
		today: [],
		upcoming: [],
		recurring: [],
		noDueDate: [],
	};

	for (const task of tasks) {
		// Check for recurring tasks - use snake_case from V1
		if (task.reminder_recurrence) {
			categories.recurring.push(task);
			continue;
		}

		// Check due date - use snake_case from V1
		if (!task.due_date) {
			categories.noDueDate.push(task);
			continue;
		}

		const dueDate = new Date(task.due_date);

		if (dueDate < now) {
			categories.overdue.push(task);
		} else if (dueDate <= todayEnd) {
			categories.today.push(task);
		} else {
			categories.upcoming.push(task);
		}
	}

	return categories;
}

// ============================================================================
// RESPONSE FORMATTER NODE
// ============================================================================

export class ResponseFormatterNode extends CodeNode {
	readonly name = "response_formatter";

	protected async process(state: MemoState): Promise<Partial<MemoState>> {
		const executionResults = state.executionResults;
		const plan = state.plannerOutput?.plan || [];
		const language = state.user.language;
		const timezone = state.user.timezone;

		console.log(
			`[ResponseFormatter] Formatting ${executionResults.size} results`,
		);

		// Determine primary operation from plan
		const primaryStep = plan[0];
		const capability = primaryStep?.capability || "general";
		const action = primaryStep?.action || "respond";

		// Collect successful data AND failed operations
		const allData: any[] = [];
		const failedOperations: FailedOperationContext[] = [];

		for (const [stepId, result] of executionResults) {
			if (result.success && result.data) {
				allData.push(result.data);
			} else if (!result.success) {
				// Build failed operation context
				const step = plan.find((s) => s.id === stepId);
				const failedOp = this.buildFailedOperationContext(
					stepId,
					result.error || "Unknown error",
					step,
					state,
				);
				failedOperations.push(failedOp);
				console.log(
					`[ResponseFormatter] Captured failed operation: ${failedOp.capability}/${failedOp.operation} - ${failedOp.errorMessage}`,
				);
			}
		}

		// Skip formatting for general responses (no function calls, already LLM-generated)
		// General responses come from GeneralResolver and already have response text in data.response
		if (capability === "general") {
			console.log(
				"[ResponseFormatter] Skipping formatting for general response (already LLM-generated)",
			);

			// For general responses, we still create a FormattedResponse but with minimal processing
			const formattedResponse: FormattedResponse = {
				agent: capability,
				operation: action,
				entityType: "message",
				rawData: allData,
				formattedData: allData, // No date formatting needed
				context: {
					capability: "general",
					// No capability-specific context for general responses
				},
				failedOperations:
					failedOperations.length > 0 ? failedOperations : undefined,
			};

			return {
				formattedResponse,
			};
		}

		// For function call results (calendar, database, gmail, second-brain), format dates and categorize

		// Build response context for primary capability (backward compatibility)
		const context = this.buildResponseContext(allData, capability, action);

		// Format dates in all data
		const formattedData = formatDatesInObject(allData, timezone, language);

		// Build per-step results for multi-capability responses
		const stepResults: StepResult[] = [];

		for (const [stepId, result] of executionResults) {
			if (result.success && result.data) {
				const step = plan.find((s) => s.id === stepId);
				if (step) {
					// Build context for THIS specific step's capability
					const stepContext = this.buildResponseContext(
						[result.data],
						step.capability,
						step.action,
					);

					stepResults.push({
						stepId,
						capability: step.capability,
						action: step.action,
						data: formatDatesInObject(result.data, timezone, language),
						context: stepContext,
					});
				}
			}
		}

		// Detect if this is a multi-capability response (different capabilities involved)
		const uniqueCapabilities = new Set(stepResults.map((sr) => sr.capability));
		const isMultiCapability = uniqueCapabilities.size > 1;

		// Build formatted response
		const formattedResponse: FormattedResponse = {
			agent: capability,
			operation: action,
			entityType: this.determineEntityType(capability, action),
			rawData: allData,
			formattedData,
			context,
			failedOperations:
				failedOperations.length > 0 ? failedOperations : undefined,
			// Only include stepResults if multiple capabilities are involved
			stepResults: isMultiCapability ? stepResults : undefined,
		};

		console.log(
			`[ResponseFormatter] Built response for ${capability}:${action}` +
				(isMultiCapability
					? ` (multi-capability: ${Array.from(uniqueCapabilities).join(", ")})`
					: "") +
				(failedOperations.length > 0
					? ` with ${failedOperations.length} failed operation(s)`
					: ""),
		);

		return {
			formattedResponse,
		};
	}

	/**
	 * Build context for a failed operation
	 */
	private buildFailedOperationContext(
		stepId: string,
		errorMessage: string,
		step: PlanStep | undefined,
		state: MemoState,
	): FailedOperationContext {
		const capability = step?.capability || "unknown";
		const action = step?.action || "unknown";

		// Try to extract what was searched for from step constraints or error message
		let searchedFor: string | undefined;
		if (step?.constraints) {
			// Common fields that might contain what was being searched
			searchedFor =
				step.constraints.text ||
				step.constraints.title ||
				step.constraints.query ||
				step.constraints.eventTitle ||
				step.constraints.taskName ||
				step.constraints.name;
		}

		// Try to extract from error message if not found in constraints
		if (!searchedFor) {
			// Pattern: "Task 'xxx' not found" or "No event matching 'xxx'"
			const quotedMatch = errorMessage.match(/['"]([^'"]+)['"]/);
			if (quotedMatch) {
				searchedFor = quotedMatch[1];
			}
		}

		// Get user's original request from input
		const userRequest =
			step?.constraints?.rawMessage ||
			state.input?.message ||
			state.input?.enhancedMessage ||
			"Unknown request";

		return {
			stepId,
			capability,
			operation: action,
			searchedFor,
			userRequest,
			errorMessage,
		};
	}

	// ============================================================================
	// DATA EXTRACTION UTILITIES
	// Handle various response structures from ServiceAdapters
	// ============================================================================

	/**
	 * Extract items array from various response structures
	 * Handles: { events: [...] }, { tasks: [...] }, single items, or raw arrays
	 *
	 * This normalizes the different response formats from ServiceAdapters:
	 * - getEvents returns: { events: [...], count: N }
	 * - create returns: { id, summary, start, ... }
	 * - deleteByWindow returns: { deleted: N, events: [...], summaries: [...] }
	 */
	private extractItemsArray(data: any, capability: string): any[] {
		if (!data) return [];
		if (Array.isArray(data)) return data;

		// Capability-specific wrapper patterns
		switch (capability) {
			case "calendar":
				if (data.events)
					return Array.isArray(data.events) ? data.events : [data.events];
				break;
			case "database":
				if (data.tasks)
					return Array.isArray(data.tasks) ? data.tasks : [data.tasks];
				if (data.lists)
					return Array.isArray(data.lists) ? data.lists : [data.lists];
				if (data.created)
					return Array.isArray(data.created) ? data.created : [data.created];
				break;
			case "gmail":
				if (data.emails)
					return Array.isArray(data.emails) ? data.emails : [data.emails];
				if (data.messages)
					return Array.isArray(data.messages) ? data.messages : [data.messages];
				break;
			case "second-brain":
				if (data.results)
					return Array.isArray(data.results) ? data.results : [data.results];
				if (data.memories)
					return Array.isArray(data.memories) ? data.memories : [data.memories];
				break;
		}

		// Single item with known identifier fields - wrap in array
		if (data.id || data.summary || data.text || data.messageId) {
			return [data];
		}

		return [];
	}

	/**
	 * Extract metadata from bulk operation responses
	 * Returns: { deleted, updated, errors, isRecurringSeries, count, etc. }
	 *
	 * This preserves important metadata that would otherwise be lost when extracting items array
	 */
	private extractMetadata(data: any): Record<string, any> {
		if (!data || Array.isArray(data)) return {};

		const meta: Record<string, any> = {};

		// Bulk operation counts
		if (typeof data.deleted === "number") meta.deleted = data.deleted;
		if (typeof data.updated === "number") meta.updated = data.updated;
		if (typeof data.count === "number") meta.count = data.count;

		// Error information
		if (data.errors) meta.errors = data.errors;
		if (data.notFound) meta.notFound = data.notFound;

		// Recurring series flag (can be on wrapper or on items)
		if (data.isRecurringSeries !== undefined)
			meta.isRecurringSeries = data.isRecurringSeries;

		// Summaries for bulk delete
		if (data.summaries) meta.summaries = data.summaries;

		return meta;
	}

	// ============================================================================
	// CAPABILITY-SPECIFIC CONTEXT EXTRACTORS
	// Each capability has its own extraction logic with clear field expectations
	// ============================================================================

	/**
	 * Extract context from Database execution results
	 * V1 TaskService returns snake_case fields: due_date, reminder_recurrence, etc.
	 *
	 * Handles various response formats:
	 * - Array of tasks directly
	 * - { tasks: [...] } wrapper
	 * - { created: [...] } for createMultiple
	 * - Single task object
	 */
	private extractDatabaseContext(
		data: any, // Raw data from executor - may be wrapped
		action: string,
	): DatabaseResponseContext {
		// Extract items array from various wrapper structures
		const items = this.extractItemsArray(
			data,
			"database",
		) as DatabaseTaskResult[];
		const meta = this.extractMetadata(data);

		const context: DatabaseResponseContext = {
			isReminder: false,
			isTask: false,
			isNudge: false,
			isRecurring: false,
			hasDueDate: false,
			isToday: false,
			isTomorrowOrLater: false,
			isOverdue: false,
			isListing: action === "getAll",
			isEmpty: items.length === 0,
		};

		const now = new Date();
		const todayEnd = new Date(now);
		todayEnd.setHours(23, 59, 59, 999);

		for (const item of items) {
			// Use due_date (snake_case from V1) - NOT dueDate
			if (item.due_date) {
				context.hasDueDate = true;
				context.isReminder = true;

				const date = new Date(item.due_date);
				if (date < now) {
					context.isOverdue = true;
				} else if (date <= todayEnd) {
					context.isToday = true;
				} else {
					context.isTomorrowOrLater = true;
				}
			} else {
				context.isTask = true;
			}

			// Use reminder_recurrence (snake_case from V1)
			if (item.reminder_recurrence) {
				context.isRecurring = true;
				if (item.reminder_recurrence.type === "nudge") {
					context.isNudge = true;
				}
			}
		}

		console.log(
			`[ResponseFormatter] Database context: isReminder=${context.isReminder}, hasDueDate=${context.hasDueDate}, isToday=${context.isToday}, itemCount=${items.length}`,
		);
		return context;
	}

	/**
	 * Extract context from Calendar execution results
	 *
	 * Handles various response formats:
	 * - { events: [...], count: N } from getEvents
	 * - { id, summary, start, ... } single event from create/update
	 * - { deleted: N, events: [...] } from deleteByWindow
	 * - { isRecurringSeries: true, ... } from recurring series operations
	 */
	private extractCalendarContext(
		data: any, // Raw data from executor - may be wrapped
		action: string,
	): CalendarResponseContext {
		// Extract items array from various wrapper structures
		const events = this.extractItemsArray(
			data,
			"calendar",
		) as CalendarEventResult[];
		const meta = this.extractMetadata(data);

		const context: CalendarResponseContext = {
			isRecurring: false,
			isRecurringSeries: meta.isRecurringSeries || false, // Check metadata first (from wrapper)
			isToday: false,
			isTomorrowOrLater: false,
			isListing: action === "getEvents",
			isBulkOperation:
				action === "deleteByWindow" || action === "updateByWindow",
			isEmpty: events.length === 0,
		};

		const now = new Date();
		const todayEnd = new Date(now);
		todayEnd.setHours(23, 59, 59, 999);

		for (const item of events) {
			// Check recurring series - isRecurringSeries indicates successful series operation
			if (item.isRecurringSeries === true) {
				context.isRecurring = true;
				context.isRecurringSeries = true;
			}

			// Check for recurring patterns:
			// 1. days array or recurrence field (from createRecurring)
			// 2. recurringEventId (from getEvents - indicates instance of recurring series)
			if (
				item.recurrence ||
				(Array.isArray(item.days) && item.days.length > 0) ||
				item.recurringEventId
			) {
				context.isRecurring = true;
			}

			// Check start date
			if (item.start) {
				const date = new Date(item.start);
				if (date <= todayEnd && date >= now) {
					context.isToday = true;
				} else if (date > todayEnd) {
					context.isTomorrowOrLater = true;
				}
			}
		}

		console.log(
			`[ResponseFormatter] Calendar context: isRecurring=${context.isRecurring}, isRecurringSeries=${context.isRecurringSeries}, eventCount=${events.length}`,
		);
		return context;
	}

	/**
	 * Extract context from Gmail execution results
	 *
	 * Handles various response formats:
	 * - { emails: [...] } from listEmails
	 * - { messageId, preview: true, ... } from sendPreview
	 * - Single email object from send/reply
	 */
	private extractGmailContext(
		data: any, // Raw data from executor - may be wrapped
		action: string,
	): GmailResponseContext {
		// Extract items array from various wrapper structures
		const emails = this.extractItemsArray(data, "gmail") as GmailResult[];
		const meta = this.extractMetadata(data);

		const context: GmailResponseContext = {
			isPreview: false,
			isSent: false,
			isReply: action === "reply",
			isListing: action === "listEmails",
			isEmpty: emails.length === 0,
		};

		for (const item of emails) {
			if (item.preview === true) {
				context.isPreview = true;
			}
		}

		if (action === "sendConfirm") {
			context.isSent = true;
		}

		console.log(
			`[ResponseFormatter] Gmail context: isPreview=${context.isPreview}, isSent=${context.isSent}, emailCount=${emails.length}`,
		);
		return context;
	}

	/**
	 * Extract context from Second Brain execution results
	 *
	 * Handles various response formats:
	 * - Array of results from searchMemory
	 * - { id, text, ... } single memory from storeMemory
	 * - { results: [...] } wrapper
	 */
	private extractSecondBrainContext(
		data: any, // Raw data from executor - may be wrapped
		action: string,
	): SecondBrainResponseContext {
		// Extract items array from various wrapper structures
		const memories = this.extractItemsArray(
			data,
			"second-brain",
		) as SecondBrainResult[];
		const meta = this.extractMetadata(data);

		const context: SecondBrainResponseContext = {
			isStored: action === "storeMemory",
			isSearch: action === "searchMemory",
			isEmpty: memories.length === 0,
		};

		console.log(
			`[ResponseFormatter] SecondBrain context: isStored=${context.isStored}, isSearch=${context.isSearch}, memoryCount=${memories.length}`,
		);
		return context;
	}

	// ============================================================================
	// MAIN CONTEXT BUILDER - Routes to capability-specific extractors
	// ============================================================================

	/**
	 * Build context information for response generation
	 * Routes to capability-specific extractors based on the capability
	 *
	 * Note: Each extractor handles its own data unwrapping via extractItemsArray(),
	 * so we pass raw data here without type casting.
	 */
	private buildResponseContext(
		data: any[],
		capability: string,
		action: string,
	): ResponseContext {
		const context: ResponseContext = {
			capability: capability as ResponseContext["capability"],
		};

		// For single-item data arrays, pass the first item directly
		// This handles cases where allData = [{ events: [...] }] from a single execution result
		const rawData = data.length === 1 ? data[0] : data;

		switch (capability) {
			case "database":
				context.database = this.extractDatabaseContext(rawData, action);
				break;
			case "calendar":
				context.calendar = this.extractCalendarContext(rawData, action);
				break;
			case "gmail":
				context.gmail = this.extractGmailContext(rawData, action);
				break;
			case "second-brain":
				context.secondBrain = this.extractSecondBrainContext(rawData, action);
				break;
			default:
				// General capability - no specific context needed
				console.log(
					`[ResponseFormatter] General capability - no specific context extraction`,
				);
		}

		return context;
	}

	/**
	 * Determine entity type from capability and action
	 */
	private determineEntityType(capability: string, action: string): string {
		switch (capability) {
			case "calendar":
				return "event";
			case "database":
				if (action.includes("list")) return "list";
				return "task";
			case "gmail":
				return "email";
			case "second-brain":
				return "memory";
			default:
				return "message";
		}
	}
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createResponseFormatterNode() {
	const node = new ResponseFormatterNode();
	return node.asNodeFunction();
}

// Export utilities for testing
export { categorizeTasks, formatDate, formatDatesInObject, formatRelativeDate };
