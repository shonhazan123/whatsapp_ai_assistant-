# HITL Control-Plane Migration Notes

## What was removed

The following ad-hoc HITL state fields have been removed from `MemoStateAnnotation`:

| Removed field | Was in | Purpose |
|---|---|---|
| `needsHITL` | `MemoState` | Boolean flag set by EntityResolutionNode |
| `hitlReason` | `MemoState` | String reason ('disambiguation', 'not_found', etc.) |
| `hitlType` | `MemoState` | Routing hint ('intent_unclear', 'missing_fields', 'confirmation') |
| `plannerHITLResponse` | `MemoState` | Raw user reply to planner HITL |
| `interruptedAt` | `MemoState` | Timestamp in state (now in payload metadata + pendingHITL.expiresAt) |
| `disambiguation.question` | `DisambiguationContext` | User-facing question text (now built by HITLGateNode) |
| `disambiguation.resolved` | `DisambiguationContext` | Kept — still used for entity resolution flow control |
| `hitlGateRouter()` | `graph/index.ts` | Conditional edge function — replaced by Command({ goto }) |

The old `HITLReason` type in `types/index.ts` is kept for backward compatibility but is no longer used in state.

## New single contract

### `pendingHITL: PendingHITL | null`

One canonical HITL object at a time. Created by `HITLGateNode`, cleared on valid resume or expiry.

Key fields:
- `hitlId`: UUID, unique per interruption
- `kind`: 'clarification' | 'approval' | 'disambiguation'
- `source`: 'planner' | 'entity_resolution'
- `returnTo`: `{ node, mode }` — deterministic resume destination
- `expectedInput`: 'yes_no' | 'single_choice' | 'multi_choice' | 'free_text'
- `expiresAt`: ISO timestamp (TTL = 5 minutes)

### `hitlResults: Record<string, HITLResultEntry>`

Stores validated user replies keyed by `hitlId`. Never cleared within a run — serves as audit trail.

### `traceId: string` (immutable)

Per-request chain ID, stable across resume. Set once by `ContextAssemblyNode`, never overwritten (reducer enforces immutability).

### `threadId: string`

Conversation identity (WhatsApp phone / session key). Separate from `traceId`.

### `executedOperations: Record<string, ExecutedOperation>`

PII-safe idempotency ledger. Key = `traceId + ':' + stepId`. Prevents re-execution on retries/resume.

## Deterministic resume routing

Old: `hitlGateRouter()` conditional edge checked `state.hitlType` and `state.plannerHITLResponse` to decide routing.

New: `HITLGateNode` returns `Command({ update: {...}, goto })` where `goto` is derived from `pendingHITL.returnTo`:

| returnTo.node | returnTo.mode | goto |
|---|---|---|
| `planner` | `replan` | `'planner'` |
| `resolver_router` | `continue` | `'resolver_router'` |
| `entity_resolution` | `apply_selection` | `'entity_resolution'` |

The graph wires `hitl_gate` with a normal edge (default: `resolver_router`). When `HITLGateNode` returns a `Command`, LangGraph follows the `goto` instead.

## Other changes

- **TTL**: Changed from 1 minute to **5 minutes** (WhatsApp replies are often late).
- **Multi-HITL guard**: If `pendingHITL !== null` and a new HITL is triggered, the new request is ignored and logged as `HITL_DUPLICATE_ATTEMPT`.
- **LLM guardrails**: LLM generates question text only; options/ids/expectedInput are machine-controlled.
- **Disambiguation is machine-only**: `DisambiguationContext` no longer contains `question`. HITLGateNode builds the user-facing question from candidates.
- **Executor idempotency**: `ExecutorNode` checks `executedOperations[traceId:stepId]` before executing, persists PII-safe ledger entries after execution.

## Files changed

- `Memo_v2/src/types/hitl.ts` (new)
- `Memo_v2/src/types/index.ts` (re-exports + InterruptPayload metadata extension)
- `Memo_v2/src/graph/state/MemoState.ts` (new fields, removed legacy)
- `Memo_v2/src/graph/index.ts` (removed hitlGateRouter, updated entityResolutionRouter, 5min TTL)
- `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts` (threadId + traceId)
- `Memo_v2/src/graph/nodes/HITLGateNode.ts` (complete rewrite)
- `Memo_v2/src/graph/nodes/EntityResolutionNode.ts` (machine-only disambiguation, hitlResults)
- `Memo_v2/src/graph/nodes/ExecutorNode.ts` (idempotency guard)
- `Memo_v2/src/graph/nodes/PlannerNode.ts` (hitlResults instead of plannerHITLResponse)
- `Memo_v2/src/graph/resolvers/BaseResolver.ts` (hitlResults instead of plannerHITLResponse)
- `Memo_v2/src/graph/resolvers/DatabaseResolvers.ts` (hitlResults instead of plannerHITLResponse)
- `Memo_v2/src/services/resolution/types.ts` (machine-only, added disambiguationKind)
