# Hybrid Intent JSON → SQL Compiler Implementation Plan

**Last Updated**: 2025-01-15

---

## 🚨 CRITICAL CONSTRAINT

**ALL natural language interpretation MUST be done by the LLM, NEVER by regex or keyword matching.**

- Users may speak any language (English, Hebrew, Arabic, etc.)
- The LLM (Database Agent) must semantically understand the user's intent
- NO keyword-based parsing, NO regex patterns for interpretation
- The only place for interpretation is the LLM in `system-prompts.ts`
- Backend services only execute structured JSON from the LLM

This ensures the system works correctly for all users regardless of language.

---

## High-Level Summary

This document outlines the implementation of a hybrid "intent JSON → SQL compiler → execution" flow for the database agent codebase. Currently, the system uses ID-based operations with loop-based multiple operations in DatabaseFunction classes, and ad-hoc filtering in service getAll methods. The new architecture will:

1. **Introduce a centralized SQL compiler** that transforms structured intent JSON (not raw SQL) into parameterized SQL queries
2. **Add bulk operations** (deleteAll, updateAll, completeAll) in services using single SQL statements instead of loops
3. **Extend function parameters** to accept `where`, `patch`, and `preview` parameters for flexible bulk operations
4. **Enhance QueryResolver** to emit normalized filters when no single entity is found
5. **Maintain backward compatibility** with all existing single-item flows

This hybrid approach balances LLM flexibility (structuring intent as JSON) with database performance (single-bulk queries) while maintaining the natural language resolution layer (QueryResolver).

---

## Scope of Change — File by File

### 1. `src/utils/SQLCompiler.ts` (NEW FILE)

**Purpose**: Central SQL compiler that converts intent JSON to parameterized SQL

**What to add**:

- Class `SQLCompiler` with static methods
- `compileWhere(entity, userId, filter)`: Converts filter JSON to WHERE clause + params
- `compileOrderAndPaging(filter)`: Converts limit/offset to ORDER BY, LIMIT, OFFSET clauses
- `compileSet(patch, allowedColumns, startIndex)`: Converts update data to SET clause
- Window resolver: Maps "today", "this_week" to date ranges
- Entity-specific allowed columns registry

**Method Signatures**:

```typescript
export class SQLCompiler {
	static compileWhere(
		entity: "tasks" | "contacts" | "lists",
		userId: string,
		filter: Record<string, any>
	): { whereSql: string; params: any[] };

	static compileOrderAndPaging(filter: {
		sortBy?: string;
		sortDir?: "asc" | "desc";
		limit?: number;
		offset?: number;
	}): string;

	static compileSet(
		patch: Record<string, any>,
		allowedColumns: string[],
		startIndex: number
	): { setSql: string; setParams: any[] };

	private static resolveWindow(
		window: string
	): { from: string; to: string } | null;
	private static getAllowedColumns(
		entity: "tasks" | "contacts" | "lists"
	): string[];
}
```

**Filter Support**:

- Tasks: `q` (text search), `category`, `completed`, `dueDateFrom`, `dueDateTo`, `window`, `ids[]`
- Contacts: `q` (name/email/phone), `name`, `phone`, `email`, `ids[]`
- Lists: `q` (title search), `listType`, `ids[]`

**Safety**:

- Whitelist table/column names
- Reject unknown columns
- Always scope by `user_id = $1`

---

### 2. `src/core/types/Filters.ts` (NEW FILE)

**Purpose**: TypeScript interfaces for filter specifications

**What to add**:

```typescript
export interface TaskFilter {
	q?: string;
	category?: string | string[];
	completed?: boolean;
	dueDateFrom?: string;
	dueDateTo?: string;
	window?: "today" | "tomorrow" | "this_week" | "next_week" | "overdue";
	ids?: string[];
	limit?: number;
	offset?: number;
	sortBy?: "created_at" | "due_date";
	sortDir?: "asc" | "desc";
}

export interface ContactFilter {
	q?: string;
	name?: string;
	phone?: string;
	email?: string;
	ids?: string[];
	limit?: number;
	offset?: number;
}

export interface ListFilter {
	q?: string;
	listType?: "note" | "checklist";
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
```

---

### 3. `src/services/database/TaskService.ts` (MODIFY)

**What to add**:

1. **Import SQLCompiler and Filter types**
2. **New methods**:
   - `deleteAll(userPhone: string, filter: TaskFilter, preview?: boolean): Promise<IResponse>`
   - `updateAll(userPhone: string, filter: TaskFilter, patch: BulkPatch, preview?: boolean): Promise<IResponse>`
   - `completeAll(userPhone: string, filter: TaskFilter, preview?: boolean): Promise<IResponse>`
3. **Refactor `getAll`** to use SQLCompiler.compileWhere + compileOrderAndPaging

**Method Specifications**:

**deleteAll**:

```typescript
async deleteAll(userPhone: string, filter: TaskFilter, preview = false): Promise<IResponse>
```

- Query: `DELETE FROM tasks t WHERE user_id = $1 AND <whereClause> RETURNING t.*`
- If preview=true: `SELECT t.* FROM tasks t WHERE user_id = $1 AND <whereClause>`
- Returns affected rows

**updateAll**:

```typescript
async updateAll(userPhone: string, filter: TaskFilter, patch: BulkPatch, preview = false): Promise<IResponse>
```

- Query: `UPDATE tasks t SET <setClause> WHERE user_id = $1 AND <whereClause> RETURNING t.*`
- If preview=true: `SELECT t.* FROM tasks t WHERE user_id = $1 AND <whereClause>`
- Validate patch fields against allowed columns

**completeAll**:

```typescript
async completeAll(userPhone: string, filter: TaskFilter, preview = false): Promise<IResponse>
```

- Wrapper: calls `updateAll(userPhone, filter, { completed: true }, preview)`

**getAll refactor**:

- Use `SQLCompiler.compileWhere()` instead of manual WHERE building
- Use `SQLCompiler.compileOrderAndPaging()` for LIMIT/OFFSET
- Keep existing JOIN logic for subtasks

**Sample SQL (deleteAll)**:

```sql
DELETE FROM tasks t
WHERE t.user_id = $1
  AND t.category = $2
  AND t.due_date < $3
RETURNING t.id, t.text, t.category, t.due_date, t.completed, t.created_at;
```

**Safety**:

- Refuse bulk DELETE with empty where unless preview=true
- Log operation details for audit
- Return count of affected rows

---

### 4. `src/services/database/ContactService.ts` (MODIFY)

**What to add**:

- Mirror TaskService bulk operations:
  - `deleteAll(userPhone, filter, preview)`
  - `updateAll(userPhone, filter, patch, preview)`
- Same safety checks

**Differences**:

- Allowed columns: `name`, `phone_number`, `email`, `address`
- Filter uses `name`, `phone_number`, `email` fields

**Sample SQL (updateAll)**:

```sql
UPDATE contact_list c
SET name = $3, email = $4
WHERE c.contact_list_id = $1
  AND c.name ILIKE $2
RETURNING c.id, c.name, c.email;
```

---

### 5. `src/services/database/ListService.ts` (MODIFY)

**What to add**:

- Mirror bulk operations for lists:
  - `deleteAll(userPhone, filter, preview)`
  - `updateAll(userPhone, filter, patch, preview)`
- Content is now TEXT field (not JSONB)

**Differences**:

- Allowed columns: `list_name` (VARCHAR), `content` (TEXT), `is_checklist` (BOOLEAN), `items` (JSONB)
- Filter uses `list_name` (ILIKE search), `content` (TEXT search), `is_checklist` (boolean)

**Sample SQL (deleteAll)**:

```sql
DELETE FROM lists l
WHERE l.list_id = $1
  AND l.list_name ILIKE $2
RETURNING l.id, l.list_name, l.content, l.is_checklist;
```

---

### 6. `src/services/database/BaseService.ts` (MODIFY)

**What to modify**:

- Option 1: Import SQLCompiler and expose it to subclasses
- Option 2: Keep compiler separate (recommended)

**Recommendation**: Keep compiler as standalone utility in `src/utils/`, no changes to BaseService.

---

### 7. `src/agents/functions/DatabaseFunctions.ts` (MODIFY)

#### TaskFunction changes:

**What to modify**:

1. **Extend `parameters.operation.enum`** with: `'deleteAll'`, `'updateAll'`, `'completeAll'`
2. **Add new properties to `parameters.properties`**:

   ```typescript
   where: {
     type: 'object',
     description: 'Filter conditions for bulk operations',
     properties: {
       q: { type: 'string' },
       category: { type: 'string' },
       completed: { type: 'boolean' },
       window: { type: 'string' },
       ids: { type: 'array', items: { type: 'string' } }
     }
   },
   patch: {
     type: 'object',
     description: 'Fields to update for bulk operations'
   },
   preview: {
     type: 'boolean',
     description: 'Preview affected rows without executing'
   }
   ```

3. **Update execute() method** — Decision logic:

   ```
   IF operation is 'deleteAll'/'updateAll'/'completeAll':
     IF where provided:
       Call service bulk method
     ELSE:
       IF preview=true:
         Show warning + return error
       ELSE:
         Reject: "Empty filter not allowed for destructive bulk operations"

   ELSE IF operation is 'get'/'update'/'delete'/'complete':
     IF taskId provided:
       Use existing single-item flow
     ELSE IF where provided AND no taskId:
       Use service.getAll with filters
     ELSE IF text provided:
       Use QueryResolver.resolveOneOrAsk
       IF single entity:
         Use existing single-item flow
       ELSE IF filter available:
         Use service bulk method (ask confirmation if destructive)
       ELSE:
         Return disambiguation
   ```

4. **Safety checks**:
   - Refuse `deleteAll` with empty `where` unless `preview=true`
   - Add threshold check (if affected rows > 50, warn user)
   - Log audit: `{ entity, operation, where, patch, count }`

#### ContactFunction changes:

- Same as TaskFunction but for contacts
- Add `deleteAll`, `updateAll` operations
- Extend `where` to include `name`, `phone`, `email`

#### ListFunction changes:

- Same as ContactFunction but for lists
- Extend `where` to include `listType`

#### UserDataFunction:

- **Short-term**: Keep as is
- **Mid-term**: Consider unifying to use compiler-backed filters
- No immediate changes

---

### 8. `src/core/orchestrator/QueryResolver.ts` (MODIFY)

**What to modify**:

- Add new method: `deriveNormalizedFilter(query, domain, userId): Promise<NormalizedFilter>`

**New functionality**:

```typescript
interface NormalizedFilter {
	q?: string;
	category?: string | string[];
	completed?: boolean;
	window?: string;
	// ... entity-specific fields
}
```

**When to use**:

- When `resolveOneOrAsk` returns multiple candidates (disambiguationRequired=true)
- Extract keywords → `q`
- Dates/time phrases → `window` or `dueDateFrom`/`dueDateTo`
- "Completed"/"done" → `completed: true`
- Category synonyms → `category`

**New method signature**:

```typescript
async deriveFilterFromQuery(
  query: string,
  domain: EntityDomain,
  userPhone: string
): Promise<{
  filter: NormalizedFilter;
  confidence: number;
}>
```

**Examples**:

- "all completed work tasks" → `{ completed: true, category: "work" }`
- "tasks due this week" → `{ window: "this_week" }`
- "my shopping tasks" → `{ q: "shopping" }`

**Update `resolveOneOrAsk` return type**:

- Add optional `filter?: NormalizedFilter` when candidates.length > 1

---

### 9. `src/config/system-prompts.ts` (MODIFY)

**What to modify**: Update `getDatabaseAgentPrompt()`

**Add sections**: "BULK OPERATIONS AND FILTERS" and "TASK CREATION RULES"

```typescript
## BULK OPERATIONS WITH FILTERS:

When the user asks to modify multiple items (e.g., "delete all completed tasks", "mark all work tasks as done"), use these operations:

### Task Bulk Operations:
- **deleteAll**: Delete multiple tasks matching filter conditions
- **updateAll**: Update multiple tasks matching filter conditions
- **completeAll**: Mark multiple tasks as complete matching filter conditions

Parameters:
- **where**: Filter object to select tasks (required for destructive operations)
  - `q`: Text search in task text
  - `category`: Task category (string or array)
  - `completed`: Boolean for completion status
  - `window`: Date window ('today', 'tomorrow', 'this_week', 'next_week', 'overdue')
  - `ids`: Array of specific task IDs
- **patch**: Object with fields to update (for updateAll only)
- **preview**: Boolean to preview affected rows without executing

Examples:
- "delete all completed tasks" → deleteAll with where: { completed: true }
- "mark all work tasks done" → completeAll with where: { category: "work" }
- "show tasks due this week" → getAll with where: { window: "this_week" }

CRITICAL: Never call deleteAll/updateAll with an empty where filter unless preview=true.

## TASK CREATION RULES:

### Single vs. Multiple Task Detection:
The LLM must semantically detect whether the user is requesting one or multiple tasks. No regex or keyword parsing is used.

1. **Single Task** - Use `operation: "create"`:
   - User mentions one action: "Remind me to buy groceries"
   - Include one "task" object with text, dueDate, category

2. **Multiple Tasks** - Use `operation: "createMultiple"`:
   - User mentions multiple actions or times in one message
   - Include all tasks in a "tasks" array

### Detection Examples:
- "Remind me to take the dog out at 5 and have a haircut at 10"
  → Two tasks with different times

- "Tomorrow buy milk, call mom, and finish the report"
  → Three tasks with shared dueDate (tomorrow)

- "At 8 yoga, at 9 groceries, at 10 meeting"
  → Three tasks with different times

### Required Task Fields:
Each task must include:
- **text**: Clear task description
- **dueDate**: ISO timestamp if time is mentioned (YYYY-MM-DDTHH:mm:ssZ)
- **category**: Optional, if context implies one

### Example JSON Output:
{
  "operation": "createMultiple",
  "entity": "tasks",
  "tasks": [
    {
      "text": "Take the dog out",
      "dueDate": "2025-10-27T17:00:00Z"
    },
    {
      "text": "Have a haircut",
      "dueDate": "2025-10-27T10:00:00Z"
    }
  ]
}
```

**Update examples** to include bulk operations and multi-task creation scenarios.

---

## Intent JSON Schema (for LLM)

### Task Intent JSON:

```json
{
  "operation": "deleteAll" | "updateAll" | "completeAll" | "getAll" | "get" | "create" | "createMultiple",
  "entity": "tasks",

  // For selection, filtering, and bulk actions
  "where": {
    "q": "buy",                                     // keyword search
    "category": "work" | ["work", "family"],        // single or multiple categories
    "completed": true | false,                      // filter by completion
    "dueDateFrom": "2024-01-01T00:00:00Z",
    "dueDateTo": "2024-12-31T23:59:59Z",
    "window": "today" | "tomorrow" | "this_week" | "next_week" | "overdue",
    "ids": ["uuid1", "uuid2"]
  },

  // For updating or marking completed
  "patch": {
    "text": "Updated task text",
    "category": "personal",
    "dueDate": "2024-12-31T10:00:00Z",
    "completed": true
  },

  // For task creation
  "task": {
    "text": "Take the dog out",
    "category": "personal",
    "dueDate": "2024-12-31T17:00:00Z"
  },

  // For creating several tasks at once
  "tasks": [
    {
      "text": "Take the dog out",
      "category": "personal",
      "dueDate": "2024-12-31T17:00:00Z"
    },
    {
      "text": "Have a haircut",
      "category": "personal",
      "dueDate": "2024-12-31T10:00:00Z"
    }
  ],

  "preview": true | false,
  "limit": 50,
  "offset": 0,
  "sortBy": "created_at" | "due_date",
  "sortDir": "asc" | "desc"
}

```

### Examples:

**"Delete all completed tasks"**:

```json
{
	"operation": "deleteAll",
	"entity": "tasks",
	"where": {
		"completed": true
	}
}
```

**"Mark all work tasks as done"**:

```json
{
	"operation": "completeAll",
	"entity": "tasks",
	"where": {
		"category": "work"
	}
}
```

**"Update all overdue tasks to add reminder"**:

```json
{
	"operation": "updateAll",
	"entity": "tasks",
	"where": {
		"window": "overdue"
	},
	"patch": {
		"category": "urgent"
	}
}
```

---

## Compiler Design (SQLCompiler.ts)

### Core Functions:

#### 1. `compileWhere(entity, userId, filter)`

**Input**:

- `entity`: 'tasks' | 'contacts' | 'lists'
- `userId`: string (UUID)
- `filter`: Record<string, any>

**Output**:

```typescript
{
	whereSql: string; // "t.user_id = $1 AND t.category = $2 AND t.due_date < $3"
	params: [userId, "work", "2024-12-31"];
}
```

**Logic**:

```
1. Start with "user_id = $1"
2. For each filter key:
   - Map to column name (e.g., "window" → dueDateFrom/dueDateTo)
   - Validate against allowed columns
   - Generate condition:
     - `q` → ILIKE on text/name
     - `category` array → IN clause
     - `completed` → boolean equality
     - `window` → resolve to date range
     - `ids` → IN clause
3. Combine conditions with AND
```

**Window Resolution**:

```typescript
private static resolveWindow(window: string): { from: string; to: string } | null {
  const now = new Date();
  switch (window) {
    case 'today':
      return {
        from: startOfDay(now).toISOString(),
        to: endOfDay(now).toISOString()
      };
    case 'tomorrow':
      const tomorrow = addDays(now, 1);
      return {
        from: startOfDay(tomorrow).toISOString(),
        to: endOfDay(tomorrow).toISOString()
      };
    case 'this_week':
      return {
        from: startOfWeek(now).toISOString(),
        to: endOfWeek(now).toISOString()
      };
    case 'next_week':
      const nextWeek = addWeeks(now, 1);
      return {
        from: startOfWeek(nextWeek).toISOString(),
        to: endOfWeek(nextWeek).toISOString()
      };
    case 'overdue':
      return {
        from: null,
        to: startOfDay(now).toISOString()
      };
  }
}
```

#### 2. `compileOrderAndPaging(filter)`

**Input**: `{ sortBy, sortDir, limit, offset }`

**Output**: `"ORDER BY t.due_date DESC LIMIT 50 OFFSET 0"`

**Logic**:

- Validate sortBy against entity columns
- Default: `created_at DESC`
- Add LIMIT/OFFSET if provided

#### 3. `compileSet(patch, allowedColumns, startIndex)`

**Input**:

- `patch`: `{ text: "x", category: "work" }`
- `allowedColumns`: `["text", "category", "due_date", "completed"]`
- `startIndex`: `3` (param index where SET values start)

**Output**:

```typescript
{
  setSql: "text = $3, category = $4",
  setParams: ["x", "work"]
}
```

**Logic**:

- Iterate patch keys
- Validate against allowedColumns
- Build `column = $N` pairs
- Collect values in separate array

### Safety Registry:

```typescript
private static readonly ALLOWED_COLUMNS = {
  tasks: ['text', 'category', 'due_date', 'completed'],
  contacts: ['name', 'phone_number', 'email', 'address'],
  lists: ['list_name', 'content']
};

private static getAllowedColumns(entity: 'tasks' | 'contacts' | 'lists'): string[] {
  return this.ALLOWED_COLUMNS[entity];
}
```

---

## Migration & Indexing

### Database Migrations Required:

#### 1. Add indexes for performance:

```sql
-- For task filtering
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(user_id, category);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(user_id, due_date);

-- For text search (trigram if available)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_tasks_text_trgm ON tasks USING gin(text gin_trgm_ops);

-- Subtasks FK already has ON DELETE CASCADE (from existing setup)
```

#### 2. No schema changes required:

- All necessary columns already exist
- Tables support bulk operations as-is

### Index Rationale:

- **idx_tasks_completed**: Fast filtering by completion status
- **idx_tasks_category**: Fast filtering by category
- **idx_tasks_due_date**: Fast date range queries
- **idx_tasks_text_trgm**: Fuzzy text search for `q` parameter
- Existing `idx_tasks_user` covers user scoping

---

## Safety & Guardrails

### 1. Bulk Destructive Operations:

- **Requirement**: Refuse DELETE/UPDATE with empty `where` unless `preview=true`
- **Implementation**: Check in Function.execute() before calling service
- **Error message**: "Bulk delete/update requires filter conditions. Set preview=true to review affected rows."

### 2. Threshold Warning:

- **Trigger**: If affected rows > N (default: 50) and `preview` not present
- **Action**: Return warning response instead of executing
- **Message**: "This will affect 73 tasks. Add preview=true to review, or narrow your filter."
- **Configurable**: Add threshold to environment/config

### 3. Audit Logging:

- **Table**: `bulk_operations_audit` (new table)
- **Schema**:

```sql
CREATE TABLE bulk_operations_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    entity VARCHAR(50),
    operation VARCHAR(50),
    where_filter JSONB,
    patch_data JSONB,
    affected_count INTEGER,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

- **Log**: Every bulk operation (preview=false)
- **Usage**: Compliance, debugging, analytics

### 4. Parameterization:

- **Requirement**: All user input must be parameterized
- **Compiler**: Automatically uses `$N` placeholders
- **No injection risk**: Columns hard-coded in registry

### 5. Preview Mode:

- **Purpose**: Allow users to review affected rows before executing
- **Implementation**: Replace DELETE/UPDATE with SELECT
- **Response**: `{ affectedRows: [...], count: N, preview: true }`
- **User flow**: "Would you like to proceed? Reply 'confirm' to execute."

---

## Rollout Plan

### Phase 1: TaskFunction + TaskService (Foundation)

**Files**:

1. Create `src/utils/SQLCompiler.ts`
2. Create `src/core/types/Filters.ts`
3. Modify `src/services/database/TaskService.ts`
4. Modify `src/agents/functions/DatabaseFunctions.ts` (TaskFunction only)

**Timeline**: 2-3 days

**Tests**:

- Unit tests for SQLCompiler
- Integration tests for TaskService bulk methods
- End-to-end tests for TaskFunction with where/patch

**Checkpoints**:

- Compiler generates valid SQL for all filter types
- Bulk operations execute correctly
- Preview mode works
- Safety checks prevent empty-where deletions

---

### Phase 2: ContactFunction + ContactService, ListFunction + ListService

**Files**:

1. Modify `src/services/database/ContactService.ts`
2. Modify `src/services/database/ListService.ts`
3. Modify `src/agents/functions/DatabaseFunctions.ts` (ContactFunction, ListFunction)

**Timeline**: 1-2 days

**Tests**:

- Parity tests: Contact/List should mirror Task behavior
- Edge cases: JSONB content updates, special characters

**Checkpoints**:

- All three entities support bulk operations
- No regressions in existing single-item flows

---

### Phase 3: QueryResolver Enhancement

**Files**:

1. Modify `src/core/orchestrator/QueryResolver.ts`
2. Add tests for filter derivation

**Timeline**: 1-2 days

**Tests**:

- Test filter derivation from natural language
- Test confidence scoring
- Integration with TaskFunction routing

---

### Phase 4: System Prompt Update

**Files**:

1. Modify `src/config/system-prompts.ts`

**Timeline**: 0.5 day

**Testing**:

- Manual testing: Submit requests, verify LLM produces correct intent JSON
- Examples to test:
  - "delete all completed tasks"
  - "mark all work tasks as done"
  - "show tasks due this week"

---

## Deliverables Checklist

- [ ] **SQLCompiler.ts** with comprehensive tests

  - [ ] compileWhere with all filter types
  - [ ] compileOrderAndPaging
  - [ ] compileSet with validation
  - [ ] Window resolution
  - [ ] Safety checks (unknown columns, SQL injection protection)

- [ ] **Updated TaskService** bulk methods

  - [ ] deleteAll
  - [ ] updateAll
  - [ ] completeAll
  - [ ] Refactored getAll using compiler

- [ ] **Updated TaskFunction** params/enum/logic

  - [ ] Extended operation enum
  - [ ] Added where/patch/preview params
  - [ ] Decision logic for routing
  - [ ] Safety: empty where rejection

- [ ] **QueryResolver** emitting filter when appropriate

  - [ ] deriveFilterFromQuery method
  - [ ] Integration with TaskFunction routing
  - [ ] Confidence scoring

- [ ] **System prompt** text snippet

  - [ ] Bulk operations section
  - [ ] Filter examples
  - [ ] Safety warnings

- [ ] **Contact/List parity**

  - [ ] ContactService bulk methods
  - [ ] ListService bulk methods
  - [ ] ContactFunction/ListFunction updates

- [ ] **Safety/preview logic**

  - [ ] Empty where rejection
  - [ ] Threshold warning
  - [ ] Preview mode implementation
  - [ ] Audit logging

- [ ] **Index/migration note**

  - [ ] SQL migration file
  - [ ] Index rationale documented

- [ ] **Test cases list**
  - [ ] Unit tests for compiler
  - [ ] Integration tests for services
  - [ ] End-to-end tests for functions
  - [ ] Manual prompt testing scenarios

---

## Critical Design Decision: LLM-Native Multi-Task Handling

### No Regex or Pattern Matching

**Important**: The system does **NOT** use regex, keyword detection, or string parsing to identify multiple tasks in user messages. All multi-task detection is handled semantically by the Database Agent (LLM).

### Rationale

1. **Semantic Understanding**: LLMs excel at understanding context and intent, including:

   - "Remind me to take the dog out at 5 and have a haircut at 10" (conjunction + times)
   - "Tomorrow buy milk, call mom, and finish the report" (shared time + multiple actions)
   - "At 8 yoga, at 9 groceries, at 10 meeting" (time-ordered list)

2. **No Code Changes Needed**: The backend already supports this via `TaskFunction.createMultiple → TaskService.createMultiple` - only the system prompt needs enhancement.

3. **Maintainability**: Regex patterns would require constant updates as user phrasing evolves. LLM handles natural language variations automatically.

### Implementation

- **System Prompt**: Add "TASK CREATION RULES" section with examples (see Section 9)
- **No New Utilities**: Do not create "TaskSplitter", "TaskParser", or similar utilities
- **Intent JSON**: LLM outputs `operation: "createMultiple"` with `tasks[]` array when multiple tasks detected

### Examples

```json
// User: "Remind me to take the dog out at 5 and have a haircut at 10"
{
  "operation": "createMultiple",
  "entity": "tasks",
  "tasks": [
    { "text": "Take the dog out", "dueDate": "2025-01-15T17:00:00Z" },
    { "text": "Have a haircut", "dueDate": "2025-01-15T10:00:00Z" }
  ]
}

// User: "Tomorrow buy milk, call mom, and finish the report"
{
  "operation": "createMultiple",
  "entity": "tasks",
  "tasks": [
    { "text": "Buy milk", "dueDate": "2025-01-16T10:00:00Z" },
    { "text": "Call mom", "dueDate": "2025-01-16T10:00:00Z" },
    { "text": "Finish the report", "dueDate": "2025-01-16T10:00:00Z" }
  ]
}
```

---

## Additional Considerations

### 1. Backward Compatibility

- **All existing single-item flows must continue working**
- **No breaking changes to function signatures**
- **Additive only**: New operations, new params
- **Testing**: Regression test suite for existing functionality

### 2. Performance

- **Bulk operations should be significantly faster**
- **Benchmark**: 100-task delete:
  - Loop-based: ~500ms
  - Bulk: ~50ms
- **Monitoring**: Add query timing logs

### 3. Error Handling

- **Comprehensive error messages**
- **Distinguish**: validation errors vs. execution errors
- **User-friendly messages**: "No tasks match your filter" vs. "Query failed"

### 4. Internationalization

- **Filter values**: Support non-English category names
- **Date handling**: Timezone-aware window resolution
- **Text search**: Consider full-text search for non-English text

---

## Conclusion

This implementation plan introduces a hybrid SQL compiler architecture that bridges LLM intent (JSON) with efficient database operations (bulk SQL), while maintaining backward compatibility and adding safety guardrails. The phased rollout minimizes risk and allows for iterative testing and refinement.

The system will be capable of handling natural language requests like "delete all completed tasks" efficiently and safely, while preserving the existing single-item operations that users rely on.
