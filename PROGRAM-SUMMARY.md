# WhatsApp AI Assistant — Architecture & Capabilities

## 1. Product Overview

- Conversational assistant that answers users over WhatsApp while orchestrating calendar, email, task, and contact workflows.
- Ingests WhatsApp text or audio, transcribes if needed, reasons about intent with OpenAI, and dispatches to specialist agents.
- Persists structured user data in Postgres (tasks, lists, contacts) and keeps short-term chat context in memory to stay conversational.
- Runs scheduled reminder digests and ad-hoc notifications, so users receive proactive updates without prompting.

## 2. High-Level Flow

1. **Incoming webhook** from WhatsApp hits `POST /webhook/whatsapp`.
2. **Routing layer** (`src/routes/webhook.ts`) acknowledges the hook, downloads audio if needed, marks messages read, and calls `processMessageV2`.
3. **AgentManager** singleton boots the V2 multi-agent architecture (MainAgent plus Calendar/Gmail/Database agents, MultiAgentCoordinator) and maintains shared services.
4. **MainAgent** (`src/agents/v2/MainAgent.ts`) records the message in `ConversationWindow`, detects intent via LLM, and either:
   - answers directly, or
   - hands off to the matching specialist agent, or
   - forwards complex multi-step requests to `MultiAgentCoordinator`.
5. **FunctionHandler + Toolsets** expose structured operations (SQL-backed CRUD, Google Calendar, Gmail) that agents may invoke via OpenAI function calls.
6. **Services layer** executes side effects (database queries, Google APIs, WhatsApp replies). Responses are written back to WhatsApp and conversation memory.

```
Incoming WhatsApp → Webhook Router → processMessageV2 → MainAgent
      │                                        │
      │                                        ├─ CalendarAgent ── CalendarService → Google Calendar
      │                                        ├─ GmailAgent ───── GmailService → Gmail API
      │                                        ├─ DatabaseAgent ── Task/List/Contact services → Postgres
      │                                        └─ MultiAgentCoordinator ── MultiAgent plans + specialist agents
      ↓
 WhatsApp response + Reminders/Scheduler side channels
```

## 3. Core Capabilities

- **Conversational reasoning** with context windowing, Hebrew/English detection, and graceful fallbacks.
- **Task & reminder management**: create, update, filter, complete tasks; configure one-time and recurring reminders; push proactive alerts.
- **Calendar workflows**: propose/confirm events, sync with Google Calendar, include attendee data and meeting links.
- **Gmail tasks**: draft and send emails/invitations through Gmail API integrations.
- **Contact intelligence**: look up contacts, enrich multi-step flows (meeting scheduling, invitations).
- **Multi-task planning**: break down compound instructions (e.g., “Find Dana, schedule a call, send invite”) into ordered agent actions.
- **Proactive notifications**: morning digests and due reminders via `SchedulerService` + `ReminderService`.
- **Audio support**: WhatsApp audio downloads + transcription before normal processing.
- **Developer tooling**: debugging scripts, SQL bootstrap, webhook testers, and extensive system prompts guiding LLM behavior.

## 4. Agent & Orchestration Layer

- **AgentManager** (`src/core/manager/AgentManager.ts`)
  - Initializes agents, MultiAgentCoordinator, and shared services via `ServiceContainer`.
  - Enforces singleton lifecycle & exposes getters used across the app.
- **MainAgent** (`src/agents/v2/MainAgent.ts`)
  - Maintains conversation context, performs intent detection (`OpenAIService.detectIntent`), dispatches to specialist agents, or produces general-purpose chat responses.
  - Uses `ConversationWindow` for memory and `SystemPrompts` for behavior control.
- **Specialist agents** (Calendar/Gmail/Database under `src/agents/v2`)
  - Extend `BaseAgent`, leverage OpenAI tool-calling, and call domain-specific functions (`src/agents/functions/*`).
- **MultiAgentCoordinator** (`src/orchestration/MultiAgentCoordinator.ts`)
  - Builds execution plans using dedicated system prompt JSON output.
  - Executes ordered steps via the relevant agents, aggregates results, and crafts final summaries.
  - Handles retries for malformed planner output and dependency tracking between steps.
- **MultiTaskService** (`src/services/multi-task/MultiTaskService.ts`)
  - Parses multi-step instructions into prioritized task lists, enriches with contact lookup, and orchestrates execution (calendar event creation, Gmail follow-ups).

## 5. Services & Integrations

- **ServiceContainer** (`src/core/container/ServiceContainer.ts`) gives dependency-injected access to shared services:
  - `OpenAIService`, `FunctionHandler`, logger.
  - Database services (`TaskService`, `ContactService`, `ListService`, `UserDataService`).
  - External API services (`CalendarService`, `GmailService`, `ContactLookupService`, `MultiTaskService`).
- **OpenAIService** (`src/services/ai/OpenAIService.ts`): wraps chat completions, intent detection, and language detection heuristics.
- **Database services** (`src/services/database`):
  - `TaskService` handles CRUD, reminder calculations, recurrence scheduling, and query compilation via `SQLCompiler`.
  - `ListService`, `ContactService`, `UserDataService` build higher-level operations for agent functions.
- **ReminderService** (`src/services/reminder/ReminderService.ts`): selects tasks needing notifications, formats WhatsApp messages, respects recurrence (daily/weekly/monthly), and sends morning digests.
- **SchedulerService** (`src/services/scheduler/SchedulerService.ts`): sets up cron jobs (every 5 minutes + hourly digest windows) and exposes manual triggers for testing.
- **WhatsApp service** (`src/services/whatsapp.ts`): wraps Graph API calls for messages, typing indicators, read receipts, and media download. Updates conversation memory on send.
- **Transcription** (`src/services/transcription.ts`): converts incoming audio to text before agent processing.
- **Memory** (`ConversationWindow`): lightweight in-memory context limit with support for disambiguation metadata and recent task caching.
- **Logging** (`src/utils/logger.ts`): centralized logger used across services and agents.

## 6. Data & Storage

- **PostgreSQL (Supabase-compatible)** configured in `src/config/database.ts`; query helper exposes pooled `Pool.query`.
- Agents interact with the database exclusively through service wrappers, preserving validation and business rules.
- Conversation history persists in-memory (not in the database). Reminder + scheduler data lives in SQL tables seeded via scripts under `scripts/`.

## 7. Background & Automation

- **Recurring cron jobs**: reminders every 5 minutes; morning digests across multiple UTC hours for timezone coverage (`src/services/scheduler/SchedulerService.ts`).
- **Reminder scheduling**: `TaskService` calculates `next_reminder_at` when tasks are created/updated; `ReminderService` clears or recalculates as reminders fire.
- **Scripts** (`scripts/` directory) support database setup, conversation memory migrations, webhook testing, OAuth setup, and debugging.

## 8. Configuration & Prompts

- `.env` driven settings for database credentials, WhatsApp API tokens, Google OAuth, OpenAI keys, ngrok URL, etc.
- `src/config/system-prompts.ts` stores all system prompts (MainAgent, planner, specialist agents) and is heavily curated (≈1000 lines) to standardize LLM behavior.
- `tsconfig.json` enforces TypeScript compilation targets; `package.json` scripts drive dev/start/test flows.

## 9. File Structure (key areas)

```
src/
  index.ts                # Express startup, webhook wiring, scheduler boot
  index-v2.ts             # V2 architecture bootstrap + processMessageV2 entry
  routes/
    webhook.ts            # WhatsApp webhook verification + message handling
  core/
    base/                 # BaseAgent + FunctionHandler abstractions
    container/            # ServiceContainer singleton
    factory/              # AgentFactory wiring
    manager/              # AgentManager lifecycle
    memory/               # ConversationWindow (chat context)
    orchestrator/         # HITL node / Query resolver scaffolding
  agents/
    v2/                   # MainAgent + specialist agents
    functions/            # Tool/function implementations exposed to LLM
  orchestration/
    MultiAgentCoordinator.ts
    types/                # Planner/Execution type definitions
  services/
    ai/                   # OpenAI wrapper
    calendar/             # Google Calendar integration
    contact/              # Contact lookup helpers
    database/             # Task/List/Contact/UserData services
    email/                # Gmail integration
    multi-task/           # Multi-task parsing/execution
    reminder/             # Reminder orchestration
    scheduler/            # Cron scheduler
    whatsapp.ts           # WhatsApp Graph API client
    transcription.ts      # Media transcription
  tools/                  # Agent toolset builders (Calendar/Database/Gmail)
  utils/                  # Helpers (SQLCompiler, time/text/fuzzy)
  types/                  # Shared TypeScript interfaces
docs/                     # Design notes, plans, progress logs
scripts/                  # Setup & diagnostic scripts (SQL + JS/TS helpers)
tests/                    # Jest coverage (currently Gmail service)
```

## 10. Operational Notes

- **Startup**: `npm run dev` (or similar) loads `.env`, starts Express, verifies DB, starts scheduler, and logs webhook URLs (ngrok-compatible).
- **Error handling**: webhook catches exceptions and notifies users; WhatsApp send failures are logged (e.g., recipient not on allowed list).
- **Extensibility**: add agents via `AgentFactory`, register functions in `FunctionHandler`, and update prompts accordingly. ServiceContainer centralizes dependency injection for new services.
- **Testing**: Minimal Jest coverage in `tests/`; use scripts for integration checks (webhook tester, database seeding).
- **Deployment considerations**: ensure WhatsApp Business API recipients are whitelisted in development, rotate API tokens, secure env variables, and monitor cron job health.

---

Use this overview as a hand-off reference for any teammate or automation agent that needs to understand how the WhatsApp AI assistant is organized, what integrations it touches, and where to extend or debug behaviors.
