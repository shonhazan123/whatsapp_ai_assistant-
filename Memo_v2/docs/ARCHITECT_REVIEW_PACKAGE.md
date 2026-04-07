# Senior architect / supervisor — context package

Use this file as the **table of contents** when giving an external model (e.g. Claude in another project or session) full product context for **architecture review**, **workflow optimization**, **latency**, and **token/cost** analysis.

**Rule of truth**: If any document disagrees with code, **code wins**. Verify against the runtime paths listed in [Runtime truth (must cite when auditing)](#runtime-truth-must-cite-when-auditing).

---

## 1. Minimum attach bundle (start here)

Attach **in this order** so the reviewer builds a correct mental model before diving into domains.

| # | Path | Why |
|---|------|-----|
| 1 | `Memo_v2/docs/CLAUDE_CODE_REFERENCE.md` | Short system map: graph order, nodes, state fields, resolver list, scaling pointers. |
| 2 | `docs/project-instruction/project-summary.md` | Product intent, message types, high-level Memo_v2 description, doc index. |
| 3 | `docs/project-instruction/orchestrator-and-flows.md` | End-to-end LangGraph flow, timezone/language rules, webhook/HITL, resolver registry. |
| 4 | `Memo_v2/docs/STATE_SCHEMA.md` | What each node reads/writes; essential for reasoning about state and bugs. |
| 5 | `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md` | Two HITL families, `interrupt`/`resume`, TTL — core control plane. |

Optional pointer file at repo root: `docs/CLAUDE_CODE_REFERENCE.md` — redirects to item 1; you can attach either, not both.

---

## 2. Deep bundle (architecture, contracts, and domains)

Add these when the goal is **end-to-end correctness**, **new capabilities**, or **resolver/entity/executor alignment**.

| Area | Paths |
|------|--------|
| Graph & diagrams | `Memo_v2/docs/SYSTEM_DIAGRAM.md` |
| Resolver contracts | `Memo_v2/docs/RESOLVER_SPECS.md`, `Memo_v2/docs/RESOLVER_ROUTER_FLOW.md` |
| Response shapes | `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md` |
| Memory & follow-ups | `Memo_v2/docs/MEMORY_SYSTEM.md` |
| Feature workflow | `Memo_v2/docs/feature-addition-chain.md` |
| Capability README | `Memo_v2/docs/capabilities/README.md` |
| Per-capability contracts | `Memo_v2/docs/capabilities/general.md`, `database.md`, `calendar.md`, `gmail.md`, `second-brain.md` |
| Calendar recurrence | `Memo_v2/docs/CALENDAR_RECURRING.md` |
| Auth / Google | `Memo_v2/docs/AUTH_FLOW.md` |
| Infra / serialization | `Memo_v2/docs/REQUEST_SERIALIZATION.md` (if debugging gateway or payloads) |

---

## 3. Repo-root `docs/project-instruction` (domain policy)

These define **what each domain may/must not do** in natural language; execution is always through the graph.

| File | Scope |
|------|--------|
| `docs/project-instruction/agents-calendar.md` | Calendar semantics vs database, scheduling language. |
| `docs/project-instruction/agents-database.md` | Tasks, reminders, lists. |
| `docs/project-instruction/agents-gmail.md` | Gmail operations and boundaries. |
| `docs/project-instruction/agents-second-brain.md` | Long-term memory / notes. |
| `docs/project-instruction/google-oauth-backend-implementation.md` | OAuth wiring. |
| `docs/project-instruction/production-debug-environment-plan.md` | Debug routing / ops notes. |

---

## 4. Agent reasoning model (how “thinking” is split)

This is the **logical** pipeline an external architect should optimize against (not necessarily one LLM call).

1. **Context assembly** — Deterministic load: user, auth, memory window, `latestActions`, `traceId`, `now` in user timezone.
2. **Reply / image context** — Enriches `input` (reply-to, vision caption path).
3. **Planner (LLM)** — Emits structured `plannerOutput` (steps, confidence, risk, `missingFields`). **No hidden execution** here — only plan.
4. **Capability check** — Deterministic gate (e.g. Google required but disconnected → early `finalResponse`).
5. **HITL gate** — Single control plane: planner HITL (clarify/approve) or entity HITL (disambiguation). Uses `interrupt()` and resume.
6. **Resolver router (LLM per step/capability)** — Semantic args only → `resolverResults`.
7. **Entity resolution (mostly deterministic + DB/search)** — Semantic → IDs → `executorArgs`; may set `disambiguation` and return to HITL.
8. **Executor** — Side effects via **adapters**; idempotency via `executedOperations` / `traceId:stepId`.
9. **Join → response formatter → response writer (LLM)** — One user-facing reply; memory persistence last.

**Design principle (canonical)**: *LLMs reason and structure; code executes and enforces gates.* See also `Memo_v2/docs/BLUEPRINT.md` § principles (large file; skim executive summary only if time-boxed).

---

## 5. Token, cost, latency — where to look in code

There is no single “token doc”; reviewers should inspect:

| Concern | Where |
|---------|--------|
| Model tiers / env | `Memo_v2/src/config/llm-config.ts` and environment variables referenced there. |
| Per-turn metadata | `Memo_v2/src/graph/state/MemoState.ts` — `metadata` (e.g. LLM cost, timings if populated by nodes). |
| Parallel resolver work | `Memo_v2/src/graph/nodes/ResolverRouterNode.ts` (and related grouping). |
| Duplicate / wasted calls | Planner vs multiple resolvers vs writer — trace one request in logs with `traceId`. |
| Concurrency / queueing | `Memo_v2/src/services/concurrency/UserRequestLock.ts`, `Memo_v2/src/routes/webhook.ts`. |
| Checkpoints / memory cost | `Memo_v2/docs/MEMORY_SYSTEM.md`, graph teardown in `Memo_v2/src/graph/index.ts` (`invokeMemoGraph` checkpoint behavior). |

Historical analysis (may be partially stale): `docs/architecture-analysis/`, `docs/cached-tokens-tracking-plan.md` — use for ideas, verify against current code.

---

## 6. Runtime truth (must cite when auditing)

| Concern | Path |
|---------|------|
| Graph definition & invoke | `Memo_v2/src/graph/index.ts` |
| Shared state shape | `Memo_v2/src/graph/state/MemoState.ts` |
| Public types | `Memo_v2/src/types/index.ts`, `Memo_v2/src/types/hitl.ts` |
| Planner routing / resolver registry | `Memo_v2/src/graph/resolvers/ResolverSchema.ts`, `Memo_v2/src/graph/resolvers/index.ts` |
| User-facing reply shaping | `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts`, `Memo_v2/src/graph/nodes/ResponseWriterNode.ts`, `Memo_v2/src/config/response-formatter-prompt.ts` |

---

## 7. Large or historical docs (use with care)

| Path | Note |
|------|------|
| `Memo_v2/docs/BLUEPRINT.md` | Long migration-era spec; principles and diagrams are useful, but **verify** every claim against `index.ts` and current nodes. |
| `docs/MIGRATE_SERVER_AND_WEBHOOK_TO_MEMO_V2.md` | Migration notes; may not reflect only-current behavior. |
| `docs/architecture-analysis/*` | Planning-era; treat as hypotheses unless reconciled with code. |

---

## 8. Suggested prompt stub (paste for the reviewer)

You can prepend:

> You are the senior architect for a WhatsApp AI assistant. Ground truth is TypeScript in `Memo_v2/src/graph/` (especially `index.ts`, `MemoState.ts`). Read `Memo_v2/docs/ARCHITECT_REVIEW_PACKAGE.md` first, then the tier-1 docs it lists. Propose improvements to workflow, latency, token use, and architecture; flag any place docs diverge from code.

---

## 9. Checklist: docs vs product contract

The engineering contract expects **docs to match runtime code**. When the reviewer finds drift, the fix is either **update the doc** or **change the code** — see `Memo_v2/docs/feature-addition-chain.md` for the full change chain for new operations.
