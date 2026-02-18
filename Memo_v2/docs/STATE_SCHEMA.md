# Memo V2 — Runtime State & Types (Source of Truth)

This document describes the **actual, current runtime contract** from user message → LangGraph → response.

If something here contradicts code, **code wins** and this doc must be updated.

## Canonical sources (do not duplicate types)

- **Runtime LangGraph state**: `Memo_v2/src/graph/state/MemoState.ts` (`MemoStateAnnotation`)
- **Cross-node contracts (types imported by nodes)**: `Memo_v2/src/types/index.ts`
- **Entity-resolution subsystem types**: `Memo_v2/src/services/resolution/types.ts`

This doc intentionally **references** these files rather than copying full type definitions to avoid drift.

## High-level state lifecycle (current implementation)

- **Thread identity**: `thread_id = userPhone` (LangGraph checkpointer key)
- **Persistence strategy**:
  - During **HITL interrupts**, LangGraph persists state in the checkpointer.
  - After a **successful completion**, `invokeMemoGraph()` deletes the thread checkpoints (`checkpointer.deleteThread(threadId)`), so LangGraph state is **not** meant to persist across normal requests.
  - Conversation continuity is handled by `MemoryService` (recent messages), not by long-lived LangGraph state.

Canonical code: `Memo_v2/src/graph/index.ts`

## Node-by-node: what gets written/read

### 1) `ContextAssemblyNode` (code)

Writes:
- `state.authContext`: hydrated once (user record + Google tokens + capability flags)
- `state.user`: lightweight prompt-facing context derived from `authContext`
- `state.input`: includes `message`, `userPhone`, `timezone`, `language`, message IDs
- `state.recentMessages`: pulled from `MemoryService`
- `state.now`

Canonical code: `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts`

### 2) `ReplyContextNode` (code)

Writes:
- `state.input.enhancedMessage`: enriched with reply-to context (including numbered-list selection context) and recent image context if present
- `state.input.imageContext` (when applicable)

Canonical code: `Memo_v2/src/graph/nodes/ReplyContextNode.ts`

### 3) `PlannerNode` (LLM)

Writes:
- `state.plannerOutput`: `intentType`, `confidence`, `riskLevel`, `needsApproval`, `missingFields`, `plan[]`
- `state.routingSuggestions`: pattern-based hints used for natural clarification messages in HITL

Special re-plan behavior:
- If the prior HITL was `intent_unclear`, the planner re-plans using `state.plannerHITLResponse` (and then clears HITL fields to avoid loops).

Canonical code: `Memo_v2/src/graph/nodes/PlannerNode.ts`

### 4) `CapabilityCheckNode` (code)

Purpose:
- Blocks execution if the plan requires capabilities the user does not have (currently calendar/gmail).

Writes (when blocked):
- `state.finalResponse`: a fixed “connect Google” message

Canonical code: `Memo_v2/src/graph/nodes/CapabilityCheckNode.ts`

### 5) `HITLGateNode` (code, uses `interrupt()`)

There are **two distinct HITL families**. They use different state fields and resume behavior.

#### A) Planner HITL (clarification / confirmation / approval / intent_unclear)

Triggers when (priority order):
- `missingFields` contains `intent_unclear` (special case)
- `confidence < 0.7`
- `missingFields.length > 0`
- `riskLevel === 'high'`
- `needsApproval === true`

Interrupt/resume fields:
- On interrupt: sets `state.hitlType` and tracks `interruptedAt` for timeout handling.
- On resume: stores the raw user reply in **`state.plannerHITLResponse`** (planner HITL only).

Routing after resume (graph router):
- If `hitlType === 'intent_unclear'` and `plannerHITLResponse` exists → route back to `PlannerNode` (re-plan).
- Otherwise → continue to `ResolverRouterNode`.

Canonical code:
- `Memo_v2/src/graph/nodes/HITLGateNode.ts`
- `Memo_v2/src/graph/index.ts` (`hitlGateRouter`)

#### B) Entity-Resolution HITL (disambiguation selection)

When an entity resolver returns `type: 'disambiguation'`, `EntityResolutionNode` sets:
- `state.needsHITL = true`
- `state.hitlReason = 'disambiguation'`
- `state.disambiguation = { type, candidates, question, allowMultiple, resolverStepId, originalArgs }`

Graph routing:
- Only `hitlReason === 'disambiguation'` routes to HITL. `not_found` does **not** interrupt; it proceeds to response generation with an explanation.

On resume:
- `HITLGateNode` parses user input into `state.disambiguation.userSelection` (number/array/"both"/text)
- `EntityResolutionNode` then applies selection via the domain resolver’s `applySelection(...)`

Canonical code:
- `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`
- `Memo_v2/src/graph/nodes/HITLGateNode.ts`
- `Memo_v2/src/graph/index.ts` (`entityResolutionRouter`)

### 6) `ResolverRouterNode` (code)

Purpose:
- Creates execution groups from `dependsOn`, runs resolvers in parallel where safe, sequential between dependency groups.

Critical resume behavior:
- If `state.resolverResults` already contains a step’s result (e.g., after HITL resume), the node **skips re-running** the resolver (prevents duplicate LLM calls).

Writes:
- `state.resolverResults: Map<stepId, ResolverResult>`

Canonical code: `Memo_v2/src/graph/nodes/ResolverRouterNode.ts`

### 7) `EntityResolutionNode` (code)

Purpose:
- Converts semantic resolver args into **ID-resolved args** (or disambiguation / not_found context).

Writes:
- `state.executorArgs: Map<stepId, resolvedArgs>` (**authoritative for execution**)
- In a `not_found` / `clarify_query` case: writes a failed entry into `state.executionResults` for that step and returns early so the response pipeline can explain.

Canonical code: `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`

### 8) `ExecutorNode` (code)

Critical contract:
- For each step, it prefers `state.executorArgs.get(stepId)` over `state.resolverResults.get(stepId).args`.

Writes:
- `state.executionResults: Map<stepId, ExecutionResult>`

Canonical code: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

### 9) `JoinNode` → `ResponseFormatterNode` → `ResponseWriterNode` → `MemoryUpdateNode`

- `JoinNode`: detects partial/complete failures (no interrupts).
- `ResponseFormatterNode`: normalizes adapter return shapes, formats dates, builds per-capability context, captures failures in `formattedResponse.failedOperations`.
- `ResponseWriterNode`: writes final user message; handles complete failure/partial failure; uses `src/config/response-formatter-prompt.ts` for success formatting.
- `MemoryUpdateNode`: updates `recentMessages` trimming; note that **assistant WhatsApp message ID** is attached by the webhook layer (not inside this node).

Canonical code:
- `Memo_v2/src/graph/nodes/JoinNode.ts`
- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`
- `Memo_v2/src/graph/nodes/ResponseWriterNode.ts`
- `Memo_v2/src/graph/nodes/MemoryUpdateNode.ts`

## HITL timeout (current behavior)

The system enforces a timeout for stale interrupts in `invokeMemoGraph()`.

- Current value: `INTERRUPT_TIMEOUT_MS = 1 * 60 * 1000` (1 minute)
- Source: `Memo_v2/src/graph/index.ts`

If a user replies after the timeout window, the thread is cleaned up and the message is treated as a **fresh invocation**.

