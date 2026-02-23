# Memo V2 — Runtime State & Types (Source of Truth)

This document describes the **actual, current runtime contract** from user message → LangGraph → response.

If something here contradicts code, **code wins** and this doc must be updated.

## Canonical sources (do not duplicate types)

- **Runtime LangGraph state**: `Memo_v2/src/graph/state/MemoState.ts` (`MemoStateAnnotation`)
- **Cross-node contracts (types imported by nodes)**: `Memo_v2/src/types/index.ts`
- **Canonical HITL types**: `Memo_v2/src/types/hitl.ts`
- **Entity-resolution subsystem types**: `Memo_v2/src/services/resolution/types.ts`

This doc intentionally **references** these files rather than copying full type definitions to avoid drift.

## High-level state lifecycle (current implementation)

- **Thread identity**: `thread_id = userPhone` (LangGraph checkpointer key), also stored as `state.threadId`.
- **Trace identity**: `state.traceId` — per-request chain, stable across resume, immutable once set. Set from `whatsappMessageId` or generated UUID.
- **Persistence strategy**:
  - During **HITL interrupts**, LangGraph persists state in the checkpointer.
  - After a **successful completion**, `invokeMemoGraph()` deletes the thread checkpoints (`checkpointer.deleteThread(threadId)`), so LangGraph state is **not** meant to persist across normal requests.
  - Conversation continuity is handled by `MemoryService` (recent messages), not by long-lived LangGraph state.

Canonical code: `Memo_v2/src/graph/index.ts`

## Node-by-node: what gets written/read

### 1) `ContextAssemblyNode` (code)

Writes:
- `state.authContext`: hydrated once (user record + Google tokens + capability flags)
- `state.user`: lightweight prompt-facing context derived from `authContext` (includes optional `userName`)
- `state.input`: includes `message`, `userPhone`, `timezone`, `language`, message IDs
- `state.recentMessages`: pulled from `MemoryService`
- `state.latestActions`: last 3 executed actions (most-recent first) from `MemoryService`, used by PlannerNode to resolve referential follow-ups ("it/that/זה")
- `state.now`
- `state.threadId`: conversation identity (WhatsApp phone)
- `state.traceId`: per-request chain ID, immutable once set

Canonical code: `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts`

### 2) `ReplyContextNode` (code)

Writes:
- `state.input.enhancedMessage`: enriched with reply-to context and recent image context if present
- `state.input.imageContext` (when applicable)

Canonical code: `Memo_v2/src/graph/nodes/ReplyContextNode.ts`

### 3) `PlannerNode` (LLM)

Writes:
- `state.plannerOutput`: `intentType`, `confidence`, `riskLevel`, `needsApproval`, `missingFields`, `plan[]`
- `state.routingSuggestions`: pattern-based hints used for natural clarification messages in HITL

Special re-plan behavior:
- If the prior HITL was `intent_unclear`, the planner re-plans using the clarification from `state.hitlResults` (looks for `returnTo.node === 'planner'` with `mode === 'replan'`).

Canonical code: `Memo_v2/src/graph/nodes/PlannerNode.ts`

### 4) `CapabilityCheckNode` (code)

Purpose:
- Blocks execution if the plan requires capabilities the user does not have (currently calendar/gmail).

Writes (when blocked):
- `state.finalResponse`: a fixed "connect Google" message

Canonical code: `Memo_v2/src/graph/nodes/CapabilityCheckNode.ts`

### 5) `HITLGateNode` (code, uses `interrupt()` + `Command({ update, goto })`)

Single canonical HITL control-plane. One `pendingHITL` at a time.

#### A) Forward path: creates `pendingHITL`

- **Entity disambiguation**: if `state.disambiguation` has unresolved candidates, creates `PendingHITL` with `kind:'disambiguation'`, `source:'entity_resolution'`, `returnTo:{ node:'entity_resolution', mode:'apply_selection' }`.
- **Planner HITL**: checks planner conditions (confidence, missingFields, risk, approval), creates `PendingHITL` with appropriate `kind`/`returnTo`.
- **Multi-HITL guard**: if `pendingHITL !== null` and a new HITL trigger occurs, logs `HITL_DUPLICATE_ATTEMPT` and ignores the new request.

#### B) Resume path: validates, stores result, routes via Command

- Validates user reply against `pendingHITL.expectedInput` (yes_no, single_choice, multi_choice, free_text).
- On invalid: re-interrupts with error-prefixed question, same `hitlId`.
- On valid: writes `hitlResults[hitlId]`, clears `pendingHITL`, returns `Command({ update, goto })`.
- `goto` derived from `pendingHITL.returnTo`:
  - `planner + replan` → `goto: 'planner'`
  - `resolver_router + continue` → `goto: 'resolver_router'`
  - `entity_resolution + apply_selection` → `goto: 'entity_resolution'`
- Expiry check: if `pendingHITL.expiresAt` < now, clears and responds with expiry message.

#### LLM guardrails

- LLM generates **question text only** (clarification messages).
- Options (ids, labels, order) are **machine-controlled** in code.
- For disambiguation, LLM is not used at all — question is template-based.

Canonical code: `Memo_v2/src/graph/nodes/HITLGateNode.ts`

### 6) `ResolverRouterNode` (code)

Purpose:
- Creates execution groups from `dependsOn`, runs resolvers in parallel where safe.

Critical resume behavior:
- If `state.resolverResults` already contains a step's result, the node **skips re-running** the resolver.

Writes:
- `state.resolverResults: Map<stepId, ResolverResult>`

Canonical code: `Memo_v2/src/graph/nodes/ResolverRouterNode.ts`

### 7) `EntityResolutionNode` (code)

Purpose:
- Converts semantic resolver args into **ID-resolved args** (or machine-only disambiguation / not_found context).

On disambiguation resume:
- Reads selection from `state.hitlResults` (canonical) or `state.disambiguation.userSelection` (set by Command).
- Calls `resolver.applySelection()` and writes resolved args.

Writes:
- `state.executorArgs: Map<stepId, resolvedArgs>` (**authoritative for execution**)
- `state.disambiguation`: machine-only (candidates + metadata, no user-facing text)
- In a `not_found` / `clarify_query` case: writes a failed entry into `state.executionResults`

Canonical code: `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`

### 8) `ExecutorNode` (code)

Critical contracts:
- Prefers `state.executorArgs.get(stepId)` over `state.resolverResults.get(stepId).args`.
- **Idempotency guard**: checks `state.executedOperations[operationId]` where `operationId = traceId + ':' + stepId`. If present, skips execution and reuses cached result. If ledger exists but `executionResults` is missing, returns safe failure with `IDEMPOTENCY_MISSING_RESULT`.

Writes:
- `state.executionResults: Map<stepId, ExecutionResult>` (ephemeral, runtime full results)
- `state.executedOperations: Record<operationId, ExecutedOperation>` (persistent PII-safe ledger)

Canonical code: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

### 9) `JoinNode` → `ResponseFormatterNode` → `ResponseWriterNode` → `MemoryUpdateNode`

- `JoinNode`: detects partial/complete failures (no interrupts).
- `ResponseFormatterNode`: normalizes adapter return shapes, formats dates, builds per-capability context, captures failures.
- `ResponseWriterNode`: writes final user message.
- `MemoryUpdateNode`: updates `recentMessages`; also extracts **all** successful execution results into `latestActions` (per-session FIFO, max 10, stored in `ConversationWindow`).

## LatestActions contract

- **Type**: `LatestAction[]` (defined in `Memo_v2/src/types/index.ts`)
- **Fields**: `createdAt`, `capability`, `action`, `summary`, `when?`, `externalIds?`
- **Storage**: `ConversationWindow` in-memory map, per userPhone, 12h session scope, FIFO max 10.
- **Written by**: `MemoryUpdateNode` — iterates all plan steps; for each `executionResults.get(stepId).success === true`, builds and pushes a `LatestAction`.
- **Read by**: `ContextAssemblyNode` — fetches last 3 (most-recent first) into `state.latestActions`.
- **Consumed by**: `PlannerNode` — injected as a tiny `## Latest Actions` block in the user message; used to resolve referential language ("it/that/זה").
- **Planner rule**: most-recent action is the strongest candidate when user uses referential language. Only triggers `intent_unclear` HITL when no latestAction is plausible.

## HITL timeout (current behavior)

- **TTL**: 5 minutes (`HITL_TTL_MS` from `Memo_v2/src/types/hitl.ts`).
- Enforced in `invokeMemoGraph()`: reads `interruptedAt` from interrupt payload metadata.
- If timed out → deletes thread checkpoints, responds with expiry message.
- Also enforced defense-in-depth in `HITLGateNode`: if `pendingHITL.expiresAt` is past, clears and routes to expiry response.

## Stale reply guard

- If no pending interrupt exists but the user's message looks like a HITL answer (short "yes"/"no"/"1"/"2"/etc.), `invokeMemoGraph()` responds with "I'm not waiting on a question right now — what would you like to do?" and logs `HITL_STALE_REPLY`.
