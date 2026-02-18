# Database (Tasks & Lists) capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Manage tasks/reminders and lists (CRUD + bulk operations for tasks; CRUD + item toggling for lists).
- **Boundaries**:
  - Uses Supabase/Postgres via legacy V1 services behind adapters.
  - All execution goes through `TaskServiceAdapter` / `ListServiceAdapter` selected by `ExecutorNode`.

## ResolverSchema entries (planner routing contract)

- `DATABASE_TASK_SCHEMA` (`capability: "database"`)
- `DATABASE_LIST_SCHEMA` (`capability: "database"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract (semantic args)

### Resolver(s)

- `DatabaseTaskResolver` + `DatabaseListResolver`: `Memo_v2/src/graph/resolvers/DatabaseResolvers.ts`

### Task operations

`args.operation ∈ ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'updateAll', 'delete', 'deleteMultiple', 'deleteAll', 'complete', 'addSubtask']`

Common fields (selected):
- Single-item targeting: `text` (task text hint), optional `taskId` (if known)
- Updates: `reminderDetails`, `category`, `dueDate`, `reminder`, `reminderRecurrence`
- Bulk:
  - `filters` for `getAll`
  - `where` + `patch` for `updateAll`
  - `where` + `preview` for `deleteAll`
  - `tasks[]` / `updates[]` for `deleteMultiple` / `updateMultiple`

### List operations

`args.operation ∈ ['create', 'get', 'getAll', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem']`

Common fields:
- Targeting: `listName` / `name` (semantic), optional `listId` (if known)
- Item ops: `item` (text), `itemIndex` (number)
- Creation: `items[]`, `isChecklist` (default true)

## Entity resolution contract (semantic → IDs)

### Entity resolver

- `DatabaseEntityResolver`: `Memo_v2/src/services/resolution/DatabaseEntityResolver.ts`

### Task resolution (when needed)

Entity resolution runs for:

`operation ∈ ['get', 'update', 'delete', 'complete', 'addSubtask', 'deleteMultiple', 'updateMultiple']`

What gets produced (examples):
- Single-target ops: `taskId`
- `deleteMultiple`: resolves each entry in `tasks[]` to a concrete task ID
- `updateMultiple`: resolves each entry in `updates[]` to include `taskId`
  - May attach `_notFound` for items that could not be resolved

### List resolution (when needed)

Entity resolution runs for:

`operation ∈ ['get', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem']`

What gets produced:
- `listId`

### HITL behavior (disambiguation)

If multiple candidates match:
- `DatabaseEntityResolver` returns `type: 'disambiguation'` with candidates + question.
- `HITLGateNode` captures selection and `applySelection(...)` applies it.

## Execution contract (adapters)

### Executor dispatch

- `ExecutorNode` checks whether args represent a list operation and dispatches to:
  - `ListServiceAdapter(userPhone)` **or**
  - `TaskServiceAdapter(userPhone)`

Source: `Memo_v2/src/graph/nodes/ExecutorNode.ts` (`isListOperation`)

### Adapters

- Tasks: `Memo_v2/src/services/adapters/TaskServiceAdapter.ts`
- Lists: `Memo_v2/src/services/adapters/ListServiceAdapter.ts`

## Response formatting/writer behavior

- `ResponseFormatterNode` normalizes task/list result shapes and builds database-specific response context.
- `ResponseWriterNode` generates the final user text using `src/config/response-formatter-prompt.ts`.

Canonical references:
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`

