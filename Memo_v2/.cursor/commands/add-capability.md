# /add-capability

Use this command when adding a **new capability** or a **new operation/action** inside an existing capability.

## Inputs you must extract from the user request

- Capability name (existing or new): `calendar | database | gmail | second-brain | general | meta | <new>`
- New actions/operations to support (list them explicitly)
- Which resolver schema entry (or entries) should route to it
- Whether the operation needs **entity resolution** (text → IDs)
- Whether the operation is **read-only** or **side-effecting**

## Non-negotiable constraints (Memo_v2 architecture)

- Docs must match runtime code 100%.
- Resolvers output **semantic args**.
- Entity resolution produces **ID-resolved args** in `state.executorArgs`.
- `ExecutorNode` executes via adapters in `Memo_v2/src/services/adapters/*`.

Canonical docs:
- `Memo_v2/docs/feature-addition-chain.md`
- `Memo_v2/docs/STATE_SCHEMA.md`
- `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`

## Checklist (do in order)

### 1) Planner routing contract

- Update `Memo_v2/src/graph/resolvers/ResolverSchema.ts`
  - Add/update schema entry with **actionHints**, **triggerPatterns**, **examples**

### 2) Resolver implementation (LLM → semantic args)

- Update/create resolver in `Memo_v2/src/graph/resolvers/*`
  - Add supported action(s)
  - Update prompt examples
  - Update schema slice: operation enum + required fields

### 3) Entity resolution (semantic → IDs) if needed

- Update/create entity resolver in `Memo_v2/src/services/resolution/*EntityResolver.ts`
  - Add operation to “needs resolution” list
  - Implement:
    - `resolved` → write IDs into args
    - `disambiguation` → candidates + question (+ allowMultiple)
    - `not_found` / `clarify_query` → explainable failure (no interrupt)
  - Ensure `applySelection(...)` is correct for HITL resume

### 4) EntityResolutionNode wiring

- Confirm `EntityResolutionNode` handles the capability domain
  - If new capability: register it in the resolver map and ensure context building is correct

### 5) Adapter execution

- Update/create adapter in `Memo_v2/src/services/adapters/*ServiceAdapter.ts`
  - Add args type fields
  - Add `execute()` dispatch case
  - Call the appropriate V1 service methods
  - Return a result shape compatible with `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`

### 6) Executor dispatch

- Update `Memo_v2/src/graph/nodes/ExecutorNode.ts` only if:
  - new capability adapter added, or
  - special routing logic is required

### 7) Response behavior

- Validate `ResponseFormatterNode` has the data it expects
  - If new return shape, update `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- If UX phrasing rules are needed, update `src/config/response-formatter-prompt.ts`

### 8) Documentation updates (required)

- Add/update capability contract doc:
  - `Memo_v2/docs/capabilities/<capability>.md`
- Update repo-root workflow doc:
  - `docs/project-instruction/agents-<capability>.md`
- If flow/state changed, also update:
  - `Memo_v2/docs/SYSTEM_DIAGRAM.md`
  - `Memo_v2/docs/STATE_SCHEMA.md`
  - `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`

## Output format (what you should produce back to the user)

- A short summary of files changed
- A “why” summary (1–3 bullets)
- A test plan checklist (manual steps)
