# Feature Addition Chain (Current Architecture)

When adding a **new capability** or a **new operation/action** inside an existing capability (e.g. `deleteMultiple`, `updateAll`, `archiveThread`), multiple files must be updated so the request works end-to-end.

This document reflects the **current** Memo_v2 architecture (resolvers → entity resolution → `executorArgs` → adapters → formatter/writer).

## Chain overview (what must exist for a capability operation to work)

```text
PlannerNode (LLM) produces PlanStep[]
  ↓
HITLGateNode (interrupt) may pause for planner clarification/approval
  ↓
ResolverRouterNode (code) invokes capability resolver(s) (LLM)
  ↓
EntityResolutionNode (code) resolves text → IDs, writes state.executorArgs
  ↓
ExecutorNode (code) executes via src/services/adapters/*, prefers executorArgs
  ↓
JoinNode → ResponseFormatterNode → ResponseWriterNode → MemoryUpdateNode
```

## Add/extend an operation (recommended checklist)

### 1) Update routing contract (`ResolverSchema.ts`)

**File**: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

Add or update the relevant schema entry:

- **`actionHints`**: include the new action so the planner routes correctly
- **`triggerPatterns`**: Hebrew/English patterns if applicable
- **`examples`**: examples that demonstrate the new operation

This is the planner’s “capability contract”.

### 2) Update resolver implementation (LLM → semantic args)

**Files** (by capability):
- Calendar: `Memo_v2/src/graph/resolvers/CalendarResolvers.ts`
- Database: `Memo_v2/src/graph/resolvers/DatabaseResolvers.ts`
- Gmail: `Memo_v2/src/graph/resolvers/GmailResolver.ts`
- Second brain: `Memo_v2/src/graph/resolvers/SecondBrainResolver.ts`
- General (user + agent/help/plan): `Memo_v2/src/graph/resolvers/GeneralResolver.ts` — single resolver, no separate meta capability

Do:

- Add the new `action` to the resolver’s supported `actions`
- Update prompt examples so the resolver reliably emits the new action
- Update the resolver schema slice so the **args shape** for the new operation is explicit

Resolver output is **semantic** (may contain text like “meeting notes”), not necessarily IDs.

### 3) Update entity resolution (semantic → IDs) if needed

**Files**: `Memo_v2/src/services/resolution/*EntityResolver.ts`

Only required when execution needs IDs (taskId/eventId/messageId/etc) and the resolver produces natural language text.

Do:

- Add the new operation to the domain’s “needs resolution” logic
- Implement resolution and disambiguation behavior:
  - **disambiguation** → `EntityResolutionNode` triggers HITL (user selects candidate)
  - **not_found** → continue to response (no interrupt) with a helpful explanation

Important:
- The **authoritative resolved payload** must be written to `state.executorArgs` by `EntityResolutionNode`.

### 4) Update adapter execution (IDs → real side effect / query)

**Files**: `Memo_v2/src/services/adapters/*ServiceAdapter.ts`

Do:

- Extend the adapter args type for the new operation
- Add the `execute()` switch/dispatch case
- Implement the operation using V1 services (thin adapter pattern)

Adapters must return a shape compatible with:
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`

If you introduce a new return shape, update that doc.

### 5) Ensure `ExecutorNode` dispatch supports the capability/operation

**File**: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

In the current architecture, `ExecutorNode` is the single execution dispatcher.

Usually you **do not** need to change it unless:
- you added a brand-new capability adapter
- you need special cross-step handling

### 6) Verify response behavior (formatter/writer expectations)

**Files**:
- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`
- `Memo_v2/src/graph/nodes/ResponseWriterNode.ts`
- `src/config/response-formatter-prompt.ts`

Do:

- Confirm the adapter output is categorized and surfaced correctly
- If the operation needs special phrasing/UX rules, add them to `response-formatter-prompt.ts`

### 7) Update docs (must stay in sync with runtime)

Update **both**:

- Capability contract doc (canonical): `Memo_v2/docs/capabilities/<capability>.md`
- Human-facing workflow docs (repo root): `docs/project-instruction/agents-<capability>.md`

If the change touches core flow/state, also update:
- `Memo_v2/docs/STATE_SCHEMA.md`
- `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`
- `Memo_v2/docs/SYSTEM_DIAGRAM.md`

## Testing checklist (high-signal)

- Planner routes to the right capability/action (schema hints + examples)
- Resolver emits the new action and args consistently
- Entity resolution produces the required IDs in `executorArgs` (or triggers disambiguation HITL)
- Adapter executes and returns a formatter-compatible result shape
- Formatter + writer produce the expected user output (including partial failure / not_found messaging)

