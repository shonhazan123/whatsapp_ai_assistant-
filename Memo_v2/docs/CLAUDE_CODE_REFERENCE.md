# Memo_v2 — Claude Code / AI Agent Reference

Short system map for **enhancing, scaling, and optimizing** the codebase. Authoritative detail lives in the linked paths; **if this file disagrees with code, code wins**.

---

## 1. What this project is

- **WhatsApp assistant** → HTTP webhook → **LangGraph** (`Memo_v2/src/graph/index.ts`) → LLM planner + capability **resolvers** → **entity resolution** (IDs) → **service adapters** (side effects) → formatted reply.
- **Thread ID** = `userPhone` (checkpointer). **Trace ID** = per-request chain (immutable after set).
- **HITL**: `interrupt()` + resume via `Command({ resume })`; single **`pendingHITL`** contract in `HITLGateNode`.

---

## 2. Folder structure (Memo_v2)

| Area | Role |
|------|------|
| `src/graph/index.ts` | Graph definition, edges, `invokeMemoGraph` / `buildMemoGraph` |
| `src/graph/state/MemoState.ts` | `MemoStateAnnotation` — all shared state |
| `src/graph/nodes/` | One file per graph node (planner, HITL, router, executor, …) |
| `src/graph/resolvers/` | LLM → semantic args (`ResolverSchema.ts`, `*Resolvers.ts`, `index.ts` registry) |
| `src/graph/executors/` | Capability executors used by `ExecutorNode` (dispatch to adapters) |
| `src/services/adapters/` | Thin wrappers over **legacy** services (real I/O) |
| `src/services/resolution/` | `*EntityResolver.ts` — text → IDs, disambiguation payloads |
| `src/services/memory/` | `MemoryService`, `ConversationWindow`, recent messages / latest actions |
| `src/services/llm/` | Shared LLM calls |
| `src/legacy/` | V1 services, DB, Google APIs (called only via adapters / init) |
| `src/routes/` | `webhook.ts` (entry), `auth.ts`, `debug.ts` |
| `src/types/` + `src/types/hitl.ts` | Cross-cutting types + HITL types |
| `src/config/` | LLM config, capabilities copy, prompts |
| `docs/` | Architecture docs (`STATE_SCHEMA.md`, `PLANNER_AND_HITL_FLOW.md`, `feature-addition-chain.md`) |

---

## 3. Graph order (runtime)

```
__start__
  → context_assembly
  → reply_context
  → planner
  → capability_check ──(finalResponse set)──→ response_writer ──→ memory_update → END
        │(ok)
        ▼
     hitl_gate ──(default edge)──→ resolver_router → entity_resolution
                                        │                    │
                                        │                    ├──(unresolved disambiguation)→ hitl_gate
                                        │                    └──(resolved)──→ executor → join
                                                                                  → response_formatter
                                                                                  → response_writer
                                                                                  → memory_update → END
```

- **`hitl_gate`** may **`interrupt()`**; on resume, routing uses **`Command({ update, goto })`** inside `HITLGateNode` (not only the static edge to `resolver_router`).
- **`invokeMemoGraph`** (`index.ts`) deletes checkpoints after successful completion; HITL uses the checkpointer for pause/resume.

---

## 4. Nodes — responsibility & state touchpoints

| Node | Responsibility | Depends on (reads) | Produces / mutates |
|------|----------------|--------------------|--------------------|
| **context_assembly** | User DB, auth, tokens, `MemoryService`, `latestActions`, `traceId`, `now` | Trigger input | `user`, `authContext`, `input`, `recentMessages`, `latestActions`, `threadId`, `traceId`, `now` |
| **reply_context** | Reply-to + image context | `input`, memory | `input.enhancedMessage`, image fields |
| **planner** | LLM → `plannerOutput`, `routingSuggestions` | User message, memory, `latestActions`, `now` | `plannerOutput`, `routingSuggestions`, metadata |
| **capability_check** | Block if plan needs Google but disconnected | `plannerOutput`, `user` / auth | `finalResponse` (early exit path) |
| **hitl_gate** | Planner HITL + entity disambiguation HITL; `interrupt` / resume | `plannerOutput`, `disambiguation`, `pendingHITL` | `pendingHITL`, `hitlResults`, may clear caches / `Command` goto |
| **resolver_router** | Run resolvers per plan (parallel where safe) | `plannerOutput.plan` | `resolverResults` (semantic args) |
| **entity_resolution** | Semantic → IDs → `executorArgs` | `resolverResults`, resolvers | `executorArgs`, `disambiguation`, optional failed `executionResults` |
| **executor** | Adapters + idempotency ledger | `executorArgs` (preferred), `resolverResults` | `executionResults`, `executedOperations` |
| **join** | Aggregate step outcomes | `executionResults` | (pass-through / flags) |
| **response_formatter** | Normalize shapes, dates, per-step context | Execution + plan | `formattedResponse` |
| **response_writer** | Final natural-language reply | `formattedResponse` | `finalResponse` |
| **memory_update** | Persist turn; push **latestActions** | Success results | `recentMessages` (via service), downstream memory |

**Contract**: Resolvers write **semantic** args → **`resolverResults`**. Entity resolution writes **ID-resolved** args → **`executorArgs`**. Executor **prefers `executorArgs`**.

---

## 5. State fields (minimal mental model)

| Concern | Fields |
|---------|--------|
| Identity | `threadId`, `traceId` |
| User / time | `user`, `input`, `now`, `authContext` |
| Plan | `plannerOutput`, `routingSuggestions` |
| HITL | `pendingHITL`, `hitlResults` |
| Resolution | `disambiguation`, `resolverResults`, `executorArgs` |
| Execution | `executionResults`, `executedOperations` (idempotency key `traceId:stepId`) |
| Output | `formattedResponse`, `finalResponse`, `error` |
| Memory | `recentMessages`, `latestActions` |
| Ops | `metadata` (LLM cost, node timings) |

Full reducers and types: **`MemoState.ts`**, **`src/types/index.ts`**, **`src/types/hitl.ts`**.

---

## 6. Resolvers & capabilities (7)

Registry: `src/graph/resolvers/ResolverSchema.ts` + `index.ts` — **database_task**, **database_list**, **calendar_find**, **calendar_mutate**, **gmail**, **secondbrain**, **general** (help/meta lives here; no separate meta resolver).

---

## 7. When changing behavior

1. New or changed **operation** → follow **`docs/feature-addition-chain.md`** (schema → resolver → entity resolution → adapter → formatter/writer → docs).
2. **HITL** changes → `HITLGateNode` + `PLANNER_AND_HITL_FLOW.md` + `STATE_SCHEMA.md`.
3. **State shape** → `MemoState.ts` + `STATE_SCHEMA.md`.

---

## 8. Scaling & optimization (pointers)

- **Checkpointer**: dev uses `MemorySaver`; production may swap for persistent store (see `MEMORY_SYSTEM.md`).
- **Concurrency**: `UserRequestLock` — one in-flight graph per user (`webhook.ts`).
- **LLM cost**: models via env (`src/config/llm-config.ts` / environment); planner vs resolver vs writer tiers.
- **Parallelism**: `ResolverRouterNode` groups steps; executor may parallelize by capability — respect **`dependsOn`** on plan steps.
- **Idempotency**: never bypass `executedOperations` for mutating steps.

---

## 9. Related docs

| Doc | Use |
|-----|-----|
| `STATE_SCHEMA.md` | Node-by-node read/write |
| `PLANNER_AND_HITL_FLOW.md` | HITL rules, resume, TTL |
| `SYSTEM_DIAGRAM.md` | Diagrams |
| `feature-addition-chain.md` | Adding capabilities |
| `../../docs/project-instruction/orchestrator-and-flows.md` (repo root) | Orchestration + domain notes |
