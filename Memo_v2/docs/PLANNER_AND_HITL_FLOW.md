# Memo V2 — Planner & HITL (Current Flow Contract)

This doc explains **exactly** how Planner + HITL work in the current Memo_v2 runtime, including what state fields are written and how resume routing behaves.

## Canonical code

- Graph + routers + timeout: `Memo_v2/src/graph/index.ts`
- Planner: `Memo_v2/src/graph/nodes/PlannerNode.ts`
- HITL: `Memo_v2/src/graph/nodes/HITLGateNode.ts`
- Entity resolution: `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`
- State: `Memo_v2/src/graph/state/MemoState.ts`
- Types: `Memo_v2/src/types/index.ts`

## Overview

Planner produces a structured `plannerOutput` plan (steps + routing hints). HITL uses LangGraph `interrupt()` to safely pause the graph when execution is risky or under-specified, and resumes with `Command({ resume: userMessage })`.

There are **two HITL families**:

- **Planner HITL**: Clarification / confirmation / approval / intent clarification (`intent_unclear`).
- **Entity-resolution HITL**: Disambiguation selection (user chooses between candidate entities).

## 1) Planner output contract (LLM)

Planner writes `state.plannerOutput`:

- `intentType`: `"operation" | "conversation" | "meta"`
- `confidence`: \(0..1\)
- `riskLevel`: `"low" | "medium" | "high"`
- `needsApproval`: boolean
- `missingFields`: string[]
- `plan`: `PlanStep[]` (each includes `id`, `capability`, `action`, `constraints.rawMessage`, `changes`, `dependsOn`)

Planner also writes `state.routingSuggestions` (pattern hints) used only for HITL clarification wording.

## 2) HITL trigger rules (current)

In `HITLGateNode.checkHITLConditions()` (priority order):

1. If `plannerOutput.missingFields` includes **`intent_unclear`** → interrupt with type `clarification`, and set `hitlType = 'intent_unclear'`. The clarification message **always** includes the second-brain option (“לשמור בזכרון?” / “save to memory?”) so the user can choose to store the information even when pattern matching did not suggest it.
2. Else if `plannerOutput.confidence < 0.7` → interrupt with clarification.
3. Else if `plannerOutput.missingFields.length > 0` → interrupt with clarification.
4. Else if `plannerOutput.riskLevel === 'high'` → interrupt with confirmation.
5. Else if `plannerOutput.needsApproval === true` → interrupt with approval.
6. Else → continue.

## 3) Planner HITL resume behavior (intent_unclear vs other)

When Planner HITL interrupts:

- `HITLGateNode` stores:
  - `state.hitlType`: one of `'intent_unclear' | 'missing_fields' | 'confirmation'`
  - `state.interruptedAt`: timestamp (also copied into the interrupt payload metadata)
- It adds the question to MemoryService **before** interrupting, so the user sees it in conversation history.

When the user replies (graph resume):

- The resume value becomes the return value of `interrupt(payload)` (LangGraph behavior).
- `HITLGateNode` stores the user reply into:
  - `state.plannerHITLResponse` (planner HITL only)

Routing after resume (in `hitlGateRouter` in `Memo_v2/src/graph/index.ts`):

- If `state.hitlType === 'intent_unclear'` AND `state.plannerHITLResponse` exists → route back to **PlannerNode** for re-planning.
- Otherwise → continue to **ResolverRouterNode**.

## 4) Entity resolution HITL (disambiguation) contract

If `EntityResolutionNode` hits ambiguity:

- It returns early with:
  - `state.needsHITL = true`
  - `state.hitlReason = 'disambiguation'`
  - `state.disambiguation = { type, candidates, question, allowMultiple, resolverStepId, originalArgs }`

Graph routing (in `entityResolutionRouter`):

- Only `(needsHITL && hitlReason === 'disambiguation')` routes to HITL.
- `not_found` does **not** interrupt; it proceeds to response generation with a friendly explanation.

On disambiguation resume:

- `HITLGateNode.handleEntityResolutionHITL()` parses:
  - numbers (`"1"`, `"2 3"`) → `number | number[]`
  - `"both"/"all"` / `"שניהם"/"כולם"` → string
  - otherwise → raw text
- It writes `state.disambiguation.userSelection` and keeps `resolved: false` so `EntityResolutionNode` can apply it.

Then `EntityResolutionNode` calls the domain resolver’s `applySelection(...)` and writes the resolved args into `state.executorArgs`.

## 5) Interrupt timeout (current)

`invokeMemoGraph()` enforces a stale-interrupt timeout:

- `INTERRUPT_TIMEOUT_MS = 1 * 60 * 1000` (1 minute)
- It reads `interruptedAt` from the persisted interrupt payload metadata.
- If timed out, it deletes the thread checkpoints and treats the message as a **fresh invocation**.

## 6) Resolver caching on resume

After any HITL resume, the graph re-enters at `HITLGateNode` and routes forward.

To prevent repeated resolver LLM calls:

- `ResolverRouterNode.routeAndExecute()` checks `state.resolverResults.get(step.id)` and if present returns the cached result.

This is critical for confirmation-style HITL: once the user says “yes”, we do not want to re-run the resolver LLM on the same input.

