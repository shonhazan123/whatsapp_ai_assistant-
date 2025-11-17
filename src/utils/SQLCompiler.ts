import { addDays, addWeeks, endOfDay, endOfWeek, startOfDay, startOfWeek } from 'date-fns';

/**
 * SQL Compiler - Converts intent JSON filters to parameterized SQL
 * 
 * This class provides methods to:
 * - Compile WHERE clauses from filter objects
 * - Compile SET clauses for UPDATE operations
 * - Compile ORDER BY, LIMIT, OFFSET clauses
 * - Resolve date windows (today, this_week, overdue, etc.)
 */

export interface CompileWhereResult {
	whereSql: string;
	params: any[];
}

export interface CompileSetResult {
	setSql: string;
	setParams: any[];
}

export class SQLCompiler {
	// Entity-specific allowed columns registry
	private static readonly ALLOWED_COLUMNS = {
		tasks: ['text', 'category', 'due_date', 'completed', 'reminder', 'reminder_recurrence', 'next_reminder_at'],
		contacts: ['name', 'phone_number', 'email', 'address'],
		lists: ['list_name', 'content', 'is_checklist', 'items']
	};

	/**
	 * Compile WHERE clause from filter object
	 * @param entity - 'tasks' | 'contacts' | 'lists'
	 * @param userId - User UUID (always $1)
	 * @param filter - Filter object from intent JSON
	 * @returns Object with WHERE SQL and parameters
	 */
	static compileWhere(
		entity: 'tasks' | 'contacts' | 'lists',
		userId: string,
		filter: Record<string, any>
	): CompileWhereResult {
		const conditions: string[] = [];
		const params: any[] = [userId];
		let paramIndex = 1; // userId is $1

		// Start with user scoping (always required)
		const tableAlias = this.getTableAlias(entity);
		conditions.push(`${tableAlias}.${this.getUserIdColumn(entity)} = $1`);

		// Process each filter key
		for (const [key, value] of Object.entries(filter)) {
			if (value === undefined || value === null) continue;

			// Handle special filter types
			switch (key) {
				case 'window':
					// Resolve window to date range (handles its own paramIndex increments)
					const dateRange = this.resolveWindow(value as string);
					if (dateRange) {
						if (dateRange.from) {
							paramIndex++;
							conditions.push(`${tableAlias}.due_date >= $${paramIndex}`);
							params.push(dateRange.from);
						}
						if (dateRange.to) {
							paramIndex++;
							conditions.push(`${tableAlias}.due_date <= $${paramIndex}`);
							params.push(dateRange.to);
						}
					}
					// Note: paramIndex is only incremented when we actually add a condition and param
					break;

				case 'q':
					// Text search - ILIKE on searchable columns
					paramIndex++;
					const searchColumns = this.getSearchColumns(entity);
					const searchConditions = searchColumns.map(col => 
						`${tableAlias}.${col} ILIKE $${paramIndex}`
					);
					conditions.push(`(${searchConditions.join(' OR ')})`);
					params.push(`%${value}%`);
					break;

				case 'category':
					// Category filter - handle array or single value
					paramIndex++;
					if (Array.isArray(value)) {
						conditions.push(`${tableAlias}.category = ANY($${paramIndex})`);
						params.push(value);
					} else {
						conditions.push(`${tableAlias}.category = $${paramIndex}`);
						params.push(value);
					}
					break;

				case 'completed':
					// Boolean filter
					paramIndex++;
					conditions.push(`${tableAlias}.completed = $${paramIndex}`);
					params.push(value);
					break;

				case 'dueDateFrom':
					paramIndex++;
					conditions.push(`${tableAlias}.due_date >= $${paramIndex}`);
					params.push(value);
					break;

				case 'dueDateTo':
					paramIndex++;
					conditions.push(`${tableAlias}.due_date <= $${paramIndex}`);
					params.push(value);
					break;

				case 'ids':
					// ID array - IN clause
					if (Array.isArray(value) && value.length > 0) {
						paramIndex++;
						conditions.push(`${tableAlias}.id = ANY($${paramIndex})`);
						params.push(value);
					}
					break;

				case 'reminderRecurrence':
					// Reminder recurrence filter (tasks only)
					if (entity === 'tasks') {
						if (value === 'none') {
							conditions.push(`${tableAlias}.reminder_recurrence IS NULL`);
						} else if (value === 'any') {
							conditions.push(`${tableAlias}.reminder_recurrence IS NOT NULL`);
						} else if (['daily', 'weekly', 'monthly'].includes(value as string)) {
							paramIndex++;
							conditions.push(`${tableAlias}.reminder_recurrence->>'type' = $${paramIndex}`);
							params.push(value);
						}
					}
					break;

				case 'reminder':
					// Reminder presence filter (tasks only)
					if (entity === 'tasks' && typeof value === 'boolean') {
						if (value === true) {
							conditions.push(`${tableAlias}.reminder IS NOT NULL`);
						} else {
							conditions.push(`${tableAlias}.reminder IS NULL`);
						}
					}
					break;

				case 'name':
					// Contact name filter
					if (entity === 'contacts') {
						paramIndex++;
						conditions.push(`${tableAlias}.name ILIKE $${paramIndex}`);
						params.push(`%${value}%`);
					}
					break;

				case 'phone':
					// Contact phone filter
					if (entity === 'contacts') {
						paramIndex++;
						conditions.push(`${tableAlias}.phone_number ILIKE $${paramIndex}`);
						params.push(`%${value}%`);
					}
					break;

				case 'email':
					// Contact email filter
					if (entity === 'contacts') {
						paramIndex++;
						conditions.push(`${tableAlias}.email ILIKE $${paramIndex}`);
						params.push(`%${value}%`);
					}
					break;

				case 'list_name':
					// List name/title filter
					if (entity === 'lists') {
						paramIndex++;
						conditions.push(`${tableAlias}.list_name ILIKE $${paramIndex}`);
						params.push(`%${value}%`);
					}
					break;

				case 'is_checklist':
					// List type filter (checklist vs note)
					if (entity === 'lists') {
						paramIndex++;
						conditions.push(`${tableAlias}.is_checklist = $${paramIndex}`);
						params.push(value);
					}
					break;

				case 'content':
					// Content text filter (for notes)
					if (entity === 'lists') {
						paramIndex++;
						conditions.push(`${tableAlias}.content ILIKE $${paramIndex}`);
						params.push(`%${value}%`);
					}
					break;

				// Skip pagination/sorting keys (handled separately)
				case 'limit':
				case 'offset':
				case 'sortBy':
				case 'sortDir':
					break;

				default:
					// Unknown filter key - reject for safety
					console.warn(`Unknown filter key: ${key} for entity: ${entity}`);
			}
		}

		const whereSql = conditions.length > 0 ? conditions.join(' AND ') : '';

		return { whereSql, params };
	}

	/**
	 * Compile ORDER BY, LIMIT, OFFSET clauses
	 * @param filter - Filter object with sortBy, sortDir, limit, offset
	 * @returns SQL string for ORDER BY, LIMIT, OFFSET
	 */
	static compileOrderAndPaging(filter: {
		sortBy?: string;
		sortDir?: 'asc' | 'desc';
		limit?: number;
		offset?: number;
	}): string {
		const clauses: string[] = [];

		// ORDER BY
		if (filter.sortBy) {
			const sortDir = filter.sortDir || 'desc';
			clauses.push(`ORDER BY ${filter.sortBy} ${sortDir.toUpperCase()}`);
		} else {
			// Default: created_at DESC
			clauses.push('ORDER BY created_at DESC');
		}

		// LIMIT
		if (filter.limit) {
			clauses.push(`LIMIT ${filter.limit}`);
		}

		// OFFSET
		if (filter.offset) {
			clauses.push(`OFFSET ${filter.offset}`);
		}

		return clauses.join(' ');
	}

	/**
	 * Compile SET clause for UPDATE operations
	 * @param patch - Object with fields to update
	 * @param allowedColumns - List of allowed column names
	 * @param startIndex - Starting parameter index (usually 3, after userId and id)
	 * @returns Object with SET SQL and parameters
	 */
	static compileSet( patch: Record<string, any>, allowedColumns: string[] , startIndex: number): CompileSetResult {
		
		const setClauses: string[] = [];
		const setParams: any[] = [];
		let currentIndex = startIndex;

		for (const [key, value] of Object.entries(patch)) {
			// Validate column is allowed
			if (!allowedColumns.includes(key)) {
				console.warn(`Column ${key} not in allowed columns, skipping`);
				continue;
			}

			if (value !== undefined && value !== null) {
				// Handle JSONB columns (reminder_recurrence)
				if (key === 'reminder_recurrence') {
					setClauses.push(`${key} = $${currentIndex}::jsonb`);
					// If already a string, use it; otherwise stringify the object
					setParams.push(typeof value === 'string' ? value : JSON.stringify(value));
				} else {
					setClauses.push(`${key} = $${currentIndex}`);
					setParams.push(value);
				}
				currentIndex++;
			} else if (value === null && key !== undefined) {
				// Allow explicitly setting columns to NULL (useful for clearing fields in bulk updates)
				// Only if key is explicitly provided (not undefined)
				setClauses.push(`${key} = $${currentIndex}`);
				setParams.push(null);
				currentIndex++;
			}
		}

		const setSql = setClauses.join(', ');

		return { setSql, setParams };
	}

	/**
	 * Resolve window string to date range
	 * @param window - 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'overdue'
	 * @returns Object with from/to ISO date strings, or null
	 */
	private static resolveWindow(
		window: string
	): { from: string; to: string } | null {
		const now = new Date();

		switch (window) {
			case 'today': {
				const from = startOfDay(now);
				const to = endOfDay(now);
				return {
					from: from.toISOString(),
					to: to.toISOString()
				};
			}

			case 'tomorrow': {
				const tomorrow = addDays(now, 1);
				const from = startOfDay(tomorrow);
				const to = endOfDay(tomorrow);
				return {
					from: from.toISOString(),
					to: to.toISOString()
				};
			}

			case 'this_week': {
				const from = startOfWeek(now, { weekStartsOn: 0 });
				const to = endOfWeek(now, { weekStartsOn: 0 });
				return {
					from: from.toISOString(),
					to: to.toISOString()
				};
			}

			case 'next_week': {
				const nextWeek = addWeeks(now, 1);
				const from = startOfWeek(nextWeek, { weekStartsOn: 0 });
				const to = endOfWeek(nextWeek, { weekStartsOn: 0 });
				return {
					from: from.toISOString(),
					to: to.toISOString()
				};
			}

			case 'overdue': {
				const to = startOfDay(now);
				return {
					from: null as any, // No lower bound
					to: to.toISOString()
				};
			}

			default:
				return null;
		}
	}

	/**
	 * Get table alias for entity
	 */
	private static getTableAlias(entity: 'tasks' | 'contacts' | 'lists'): string {
		const aliases = {
			tasks: 't',
			contacts: 'c',
			lists: 'l'
		};
		return aliases[entity];
	}

	/**
	 * Get user ID column name for entity
	 */
	private static getUserIdColumn(entity: 'tasks' | 'contacts' | 'lists'): string {
		const columns = {
			tasks: 'user_id',
			contacts: 'user_id',
			lists: 'user_id'
		};
		return columns[entity];
	}

	/**
	 * Get columns to search for 'q' filter
	 */
	private static getSearchColumns(entity: 'tasks' | 'contacts' | 'lists'): string[] {
		const searchColumns = {
			tasks: ['text'],
			contacts: ['name', 'phone_number', 'email'],
			lists: ['list_name', 'content'] // Search in both title and content
		};
		return searchColumns[entity];
	}

	/**
	 * Get allowed columns for entity
	 */
	static getAllowedColumns(entity: 'tasks' | 'contacts' | 'lists'): string[] {
		return this.ALLOWED_COLUMNS[entity];
	}
} 
