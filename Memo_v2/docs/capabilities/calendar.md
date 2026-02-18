# Calendar capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Read and mutate Google Calendar events (search/list/get, create/update/delete, and bulk window operations).
- **Boundaries**:
  - Requires Google Calendar connection (`authContext` + `CapabilityCheckNode`).
  - All execution happens via `CalendarServiceAdapter` (no direct API calls in nodes).

## ResolverSchema entries (planner routing contract)

- `CALENDAR_FIND_SCHEMA` (`capability: "calendar"`) — read-only operations
- `CALENDAR_MUTATE_SCHEMA` (`capability: "calendar"`) — write operations

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract (semantic args)

### Resolver(s)

- `CalendarFindResolver` + `CalendarMutateResolver`: `Memo_v2/src/graph/resolvers/CalendarResolvers.ts`

### `CalendarFindResolver` operations

`args.operation ∈ ['get', 'getEvents', 'checkConflicts', 'getRecurringInstances']`

Common fields:
- `timeMin`, `timeMax` (ISO strings)
- `summary` (event title hint)
- `eventId` (optional; if already known)

### `CalendarMutateResolver` operations

`args.operation ∈ ['create', 'createMultiple', 'createRecurring', 'createMultipleRecurring', 'update', 'updateByWindow', 'delete', 'deleteByWindow', 'deleteBySummary', 'truncateRecurring']`

Common fields (by operation):
- Create/update: `summary`, `start`, `end`, `description`, `location`, `attendees`, `allDay`, `reminderMinutesBefore`
- Recurring: `startTime`, `endTime`, `days`, `until`
- Bulk window: `timeMin`, `timeMax`, optional `excludeSummaries`
- Update: `searchCriteria` + `updateFields`

## Entity resolution contract (semantic → IDs)

### Entity resolver

- `CalendarEntityResolver`: `Memo_v2/src/services/resolution/CalendarEntityResolver.ts`

### When resolution happens

Entity resolution is applied for operations that need an `eventId` or a concrete target set:

`operation ∈ ['get', 'update', 'delete', 'getRecurringInstances', 'truncateRecurring', 'deleteByWindow', 'updateByWindow']`

### What gets produced

`EntityResolutionNode` writes the resolved args to:

- `state.executorArgs.get(stepId)` including (when needed):
  - `eventId` (single event target)
  - Additional flags/fields used for recurring-series choice (when disambiguated)

### HITL behavior (disambiguation)

- If multiple candidates match, `CalendarEntityResolver` can return `type: 'disambiguation'` with candidates + question.
- `HITLGateNode` collects user selection and `CalendarEntityResolver.applySelection(...)` applies it.

## Execution contract (adapters)

### Executor dispatch

- `ExecutorNode` (`capability: 'calendar'`) constructs `CalendarServiceAdapter(authContext)` and calls `execute(args)`.
- For list-style reads (`getEvents` / `get`), `ExecutorNode` strips `htmlLink` fields so the response doesn’t contain messy URLs.

Source: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

### Adapter

- `CalendarServiceAdapter`: `Memo_v2/src/services/adapters/CalendarServiceAdapter.ts`

## Response formatting/writer behavior

- `ResponseFormatterNode` consumes `executionResults` and builds calendar-specific response context.
- `ResponseWriterNode` turns the formatted context into the final user-facing text.
- Formatting conventions live in `src/config/response-formatter-prompt.ts`.

Canonical references:
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`
- `Memo_v2/src/graph/nodes/ResponseWriterNode.ts`

## End-to-end example (shape)

1. Planner produces a `PlanStep` with `capability: "calendar"` and a raw message constraint.
2. Resolver outputs semantic args (e.g., `{ operation: "delete", summary: "team meeting" }`).
3. Entity resolution resolves `eventId` (or triggers disambiguation).
4. Executor calls `CalendarServiceAdapter.execute(...)`.
5. Formatter/writer produce the final WhatsApp response.

