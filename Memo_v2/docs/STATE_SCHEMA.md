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
  - **Planner-facing** rolling context: `ConversationContextStore` (in-process `Map` keyed by `users.id`; **TODO: Redis**). The buffer **accumulates** completed user+assistant messages (up to **10** messages or **~500 tokens** on message text, excluding the summary). When either cap is exceeded, **synchronous** summarization runs at `memory_update`, then the raw tail is **trimmed to 3** messages and merged into the rolling summary. Between summarizations the tail is **not** fixed at 3—it can be 3–10 until the next fold.
  - **Operational** memory: `MemoryService` / `ConversationWindow` (reply-to, disambiguation, `latestActions` for **GeneralResolver** only). **Guests** (`!authContext.userRecord.id`): no memory writes and empty planner context.

Canonical code: `Memo_v2/src/graph/index.ts`

## Node-by-node: what gets written/read

### 1) `ContextAssemblyNode` (code)

Writes:
- `state.authContext`: hydrated once (user record + Google tokens + capability flags)
- `state.user`: lightweight prompt-facing context derived from `authContext` (includes optional `userName`)
- `state.input`: includes `message`, `userPhone`, `timezone`, `language`, message IDs
- `state.recentMessages`: `[]` (planner tail is filled by **`conversation_context`**)
- `state.latestActions`: for **non-guest** users only — last 3 executed actions from `MemoryService` (**GeneralResolver**); guests get `[]`
- Registers the user message in `MemoryService` / `ConversationWindow` **only for non-guest** users (reply threading / disambiguation)
- `state.now`
- `state.threadId`: conversation identity (WhatsApp phone)
- `state.traceId`: per-request chain ID, immutable once set

Canonical code: `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts`

### 2) `ConversationContextNode` (code)

Writes (non-guest):
- `state.conversationContext`: `{ summary?, recentMessages }` from `ConversationContextStore.getForPlanner(userId)` — full stored tail (typically **3–10** completed messages between summarizations; **3** immediately after a fold) plus optional rolling summary
- `state.recentMessages`: same as `conversationContext.recentMessages` (for `ReplyContextNode`, resolvers, planner via `state.recentMessages.slice(-10)` with summary block)
- `state.longTermSummary`: mirror of `conversationContext.summary` (legacy alias)

Guests: empty `conversationContext`, empty `recentMessages`, no `longTermSummary`.

Canonical code: `Memo_v2/src/graph/nodes/ConversationContextNode.ts`

### 3) `ReplyContextNode` (code)

Writes:
- `state.input.enhancedMessage`: enriched with reply-to context and recent image context if present
- `state.input.imageContext` (when applicable)

Canonical code: `Memo_v2/src/graph/nodes/ReplyContextNode.ts`

### 4) `PlannerNode` (LLM)

Reads (among other state):
- `state.conversationContext?.summary` / `state.longTermSummary`: **Conversation summary** block (rolling)
- `state.recentMessages`: **Recent messages** block — last up to **10** completed messages (same cap as the store; HITL `switch_intent` may merge extra pairs—planner still slices to 10); current user text is only under **User Message**
- **Does not** read `state.latestActions` (operational “what did you do” is **GeneralResolver** only)

Writes:
- `state.plannerOutput`: `intentType`, `confidence`, `riskLevel`, `needsApproval`, `missingFields`, `plan[]`
- `state.routingSuggestions`: pattern-based hints used for natural clarification messages in HITL
- `state.llmSteps`: accumulates one `LLMStep` from the planner's LLM call via `traceLlmReasoningLogJSON('planner', ...)`

Special re-plan behavior:
- If the prior HITL was `intent_unclear`, the planner re-plans using the clarification from `state.hitlResults` (looks for `returnTo.node === 'planner'` with `mode === 'replan'`).

Canonical code: `Memo_v2/src/graph/nodes/PlannerNode.ts`

### 5) `CapabilityCheckNode` (code)

Purpose:
- Blocks execution if the plan requires capabilities the user does not have (currently calendar/gmail).

Writes (when blocked):
- `state.finalResponse`: a fixed "connect Google" message

Canonical code: `Memo_v2/src/graph/nodes/CapabilityCheckNode.ts`

### 6) `HITLGateNode` (code, uses `interrupt()` + `Command({ update, goto })`)

Single canonical HITL control-plane. One `pendingHITL` at a time.

#### A) Forward path: creates `pendingHITL`

- **Entity disambiguation**: if `state.disambiguation` has unresolved candidates, creates `PendingHITL` with `kind:'disambiguation'`, `source:'entity_resolution'`, `returnTo:{ node:'entity_resolution', mode:'apply_selection' }`.
- **Planner HITL**: checks planner conditions (confidence, missingFields, risk, approval), creates `PendingHITL` with appropriate `kind`/`returnTo`.
- **Multi-HITL guard**: if `pendingHITL !== null` and a new HITL trigger occurs, logs `HITL_DUPLICATE_ATTEMPT` and ignores the new request.

#### B) Resume path: three-layer processing

Resume uses a three-layer architecture:

1. **Fast path** (no LLM): deterministic yes/no keyword match, exact option index/label match, multi-choice numeric parsing, free-text pass-through. Entity disambiguation always uses this layer only.
2. **LLM interpreter** (planner HITL only, `gpt-4o-mini`): classifies reply into one of five decisions: `continue`, `continue_with_modifications`, `switch_intent`, `cancel`, `re_ask`. For `continue_with_modifications`, extracts semantic `modifications` (e.g. `{ title: "Wedding" }`).
3. **State transitions**: maps decision to `Command({ update, goto })`.

Decision routing:
- `continue` → writes `hitlResults[hitlId]`, clears `pendingHITL`, routes via `pendingHITL.returnTo`
- `continue_with_modifications` → merges modifications into plan step `constraints`/`changes`, **clears** `resolverResults` and `executorArgs` for that step, routes to `resolver_router`
- `switch_intent` → clears `pendingHITL`, replaces `input.message`, clears `plannerOutput`, routes to `planner`
- `cancel` → clears `pendingHITL`, sets `finalResponse` to cancellation message, routes to `response_writer`
- `re_ask` → re-interrupts with same `hitlId` and a nudge question (recursive)

Expiry check: if `pendingHITL.expiresAt` < now, clears and responds with expiry message.

`hitlResults[hitlId]` may include an `interpreted?: HITLInterpreterOutput` field when the LLM interpreter ran (for audit).

#### LLM guardrails

- **Question generation LLMs** generate question text only. Options are machine-controlled.
- **Interpreter LLM** classifies + extracts semantic fields only. Never invents entity IDs. Modifications are filtered through an allowlist (`ALLOWED_MODIFICATION_FIELDS`) in code.
- For disambiguation, no LLM is used — question is template-based.

- **`switch_intent`**: merges the HITL assistant question + user reply into `state.recentMessages` (concat + cap) before replan — `state.recentMessages` uses a **last-write-wins** reducer; this merge preserves prior tail.

Canonical code: `Memo_v2/src/graph/nodes/HITLGateNode.ts`

### 7) `ResolverRouterNode` (code)

Purpose:
- Creates execution groups from `dependsOn`, runs resolvers in parallel where safe.

Critical resume behavior:
- If `state.resolverResults` already contains a step's result, the node **skips re-running** the resolver.

Writes:
- `state.resolverResults: Map<stepId, ResolverResult>`
- `state.llmSteps`: drained from resolver instances via `resolver.drainLlmSteps()` after each `resolve()` call (traces resolver LLM calls like `resolver:<capability>`)

Canonical code: `Memo_v2/src/graph/nodes/ResolverRouterNode.ts`

### 8) `EntityResolutionNode` (code)

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

### 9) `ExecutorNode` (code)

Critical contracts:
- Prefers `state.executorArgs.get(stepId)` over `state.resolverResults.get(stepId).args`.
- **Idempotency guard**: checks `state.executedOperations[operationId]` where `operationId = traceId + ':' + stepId`. If present, skips execution and reuses cached result. If ledger exists but `executionResults` is missing, returns safe failure with `IDEMPOTENCY_MISSING_RESULT`.

Writes:
- `state.executionResults: Map<stepId, ExecutionResult>` (ephemeral, runtime full results)
- `state.executedOperations: Record<operationId, ExecutedOperation>` (persistent PII-safe ledger)

Canonical code: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

### 10) `JoinNode` → `ResponseFormatterNode` → `ResponseWriterNode` → `MemoryUpdateNode`

- `JoinNode`: detects partial/complete failures (no interrupts).
- `ResponseFormatterNode`: normalizes adapter return shapes, formats dates, builds per-capability context, captures failures.
- `ResponseWriterNode`: writes final user message.
- `MemoryUpdateNode` (non-guest): appends completed **user + assistant** pair to `ConversationContextStore`; if raw buffer exceeds **10 messages** or **~500 tokens** (summary excluded), runs **synchronous** LLM summarization, then keeps last **3** messages + updated rolling summary. Also persists `ConversationWindow` user message if missing, and pushes `latestActions` for successful steps. **Guests**: skips store, `latestActions`, and `MemoryService` persistence.

## LatestActions contract

- **Type**: `LatestAction[]` (defined in `Memo_v2/src/types/index.ts`)
- **Fields**: `createdAt`, `capability`, `action`, `summary`, `when?`, `externalIds?`
- **Storage**: `ConversationWindow` in-memory map, per userPhone, 12h session scope, FIFO max 10.
- **Written by**: `MemoryUpdateNode` (non-guest only) — iterates all plan steps; for each `executionResults.get(stepId).success === true`, builds and pushes a `LatestAction`. For database (tasks/reminders), `when` is set from `next_reminder_at` when present so follow-up questions like "when is the next reminder?" can be answered from Latest Actions; `summary` may include recurrence hint (e.g. "every 2 weeks").
- **Read by**: `ContextAssemblyNode` — fetches last 3 (most-recent first) into `state.latestActions` for non-guest users.
- **Consumed by**: **`GeneralResolver` only** — `state.latestActions` + rolling summary + recent tail for “what did you last do?” style Q&A. **`PlannerNode` does not** receive Latest Actions; referential chat context comes from **conversation summary + up to 10 recent completed messages** (`state.recentMessages.slice(-10)`; see `PlannerNode.buildUserMessage`).

## HITL timeout (current behavior)

- **TTL**: 5 minutes (`HITL_TTL_MS` from `Memo_v2/src/types/hitl.ts`).
- Enforced in `invokeMemoGraph()`: reads `interruptedAt` from interrupt payload metadata.
- If timed out → deletes thread checkpoints, **falls through to fresh invocation** (user's message is processed normally, no confusing expiry error). The HITL question is already in `MemoryService`, so the planner sees full context.
- Defense-in-depth in `HITLGateNode`: if `pendingHITL.expiresAt` is past, clears and routes to expiry response.

All HITL interactions are persisted to `MemoryService` (question via `addInterruptMessageToMemory`, user reply via `addUserResponseToMemory`) so conversation context is never lost.

When there is no pending interrupt, every user message is passed to the graph as a fresh invocation (no stale-reply guard).

## Pipeline Trace (`state.llmSteps` + `PipelineTraceService`)

Every LLM call in the graph is traced via `traceLlmReasoningLog` / `traceLlmReasoningLogJSON` (defined in `Memo_v2/src/services/trace/traceLlmReasoningLog.ts`). Each call produces an `LLMStep` (defined in `MemoState.ts`) containing:

- `node`: caller-provided name (e.g. `"planner"`, `"resolver:calendar"`, `"hitl:clarify"`, `"response_writer:database"`, `"conversation_summarizer"`)
- `model`, token counts (`inputTokens`, `cachedInputTokens`, `outputTokens`, `totalTokens`), `latencyMs`, `cost`
- `input`: messages persisted for debugging — **system role messages are omitted** (case-insensitive match on `role`) so large static prompts are not stored in `pipeline_traces`.
- `output`: assistant text when present; for **function/tool calls** (resolvers, etc.) a JSON string with `type: "function_call"` or `type: "tool_calls"` and the `name` / `arguments` payload (see `traceOutputFromLlmResponse` in `traceLlmReasoningLog.ts`)
- `countInAggregates`: optional; when `false`, the step is **not** counted toward `total_llm_calls` / token / cost aggregates in `computeAggregates` (used for synthetic debug rows only).

**Reply-context trace window (no extra DB columns):** `ReplyContextNode` appends one synthetic `LLMStep` with `node: "reply_context"`, `model: "debug"`, `countInAggregates: false`, and a **human-readable text block** in `input[0].content`. The block is formatted with titled sections so the DB/debug page shows one clean context window:
- `## Last User Message`
- `## Enhanced User Message` (when present)
- `## Conversation Summary` (when present)
- `## Recent Messages Meta`
- `## Recent Messages Array`
- `## Last Executions`

This row is for debugging only, uses the same `pipeline_traces.llm_steps` JSON column as real LLM calls, and omits secrets (no OAuth tokens, no `authContext`).

`llmSteps` accumulates across the graph via a **reducer** (`[...existing, ...incoming]`). Every node that makes LLM calls returns `llmSteps: [step]` in its state update:

| Node | Trace names |
|---|---|
| ReplyContextNode | `reply_context` (synthetic human-readable context window — not an LLM) |
| PlannerNode | `planner` |
| ResolverRouterNode (drains from LLMResolver) | `resolver:<capability>` |
| HITLGateNode | `hitl:clarify`, `hitl:confirm`, `hitl:interpret`, `hitl:disambiguate` |
| ResponseWriterNode | `response_writer:<capability>`, `response_writer:error_explain` |
| MemoryUpdateNode (via summarizer) | `conversation_summarizer` |

**Pre-graph LLM steps:** Audio flows call `transcribeAudio()` before `invokeMemoGraph`. The resulting `LLMStep` (`node: transcription`) is passed via `invokeMemoGraph(..., { preGraphLlmSteps: [...] })` and merged into initial `state.llmSteps`, so the same `PipelineTraceService.flush` row includes transcription latency (token counts may be zero; audio API is not token-metered like chat).

**Image-only path:** `processImageMessage` does not run the graph. When a vision API call runs, `PipelineTraceService.flushMinimal` writes a standalone `pipeline_traces` row (`trigger_type: image`) with one `image-analysis` step.

After graph completion (both normal and interrupt paths), `invokeMemoGraph` calls `PipelineTraceService.flush(state)` fire-and-forget, which persists the trace to the `pipeline_traces` table. Completion is logged as structured JSON (`PIPELINE_COMPLETE` event) with elapsed time, **`llmSteps`** = count of steps that count toward aggregates (real LLM calls), **`llmStepsTotal`** = full `state.llmSteps.length` (includes the synthetic `reply_context` row), node count, total tokens, and total cost.

### Metadata accumulation contract

`state.metadata` (`ExecutionMetadata`) uses a **delta-based reducer**: nodes return only their own additions (one `nodeExecution` entry, zero counters unless tracking LLM calls). The reducer concatenates `nodeExecutions` arrays and sums numeric counters. **Never** spread `state.metadata` in a return — let the reducer accumulate. `BaseNode.execute()` enforces this for all nodes extending `BaseNode`/`CodeNode`/`LLMNode`.

Canonical code:
- Trace wrappers: `Memo_v2/src/services/trace/traceLlmReasoningLog.ts`
- Helpers: `Memo_v2/src/services/trace/traceHelpers.ts`
- DB service: `Memo_v2/src/services/trace/PipelineTraceService.ts`
- Migration: `scripts/migrations/004-pipeline-traces.sql`
