# Focus WhatsApp Assistant – Master Architecture & Capability Manual (LLM-Centric Guide) 🧠📱🗂️

This document is your **single source of truth** for how the system works end‑to‑end: agents, services, helpers, orchestrator, and all LLM usage patterns.  
Before adding features or debugging, skim this to know **which layer is responsible for what** and **where to change things**.

---

## 1. High-Level Architecture

- **Entry points**
  - `src/index.ts`, `src/index-v2.ts` – HTTP server, webhook handling, basic wiring.
  - `src/routes/webhook.ts` – WhatsApp inbound messages → agent/architecture.
  - `src/routes/auth.ts` – Google OAuth callback + connection.
- **Core concepts**
  - **Agents (v2)** – One agent per domain:
    - `CalendarAgent`, `GmailAgent`, `DatabaseAgent`, `SecondBrainAgent`, `MainAgent` (`src/agents/v2`).
    - All extend `BaseAgent` and use function calls into `*Functions.ts`.
  - **Function handlers** – Domain function wrappers:
    - `CalendarFunctions`, `GmailFunctions`, `DatabaseFunctions`, `SecondBrainFunction` (`src/agents/functions`).
    - They expose **parameter schemas** and call the appropriate services.
  - **Services** – Stateful/stateless logic, DB + external APIs:
    - Calendar, Gmail, reminders, database, second brain (vector DB), etc. (`src/services/**`).
  - **Orchestration**
    - `MultiAgentCoordinator` (`src/orchestration/MultiAgentCoordinator.ts`) – high‑level planner/runner for multi‑step/multi‑agent workflows.
    - `QueryResolver` (`src/core/orchestrator/QueryResolver.ts`) – fuzzy lookup across events/tasks/contacts/lists/emails.
  - **LLM + prompts**
    - `OpenAIService` (`src/services/ai/OpenAIService.ts`) – **single gateway** for chat completions, vision, embeddings.
    - `SystemPrompts` (`src/config/system-prompts.ts`) – all system prompts for agents, planner, classifier, etc.
  - **Shared infrastructure**
    - `ServiceContainer` (`src/core/container/ServiceContainer.ts`) – DI-like central registry for services.
    - `RequestContext` (core + performance version) – per-request user + performance context.
    - `PerformanceTracker` + `performanceUtils` – metrics + token usage, last AI call tracking.
    - `ConversationWindow` – short-term memory for disambiguation and context.

**Mental model:**  
WhatsApp message → MainAgent (intent recognition) → (1) direct agent call **or** (2) MultiAgentCoordinator plan → Agents → Functions → Services (DB/Google) → result → summary back to WhatsApp.

---

## 2. Agents & Their Functions (Execution Path)

### 2.1 BaseAgent (common behavior)

File: `src/core/base/BaseAgent.ts`

- **executeWithAI(message, userPhone, systemPrompt, functions, context)**:
  - Builds messages: `[systemPrompt, ...context, user message]`.
  - Calls `OpenAIService.createCompletion` with:
    - `functions`: the function definitions for that agent.
    - `functionCall: 'auto'`.
  - Handles **both** `function_call` (legacy) and `tool_calls` (tools):
    - Extracts `functionName`, `functionArgs`, and optional `tool_call_id`.
    - Looks up user ID via `RequestContext` or phone.
    - Calls `functionHandler.executeFunction(functionName, functionArgs, userId)`.
  - Then **does a second LLM call**:
    - Passes system prompt + context + user message + assistant function call + tool result.
    - Receives final natural-language response for WhatsApp.
  - **filterAgentResponse** removes JSON/tool noise and internal errors from final content.

> When adding a new agent: extend `BaseAgent`, override `getSystemPrompt`, `getFunctions`, and route into a `*Functions.ts` file and services.

### 2.2 Domain Agents (v2)

Files: `src/agents/v2/*.ts`

- **MainAgent**

  - Uses `SystemPrompts.getMainAgentPrompt()`.
  - Routes high-level chat, explains behavior, triggers other agents via orchestrator when needed.
  - Calls `OpenAIService.detectIntent` indirectly via orchestrator/intent classifier.

- **CalendarAgent**

  - Uses `SystemPrompts.getCalendarAgentPrompt()`.
  - Exposes single tool `calendarOperations` (via `CalendarFunction`).
  - Delegates to `CalendarService` through `CalendarFunctions`.

- **DatabaseAgent**

  - System prompt: tasks/reminders, lists, contacts only.
  - Tools: `taskOperations`, `listOperations`, `contactOperations` (via `DatabaseFunctions`).

- **GmailAgent**

  - Handles Gmail read/search/compose/manage via `GmailFunctions` → `GmailService`.

- **SecondBrainAgent**
  - Unstructured memory (store/search/summarize notes) via `SecondBrainService`.

> For **per-agent details**, see the per‑agent docs already created:
>
> - `docs/project-instruction/agents-calendar.md`
> - `docs/project-instruction/agents-gmail.md`
> - `docs/project-instruction/agents-database.md`
> - `docs/project-instruction/agents-second-brain.md`

---

## 3. Function Handlers (Tools Layer)

Files: `src/agents/functions/*.ts`

- **CalendarFunctions**

  - Tool name: `calendarOperations`.
  - Parameter schema: all calendar operations:
    - `create`, `createMultiple`, `createRecurring`, `get`, `getEvents`, `update`, `delete`, `deleteBySummary`, `getRecurringInstances`, `checkConflicts`, `truncateRecurring`.
  - Wraps `CalendarService` and handles:
    - Timezone normalization (`timezone` → `timeZone`).
    - All‑day detection by date-only strings.
    - Reminder mapping (`reminderMinutesBefore` → `CalendarReminders`).
    - Attendee extraction from text.
    - Flexible resolution of events via `QueryResolver` when only summary/time window is given.

- **DatabaseFunctions**

  - Tool name: `taskOperations` / `listOperations` / `contactOperations`.
  - Abstracts `TaskService`, `ListService`, `ContactService`.
  - Handles:
    - Recurring reminder schema: `{ type: 'daily'|'weekly'|'monthly', time, days?, dayOfMonth?, until? }`.
    - Bulk operations with preview (`deleteAll`, `updateMultiple`).
    - Conversation-window snapshots for recent tasks.

- **GmailFunctions**

  - Tool name: `gmailOperations`.
  - Wraps `GmailService`.
  - Defines operations: search, read, compose, send, reply, label, archive/delete, mark read/unread.

- **SecondBrainFunction**
  - Tool name: usually `secondBrainOperations` (check file).
  - Wraps `SecondBrainService` for memory CRUD + semantic search.

> Function handlers are where **LLM-facing JSON schemas** live. When you add/change capabilities, you must:
>
> 1. Update schema here.
> 2. Update the corresponding `SystemPrompts` sections that teach the LLM how to call them.

---

## 4. Services Layer (What Actually “Does Work”)

All under `src/services/**`. These should be **LLM-agnostic** (pure logic + I/O).

### 4.1 AI & LLM services

File: `src/services/ai/OpenAIService.ts`

- **createCompletion(request, requestId?)**

  - Central wrapper for `openai.chat.completions.create`.
  - Handles:
    - Tools vs legacy functions for models.
    - Temperature/max tokens; converts to `max_completion_tokens` when required.
    - Performance logging: saves token usage; logs AI call metadata via `PerformanceTracker`.
  - **This is the only place** that should directly call `openai.chat.completions.create` in the app.

- **generateResponse(message)**:

  - Uses `SystemPrompts.getMessageEnhancementPrompt()` to polish text or generate natural-language responses.

- **detectIntent(message, context)**:

  - Uses `SystemPrompts.getIntentClassifierPrompt()` to output `IntentDecision` (from `OpenAIFunctionHelper`):
    - `primaryIntent`, `requiresPlan`, `involvedAgents[]`.

- **detectLanguage(message)**:

  - Cheap heuristic (Hebrew vs English vs other) → avoids LLM calls for language detection.

- **analyzeImage(imageBuffer, caption?)**

  - GPT‑4o vision call; uses `SystemPrompts.getImageAnalysisPrompt()`.
  - Handles caching, validation/compression, retries, timeouts.
  - Returns normalized `ImageAnalysisResult` with `formattedMessage`.

- **createEmbedding(text)**:
  - Calls `openai.embeddings.create` with `text-embedding-3-small`.
  - Used by `SecondBrainService` for vector storage/search.

### 4.2 Domain services (non‑LLM)

- **CalendarService** (`src/services/calendar/CalendarService.ts`)

  - Google Calendar integration:
    - OAuth (`UserService` + tokens), resolving calendar IDs.
    - `createEvent`, `createMultipleEvents`.
    - `createRecurringEvent` (RRULE based) – weekly vs monthly.
    - `getEvents`, `getEventById`, `events.instances`, conflicts check.
    - `truncateRecurringEvent` (patch RRULE’s `UNTIL`).

- **GmailService** (`src/services/email/GmailService.ts`)

  - Gmail API operations: search, list, read, send, reply, label changes, delete/archive, mark read/unread.

- **ReminderService** (`src/services/reminder/ReminderService.ts`)

  - Computes next reminder times based on recurrence rules for database tasks.
  - Coordinates with `SchedulerService`.

- **SchedulerService** (`src/services/scheduler/SchedulerService.ts`)

  - Cron/interval-based background scheduling (e.g., reminders).

- **TaskService / ListService / ContactService / UserDataService / UserService / OnboardingService** (`src/services/database/*.ts`)

  - DB access for:
    - Tasks/reminders, lists and list items, contacts, user metadata, onboarding flows.
  - `BaseService` encapsulates DB Client + helpers.

- **SecondBrainService** (`src/services/memory/SecondBrainService.ts`)

  - Uses `OpenAIService.createEmbedding` to store/search vectorized notes.
  - Provides CRUD + semantic search.

- **ContactLookupService** (`src/services/contact/ContactLookupService.ts`)

  - Higher-level contact search, used by `MultiTaskService` or others for person resolution.

- **MultiTaskService** (`src/services/multi-task/MultiTaskService.ts`)

  - High-level “macro” executor for multi-step user requests **within one domain** (older path; MultiAgentCoordinator is the new generic planner).
  - `parseMultiTaskRequest` → LLM-based parser for multiple tasks.
  - `executeMultiTask` loops tasks:
    - Handles `contact_lookup` specially to reuse contact data.
    - Executes tasks via appropriate agents and composes a summary (`✅ ביצעתי ...`).

- **WhatsApp / transcription / image pipeline**
  - `src/services/whatsapp.ts` – sends/receives WhatsApp messages.
  - `src/services/transcription.ts` – likely use ASR (depends on env) to transcribe audio.
  - `src/services/image/*` – image caching + processing for vision.

### 4.3 Performance & context

- **PerformanceTracker + PerformanceLogService** (`src/services/performance/*`)

  - Logs:
    - AI calls (type, tokens, duration, function calls).
    - Agent execution times.
  - Works with `performanceUtils.setAgentNameForTracking` to tag flows.

- **RequestContext** (core + performance)
  - Holds per-request user data (whatsappNumber, Google connection flags, capabilities).
  - Also stores last AI call info for introspection.

---

## 5. Orchestrator & Planner (Multi-Agent)

### 5.1 MultiAgentCoordinator

File: `src/orchestration/MultiAgentCoordinator.ts`

- `handleRequest(messageText, userPhone, context)`

  1. Calls `OpenAIService.detectIntent` → `IntentDecision`.
  2. Computes `involvedAgents` from decision.
  3. Checks if plan needed:
     - If **no** plan and single agent → direct `executeSingleAgent`.
     - Else → build planner messages and call `requestPlan`.
  4. Filters plan by allowed agents (capabilities + connection), executes via `executePlan`, and builds a summary when needed.

- `planActions` → uses `SystemPrompts.getMultiAgentPlannerPrompt()`:

  - Planner must output **JSON array** of `PlannedAction`.

- `normalizePlan` → cleans/validates planner output; enforces supported agents only.

- `executePlan`:

  - For each action:
    - Check `dependsOn` for unmet/failed dependencies (then mark `blocked`).
    - Call `agent.processRequest(executionPayload, userPhone, runningContext)`.
    - Store `ExecutionResult` with `status: 'success'|'failed'|'blocked'`.
    - Append successful assistant responses to context.

- `buildSummary`:
  - Wraps `plan` + `results` into a JSON object.
  - Calls `OpenAIService.createCompletion` with `SystemPrompts.getMultiAgentSummaryPrompt()`.
  - Fallback: simple statistical summary if LLM fails.

### 5.2 Planner & Classifier Prompts

File: `src/config/system-prompts.ts`

- **MultiAgentPlannerPrompt** (`getMultiAgentPlannerPrompt`):

  - Defines `PlannedAction` schema.
  - Emphasizes:
    - Correct agent per responsibility.
    - Multi-step same-agent sequences (delete+create) with `dependsOn`.
    - JSON-only output, no prose.

- **MultiAgentSummaryPrompt** (`getMultiAgentSummaryPrompt`):

  - Summarizes `plan + results` into human text.
  - Keeps under ~8 sentences; mirrors language.

- **IntentClassifierPrompt** (`getIntentClassifierPrompt`):

  - Identifies:
    - Involved agents, `requiresPlan`.
    - Distinguishes general chat vs calendar/gmail/database/second-brain.
    - Has special rules to route descriptive feedback to second-brain.

- **Agent-specific prompts**:
  - Calendar, Gmail, Database, SecondBrain, Main:
    - Teach the LLM how to build JSON for each function call.
    - Contain examples and critical rules (e.g., days for recurring, reminders, not inventing data).

> **Important rule:** When capabilities change, update both:
>
> - Function schemas (`*Functions.ts`).
> - Corresponding prompt sections (`SystemPrompts`) to prevent tool misuse.

---

## 6. QueryResolver & Disambiguation

File: `src/core/orchestrator/QueryResolver.ts`

- **resolve(query, userPhone, domain)**:

  - Domains: `task`, `contact`, `list`, `event`, `email`.
  - For each:
    - Fetches all relevant items (through `TaskService`, `ListService`, `ContactService`, `CalendarService`, `GmailService`).
    - Uses `FuzzyMatcher.search` over key fields.

- **resolveOneOrAsk**:

  - If 0 results → `{ entity: null, reason: 'no_match' }`.
  - If multiple ambiguous results → returns `disambiguation` info.

- **formatDisambiguation**:

  - Produces user-facing text (Heb/En) listing candidates and asking for a number.

- **resolveWithDisambiguationHandling**:
  - Handles follow-up when user replies with a number.
  - Uses `ConversationWindow` to recall disambiguation contexts.

> When adding entities that need natural-language resolution (e.g., new domain), extend `EntityDomain` and add handlers here.

---

## 7. Helpers & Utilities

### 7.1 utils

- `fuzzy.ts` – generic fuzzy search on arrays of objects (used by QueryResolver, deleteBySummary, etc.).
- `time.ts` – `TimeParser` to understand natural-language dates/ranges and convert to ISO windows.
- `text.ts` – text utilities, some may call LLM for rewriting/summarizing.
- `logger.ts` – centralized logger wrapper.
- `helpers.ts` – miscellaneous helpers (formatting, maybe validation).
- `SQLCompiler.ts` – helps build safe parameterized SQL queries.

### 7.2 core/memory

- `ConversationWindow` – short-term memory per user (recent tasks, disambiguation contexts).
  - Used by `QueryResolver` and Database agent to reference recent items without full re-lookup.

### 7.3 onboarding

- `OnboardingFlow`, `onboardingMessages`, `UserOnboardingHandler`, `OnboardingService`:
  - Manage multi-step onboarding flows; query DB to track onboarding state and send appropriate messages.

---

## 8. LLM Call Types – Where and Why

**All LLM calls go through `OpenAIService`** (plus vision/embeddings).

- **Chat / tool calling** (`createCompletion`):

  - Agents: via `BaseAgent.executeWithAI`.
  - Planner: `MultiAgentCoordinator.requestPlan`.
  - Summary: `MultiAgentCoordinator.buildSummary`.
  - Intent classifier: `OpenAIService.detectIntent`.
  - MultiTask parser & other specialized flows (e.g., image analysis text formatting, message enhancement).

- **Vision** (`analyzeImage`):

  - For extracting structured data from screenshots, photos (events, tasks, contacts, etc.).

- **Embeddings** (`createEmbedding`):
  - Used by `SecondBrainService` to store/search long‑term memories via vector DB.

---

## 9. How to Safely Add / Change Features

1. **Determine domain & responsibility**

   - Is it calendar, gmail, reminders/lists, second-brain, or pure orchestration?
   - If it’s cross‑domain (e.g., “take tasks → create calendar events”), consider **MultiAgentCoordinator** + planner.

2. **Identify correct layers**

   - **Service**: new raw capability (e.g., new DB field, new Gmail API).
   - **Function handler**: new operation / new parameters for tools.
   - **Agent prompt** (`SystemPrompts`): teach LLM to call the new tool correctly.
   - **Orchestrator**: only when you need cross‑agent planning or complex multi-step flows.

3. **Avoid putting logic in prompts when it’s deterministic**

   - E.g., RRULE building, date arithmetic, DB schemas → belong in services.
   - Prompts should **describe** how to use tools, not encode business rules that are easy to implement in TS.

4. **Update documentation**

   - If you change a capability:
     - Update the relevant `agents-*.md` file.
     - Update this `master-manual.md` if you add entirely new subsystems.

5. **Debugging workflow**
   - Check logs:
     - WhatsApp logs for user-level behavior.
     - Agent logs (function arguments/results).
     - Performance logs for AI calls.
   - Identify which layer failed:
     - LLM plan? → inspect planner prompt + returned JSON.
     - Wrong function call? → inspect `*Functions.ts` schema and agent prompt.
     - Correct function call but wrong effect? → inspect service + DB/SaaS API interaction.

---

## 10. Quick Checklist Before Implementing Anything

- **Which agent or orchestrator flow should own this?**
- **Do I need a new function/tool, or can I extend an existing one?**
- **Is there already a service that almost does this?**
- **Have I updated the relevant system prompt to teach the LLM the new behavior?**
- **Have I updated or at least consulted the docs under `docs/project-instruction/` (this file + per-agent docs)?**

If you follow this guide, you should have **near-zero mistaken assumptions** about where to put logic, how capabilities are wired, and how the LLM interacts with the rest of the system.
