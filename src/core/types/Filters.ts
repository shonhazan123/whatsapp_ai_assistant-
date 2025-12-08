/**
 * Filter type definitions for bulk operations
 * Used by SQL compiler to generate WHERE clauses
 */

export interface TaskFilter {
	q?: string;
	category?: string | string[];
	completed?: boolean;
	dueDateFrom?: string;
	dueDateTo?: string;
	window?: "today" | "tomorrow" | "this_week" | "next_week" | "overdue";
	reminderRecurrence?: "none" | "any" | "daily" | "weekly" | "monthly";
	reminder?: boolean;
	ids?: string[];
	limit?: number;
	offset?: number;
	sortBy?: "created_at" | "due_date";
	sortDir?: "asc" | "desc";
}

export interface ListFilter {
	q?: string;  // Search in list_name or content
	list_name?: string;  // Filter by title
	is_checklist?: boolean;  // Filter by type (note vs checklist)
	content?: string;  // Search in content text
	ids?: string[];
	limit?: number;
	offset?: number;
}

export interface BulkPatch {
	[key: string]: any;
}

export interface BulkOperationOptions {
	preview?: boolean;
} 
