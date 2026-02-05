# Feature Addition Chain

When adding new operations (like `deleteAll`, `updateMultiple`, etc.) to the Memo_v2 system, multiple files need to be updated in a specific order to ensure the feature works end-to-end.

## Full Chain of Files (in order)

```
1. ResolverSchema.ts         → Add actionHints for routing
2. DatabaseResolvers.ts      → Add LLM examples + schema enum
3. DatabaseEntityResolver.ts → Add resolution logic (if text-based)
4. TaskServiceAdapter.ts     → Add execute() case + method
5. response-formatter-prompt.ts → Add response formatting rules
6. agents-database.md        → Update documentation
```

## Detailed Steps

### 1. ResolverSchema.ts

**Path:** `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

Update the relevant schema (e.g., `DATABASE_TASK_SCHEMA`) to include:

- **actionHints**: Add action hints for routing (e.g., `'delete_all_tasks'`)
- **triggerPatterns**: Add Hebrew/English trigger patterns
- **examples**: Add example inputs for the LLM

### 2. DatabaseResolvers.ts

**Path:** `Memo_v2/src/graph/resolvers/DatabaseResolvers.ts`

Update the resolver class (e.g., `DatabaseTaskResolver`) to include:

- **actions array**: Add the new action (e.g., `'delete_all_tasks'`)
- **getSystemPrompt()**: Add examples for the LLM to understand the new operation
- **getSchemaSlice()**:
  - Add the operation to the `enum` array
  - Add any new parameters (e.g., `patch`, `taskIds`)
  - Document parameter descriptions

### 3. DatabaseEntityResolver.ts (if needed)

**Path:** `Memo_v2/src/services/resolution/DatabaseEntityResolver.ts`

Only needed if the operation requires resolving text to entity IDs:

- Add operation to `operationsNeedingResolution` array
- Add special handling for array-based operations (e.g., `deleteMultiple`)
- Implement resolution methods (e.g., `resolveMultipleTasks()`)

**Operations that DON'T need entity resolution:**

- `deleteAll` - Uses `where` filter
- `updateAll` - Uses `where` filter + `patch`

**Operations that NEED entity resolution:**

- `deleteMultiple` - Needs to resolve each task text to ID
- `updateMultiple` - Needs to resolve each update's text to ID

### 4. TaskServiceAdapter.ts

**Path:** `Memo_v2/src/services/adapters/TaskServiceAdapter.ts`

Update the adapter to:

- **TaskOperationArgs interface**: Add new parameters (e.g., `patch`, `taskIds`)
- **execute() switch**: Add case for the new operation
- **Implement method**: Create the operation implementation

### 5. response-formatter-prompt.ts

**Path:** `src/config/response-formatter-prompt.ts`

Update the response formatting rules:

- Add format for bulk operations (e.g., "✅ נמחקו X משימות")
- Handle partial success with `notFound` items
- Add both Hebrew and English formats

### 6. agents-database.md

**Path:** `docs/project-instruction/agents-database.md`

Update documentation:

- Add to "What the Database Agent CAN Do" section
- Add parameter details in "Parameters & Behavior" section
- Add example flows

## Notes on Operation Types

### Filter-based operations (no entity resolution)

- `deleteAll` - Uses `where` filter (window, type)
- `updateAll` - Uses `where` filter + `patch` object with fields to update

**Available `where` filters:**

- `window`: `'today'` | `'this_week'` | `'overdue'` | `'upcoming'` | `'all'`
- `type`: `'recurring'` | `'unplanned'` | `'reminder'`
  - `recurring` - Tasks with `reminder_recurrence` set
  - `unplanned` - Tasks without `due_date` AND without `reminder_recurrence`
  - `reminder` - Tasks with `due_date` but without `reminder_recurrence`

**Note:** Filtering is done in-memory by `TaskServiceAdapter.filterTasks()` after fetching all uncompleted tasks from V1.

### Array-based operations (need entity resolution)

- `deleteMultiple` - Uses `tasks: [{ text: '...' }]` array
- `updateMultiple` - Uses `updates: [{ text: '...', reminderDetails: {...} }]` array

## Files That DON'T Need Changes

- **ExecutorNode** - Just passes args to adapters
- **ResponseFormatterNode** - Builds context generically from execution results
- **ResponseWriterNode** - Uses LLM with response-formatter-prompt (no code changes)
- **PlannerNode** - Uses ResolverSchema automatically via `formatSchemasForPrompt()`

## Testing Checklist

1. ✅ ResolverSchema actionHints route correctly
2. ✅ LLM in DatabaseResolvers outputs correct operation and params
3. ✅ Entity resolution resolves text to IDs (for text-based operations)
4. ✅ TaskServiceAdapter executes the operation
5. ✅ ResponseFormatterPrompt formats the result correctly
6. ✅ Documentation is updated
