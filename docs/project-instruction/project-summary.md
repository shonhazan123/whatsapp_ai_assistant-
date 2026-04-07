# Focus WhatsApp Assistant — Project Summary

## Overview

**Memo_v2** is the current runtime: a **LangGraph** pipeline in `Memo_v2/` that handles WhatsApp messages end-to-end. It uses shared business logic via **`Memo_v2/src/legacy/`** (services, DB, Google APIs) through **adapters** — the graph does not depend on the legacy `src/agents/v2` / `MultiAgentCoordinator` path.

Users get calendar, tasks/reminders/lists, Gmail, and second-brain memory through natural language (Hebrew and English).

---

## Message types

1. **Text** — Full graph: context → planner → resolvers → execution → response.
2. **Voice** — Transcription (Whisper), then same as text.
3. **Image** — Vision analysis when applicable; caption + memory inform language and follow-up.

---

## Runtime architecture (Memo_v2)

**Entry**: `Memo_v2/src/routes/webhook.ts` calls **`invokeMemoGraphSimple`** from **`Memo_v2/src/graph/index.ts`** (after user/subscription checks and `UserRequestLock`).

**Flow** (see **`docs/project-instruction/orchestrator-and-flows.md`**):

`context_assembly` → `reply_context` → `planner` → `capability_check` → `hitl_gate` → `resolver_router` → `entity_resolution` → `executor` → `join` → `response_formatter` → `response_writer` → `memory_update`.

- **Planning**: `PlannerNode` emits structured `plannerOutput` (not legacy “intent + requiresPlan”).
- **Routing**: `ResolverSchema` + **`selectResolver()`** map each step to one of **seven** resolvers (no separate “meta” resolver — help/capabilities live in **`GeneralResolver`** / `general_resolver`).
- **HITL**: `HITLGateNode` only; `interrupt()` + resume with **`Command({ resume })`**; see **`Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`**.

---

## Capabilities (domain)

| Area | Role |
|------|------|
| **Calendar** | Google Calendar events (incl. recurring), conflicts, reads/writes. |
| **Database** | Tasks, reminders, lists (not calendar events). |
| **Gmail** | Read/search/compose/manage (requires Google). |
| **Second brain** | Long-term notes / semantic recall. |
| **General** | Help, capabilities, conversation, meta questions. |

Behavioral detail: **`docs/project-instruction/agents-*.md`** and **`Memo_v2/docs/capabilities/`**.

---

## Key features

- **Timezone**: User timezone from DB (`ContextAssemblyNode`); helpers in `Memo_v2/src/utils/userTimezone.ts`.
- **Morning brief**: Per-user preferred time stored in `users.morning_brief_time` (Postgres `TIME`, default `08:00`). The hourly cron (`SchedulerService`) calls `ReminderService.sendMorningDigest()` which checks each user's local time against their preferred brief time (15-minute window). Time is set via a third-party website; `UserService.updateMorningBriefTime()` persists it. If the user asks in WhatsApp to **change** that time, the **planner** routes to **`general`** (`morning_brief_time`); **GeneralResolver** tells them to open **website settings** (`settingsUrl` in `meta-info.ts`), not chat.
- **Language**: Detected once per message (`languageDetection.ts`); stored on `state.user.language`.
- **Memory**: Recent messages + **`latestActions`** for referential follow-ups; see **`Memo_v2/docs/MEMORY_SYSTEM.md`**.
- **Concurrency**: One active graph run per WhatsApp number (`UserRequestLock`).

---

## Documentation index

| Document | Purpose |
|----------|---------|
| **`Memo_v2/docs/ARCHITECT_REVIEW_PACKAGE.md`** | **External / senior review**: ordered attach list, agent reasoning model, token & latency code pointers |
| **`orchestrator-and-flows.md`** | Graph order, resolver registry, webhook/HITL pointers |
| **`agents-calendar.md`**, **`agents-database.md`**, **`agents-gmail.md`**, **`agents-second-brain.md`** | Domain rules (what each area may/must not do) |
| **`google-oauth-backend-implementation.md`** | OAuth |
| **`production-debug-environment-plan.md`** | Debug routing |
| **`Memo_v2/docs/STATE_SCHEMA.md`** | LangGraph state |
| **`Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`** | HITL contract |
| **`Memo_v2/docs/SYSTEM_DIAGRAM.md`** | Diagrams |
| **`Memo_v2/docs/feature-addition-chain.md`** | Adding operations |

---

## Tech stack

- **Runtime**: Node.js, TypeScript (`Memo_v2/`)
- **LLMs**: OpenAI (planner/resolvers/writer models via env)
- **DB**: PostgreSQL (Supabase)
- **External**: WhatsApp Cloud API, Google Calendar, Gmail, embeddings for second brain
