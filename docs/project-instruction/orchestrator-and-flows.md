# Memo_v2 Orchestrator & Flows (LangGraph)

Runtime behavior described here matches **`Memo_v2/src/graph/index.ts`**, **`MemoState`**, and the nodes listed below. For state and HITL details, see **`Memo_v2/docs/STATE_SCHEMA.md`** and **`Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`**.

---

## End-to-end graph (WhatsApp → response)

1. **`context_assembly`** — Load user, auth, memory, `latestActions`, `traceId`, `now` (user timezone).
2. **`reply_context`** — Enrich message with reply-to and image context.
3. **`planner`** — LLM produces `plannerOutput` (`PlanStep[]`, confidence, risk, `missingFields`, etc.). If JSON parsing or structural validation fails, the node emits `missingFields: ['intent_unclear']` (no heuristic “process request” / pattern routing); **HITL** clarifies and resumes to replan.
4. **`capability_check`** — If the plan needs Google (calendar/gmail) and the user lacks connection, sets `finalResponse` and skips execution.
5. **`hitl_gate`** — Single HITL control plane: `interrupt()` for planner clarification/approval or entity disambiguation; resume via `Command({ resume })` → `Command({ update, goto })`.
6. **`resolver_router`** — Runs capability resolvers (parallel where safe), fills `resolverResults`.
7. **`entity_resolution`** — Semantic args → IDs → `executorArgs`; may set machine-only `disambiguation` and route back to **`hitl_gate`**.
8. **`executor`** — Service adapters; prefers `executorArgs` over `resolverResults`.
9. **`join`** → **`response_formatter`** → **`response_writer`** → **`memory_update`** → END.

Canonical: `Memo_v2/src/graph/index.ts`.

---

## User timezone (single reference – never server)

All time and calendar logic uses the **user’s timezone** as the single reference. Server local time or UTC must not be used for “current time”, “today”, or event start/end.

- **Source of truth**: `state.user.timezone` / `state.input.timezone` (from user record; default `Asia/Jerusalem`). Set in **ContextAssemblyNode** from `authContext.userRecord.timezone`.
- **Time context**: `state.now` is built in **ContextAssemblyNode** using the user’s timezone. Resolvers and entity resolution receive this via `state.now` and `context.timeContext.timezone`.
- **Shared helpers**: `Memo_v2/src/utils/userTimezone.ts` — `getStartOfDayInTimezone`, `getEndOfDayInTimezone`, `buildDateTimeISOInZone`, `normalizeToISOWithOffset`, `getDatePartsInTimezone`.
- **Calendar**: Resolver defaults, entity-resolver windows, adapter fallbacks, and **CalendarService** (including recurring events) use the user timezone.

---

## User response language (detect once, use everywhere)

- **Where**: `Memo_v2/src/utils/languageDetection.ts` — `detectUserResponseLanguage(text, options?)`.
- **When**: **ContextAssemblyNode** sets `state.user.language` and `input.language`.
- **Image flow** (no graph): language from caption + last user message; picture without text defaults to Hebrew.
- **Downstream**: Planner, resolvers, ResponseFormatterNode, HITLGateNode, image analysis use `state.user.language`.

---

## Resolver schema system

**PlannerNode** uses **`ResolverSchema.ts`** for routing hints and consistent resolver selection. **`selectResolver()`** uses schema **`actionHints`** as the single source of truth per capability.

### Schema registry (7 resolvers)

There is **no separate meta resolver**. Help, capabilities, and general chat are handled by **`general_resolver`** / **GeneralResolver**.

| Schema name | Resolver class | Capability |
|-------------|----------------|------------|
| `database_task_resolver` | DatabaseTaskResolver | database |
| `database_list_resolver` | DatabaseListResolver | database |
| `calendar_find_resolver` | CalendarFindResolver | calendar |
| `calendar_mutate_resolver` | CalendarMutateResolver | calendar |
| `gmail_resolver` | GmailResolver | gmail |
| `secondbrain_resolver` | SecondBrainResolver | second-brain |
| `general_resolver` | GeneralResolver | general |

Files: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`, `Memo_v2/src/graph/resolvers/index.ts` (`RESOLVER_REGISTRY`, `RESOLVER_SCHEMAS`).

### Routing hints (planner behavior)

1. **General / “what can you do”** — `GeneralResolver` + `Memo_v2/src/config/capabilities-for-users.ts` for canonical capability text (one complete message).
2. **Second-brain** — remember / recall phrases.
3. **Gmail** — when connected.
4. **Database vs calendar** — e.g. “תזכיר לי” → database task resolver; “תקבע” / scheduling without standalone reminder → calendar.
5. **General** — conversational or out-of-scope requests routed by the planner LLM (not by a separate pattern-based planner fallback).

---

## Webhook: registration, subscription, concurrency

- **Not in DB / inactive subscription**: `Memo_v2/src/routes/webhook.ts` may respond without invoking the graph (signup / rejoin messages).
- **Active user**: graph runs via **`invokeMemoGraph`**; delivery uses **`deliverMemoGraphInvokeResult`** (`Memo_v2/src/services/whatsappGraphSend.ts`) so planner HITL with `expectedInput: yes_no` can send **approved WhatsApp templates** (Hebrew) when env vars are set; otherwise plain text via **`sendWhatsAppMessage`**. **`invokeMemoGraphSimple`** remains for callers that only need the response string.
- **One in-flight request per user**: `Memo_v2/src/services/concurrency/UserRequestLock.ts` (`runExclusive`); busy users get a short “one request at a time” message.

### WhatsApp message templates (Hebrew, optional)

- **Create / list templates**: Meta Graph API on the WhatsApp Business Account (`message_templates`). Helper scripts and env documentation live in **`Memo_v2/whatsapp-templates-api/`** (create + send-test).
- **Send from runtime**: `Memo_v2/src/services/whatsapp.ts` — **`sendWhatsAppTemplateMessage`**. Morning digest uses **`WHATSAPP_TEMPLATE_HE_MORNING`** when set (`ReminderService`). HITL yes/no uses **`WHATSAPP_TEMPLATE_HE_HITL_CONFIRM`** for `reason === high_risk` and **`WHATSAPP_TEMPLATE_HE_HITL_YN`** for `needs_approval` (and fallback). Language code: **`WHATSAPP_TEMPLATE_LANG_HE`** (default `he`).
- **Interrupt metadata**: `InterruptPayload.metadata` includes **`reason`** (`HITLReason`) for template selection.

---

## HITL (two families, one node)

Both use **`HITLGateNode`** and a single **`pendingHITL`** contract:

1. **Planner HITL** — clarification / approval (`confidence`, `missingFields`, risk, `needsApproval`).
2. **Entity-resolution HITL** — disambiguation when **`EntityResolutionNode`** sets unresolved `disambiguation.candidates`; graph routes **`entity_resolution` → `hitl_gate`**.

Resume: fast path + LLM interpreter (planner only) → **`Command({ update, goto })`**. Selection and validated replies live in **`hitlResults[hitlId]`**; entity apply uses **`applySelection`** after resume.

TTL: **5 minutes** (`HITL_TTL_MS`); expired interrupts drop checkpoints and process the next message as a fresh run (question remains in memory).

Details: `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`.

---

## Multi-step responses

**JoinNode** → **ResponseFormatterNode** → **ResponseWriterNode** merges multi-capability results into one conversational reply (`stepResults`, `Memo_v2/src/config/response-formatter-prompt.ts`).

---

## Files of interest (Memo_v2)

| Concern | Path |
|--------|------|
| Graph compile + routers | `Memo_v2/src/graph/index.ts` |
| State | `Memo_v2/src/graph/state/MemoState.ts` |
| Planner | `Memo_v2/src/graph/nodes/PlannerNode.ts` |
| HITL | `Memo_v2/src/graph/nodes/HITLGateNode.ts` |
| Resolvers | `Memo_v2/src/graph/resolvers/*.ts` |
| Entity resolution | `Memo_v2/src/graph/nodes/EntityResolutionNode.ts`, `Memo_v2/src/services/resolution/*` |
| Execution | `Memo_v2/src/graph/nodes/ExecutorNode.ts`, `Memo_v2/src/services/adapters/*` |
| Webhook | `Memo_v2/src/routes/webhook.ts` |

---

## Domain docs (behavioral contracts)

Per-capability semantics (what “calendar” vs “database” may do) still live here; execution is always through the graph above:

- `docs/project-instruction/agents-calendar.md`
- `docs/project-instruction/agents-database.md`
- `docs/project-instruction/agents-gmail.md`
- `docs/project-instruction/agents-second-brain.md`

Deep technical detail: `Memo_v2/docs/capabilities/*.md`.
