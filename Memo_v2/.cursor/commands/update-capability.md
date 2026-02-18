# /update-capability

Use this command when **modifying an existing capability** (changing routing, adding/changing operations, changing args shapes, changing adapter return shapes, or changing response behavior).

The goal is to **prevent breaking the end-to-end flow**: Planner → schema hints → resolver args → entity resolution → executor/adapters → formatter/writer → docs.

## Inputs you must extract from the user request

- Capability: `calendar | database | gmail | second-brain | general | meta`
- What changed:
  - new operation(s)
  - removed operation(s)
  - renamed operation(s)
  - args shape change (new fields / renamed fields / requiredness)
  - return-shape change (adapter data shape)
  - routing change (Planner/ResolverSchema)
- Risk level:
  - destructive (`delete`, `sendConfirm`, bulk ops)
  - non-destructive (list/get/search)

## Non-negotiable constraints (Memo_v2 architecture)

- **Docs must match runtime code 100%.**
- Resolvers output **semantic args** into `state.resolverResults`.
- Entity resolution produces **ID-resolved args** into `state.executorArgs`.
- `ExecutorNode` must prefer `executorArgs` over `resolverResults`.
- HITL must remain correct (planner HITL vs entity-resolution disambiguation HITL).

Canonical docs (Memo_v2 only):
- `Memo_v2/docs/feature-addition-chain.md`
- `Memo_v2/docs/STATE_SCHEMA.md`
- `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- `Memo_v2/docs/capabilities/<capability>.md`

Canonical runtime truth:
- `Memo_v2/src/graph/index.ts`
- `Memo_v2/src/graph/state/MemoState.ts`
- `Memo_v2/src/types/index.ts`

## Safety checklist (do in this order)

### 1) Planner gets the right “input” signal

Verify that the planner can reliably route the request:

- `Memo_v2/src/graph/nodes/PlannerNode.ts`
  - Planner must emit `plannerOutput.plan[]` with correct `capability` and `action` for the user request.
- If the change introduces new user phrases/keywords, ensure routing remains stable by updating **ResolverSchema** (next step).

If planner intent/routing changed, confirm graph routing still goes through the correct nodes:
- `Memo_v2/src/graph/index.ts` routers (`plannerRouter`, `hitlGateRouter`, `entityResolutionRouter`, `capabilityCheckRouter`)

### 2) Schema hints + ResolverSchema (planner routing contract)

Update the single source of truth:

- `Memo_v2/src/graph/resolvers/ResolverSchema.ts`
  - Add/update `actionHints`, `triggerPatterns`, `examples`
  - Ensure new/changed actions still map to the correct resolver(s)

This ensures the planner has correct schema context and pattern-based routing suggestions.

### 3) Resolver output contract (semantic args)

Update the resolver(s) so they emit the right operation + args:

- `Memo_v2/src/graph/resolvers/*`
  - Update supported actions / operation enum
  - Update schema slice (args shape)
  - Update prompt examples for the new operation(s)

**Invariant**: resolvers must not invent IDs they don’t have.

### 4) Entity resolution contract (semantic → IDs) — if applicable

If the operation needs IDs at execution time, update:

- `Memo_v2/src/services/resolution/*EntityResolver.ts`
  - Update “operations needing resolution”
  - Ensure output args include required IDs (`taskId`, `listId`, `eventId`, `messageId`, `memoryId`, etc.)
  - Ensure disambiguation returns `type:'disambiguation'` with candidates + question
  - Ensure `applySelection(...)` handles user selection correctly

Also verify `EntityResolutionNode` wiring:

- `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`
  - Must write resolved args into `state.executorArgs`
  - Must trigger HITL only for real disambiguation (`hitlReason === 'disambiguation'`)

### 5) Executor + adapters (resolved args → execution + return shape)

- `Memo_v2/src/graph/nodes/ExecutorNode.ts`
  - Confirm capability dispatch is still correct
  - Confirm it prefers `executorArgs`

- `Memo_v2/src/services/adapters/*ServiceAdapter.ts`
  - Add/update `execute()` dispatch case
  - Ensure adapter return shape remains compatible with formatter expectations

If you changed return shape(s), update:
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`

### 6) Response formatting/writer behavior

Confirm the operation is expressed correctly to the user:

- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`
- `Memo_v2/src/graph/nodes/ResponseWriterNode.ts`
- `src/config/response-formatter-prompt.ts` (when special phrasing rules are needed)

### 7) HITL flows (don’t break interrupts/resume)

If the change affects confirmation, approvals, or disambiguation:

- Verify planner HITL triggers remain correct:
  - `Memo_v2/src/graph/nodes/HITLGateNode.ts`
  - `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`

### 8) Update docs (required)

Update the capability contract so future work is consistent:

- `Memo_v2/docs/capabilities/<capability>.md`
  - Update operations list, args shape, entity resolution rules, adapter execution, return shape notes
- If flow/state changed, also update:
  - `Memo_v2/docs/STATE_SCHEMA.md`
  - `Memo_v2/docs/SYSTEM_DIAGRAM.md`
  - `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`

## Output format (what you must produce back to the user)

- **Changes summary**: 5–12 bullet list of files changed and why
- **Flow verification**: short statement confirming each stage still works:
  - Planner → Schema hints → Resolver args → Entity resolution → Executor/adapters → Formatter/writer
- **Test plan**: 3–8 manual tests using realistic messages (including one destructive case if applicable)

