# Migrate server and webhook to Memo_v2 (with calendar/gmail context fix)

## Goal

- Run the HTTP server and WhatsApp webhook from Memo_v2 (v2), not from the root v1 app.
- Fix calendar/gmail "Request context is not available" by building `RequestUserContext` once in the webhook and running the graph inside `legacy RequestContext.run(context, ...)`.
- Root project only builds and starts Memo_v2's server (no v1 server startup or webhook logic).

---

## Current layout (v1)

- **Server:** `src/index.ts` — Express app, health, `/auth`, `/api/debug`, `/webhook`, db test, SchedulerService start.
- **Webhook:** `src/routes/webhook.ts` — GET/POST `/webhook/whatsapp`, `handleIncomingMessage` (normalize phone, cache, typing, performance, text/audio/image, **UserService + UserOnboardingHandler** to get `context`, then `RequestContext.run(context, () => invokeMemoGraphSimple(...))` or v1 flow, send response).
- **Auth:** `src/routes/auth.ts` — Google OAuth (GoogleOAuthService).
- **Debug:** `src/routes/debug.ts` — POST `/api/debug/process`, calls `handleIncomingMessage`.
- **Context bug:** v1 uses `src/core/context/RequestContext.ts`. Legacy Calendar/Gmail in Memo_v2 use `Memo_v2/src/legacy/core/context/RequestContext.ts` (different AsyncLocalStorage). So when the graph runs, legacy code sees no context.

---

## Target layout (v2)

- **Server entry:** New file in Memo_v2 (e.g. `Memo_v2/src/server.ts`) that creates the Express app, mounts health + auth + debug + webhook, runs db test, starts scheduler, listens on PORT.
- **Webhook:** Lives in Memo_v2 (e.g. `Memo_v2/src/routes/webhook.ts`). Builds `RequestUserContext` (from legacy UserService + getGoogleTokens + capabilities; optionally via an onboarding handler). Invokes the graph inside **legacy** `RequestContext.run(context, () => invokeMemoGraphSimple(...))` so calendar/gmail work.
- **Auth / Debug / Scheduler:** Implementations or copies live under Memo_v2 (routes + any services they need).
- **Root:** Root `package.json` / `src/index.ts` only build Memo_v2 and run Memo_v2's server (e.g. `node Memo_v2/dist/server.js`).

---

## Implementation phases

### Phase 1 — Config and server entry in Memo_v2

- Add `Memo_v2/src/config/environment.ts` (or reuse a minimal env module): export `ENVIRONMENT` ('PRODUCTION' | 'DEBUG'), `DEBUG_INSTANCE_URL`, etc., mirroring `src/config/environment.ts`.
- Add `Memo_v2/src/server.ts`: create Express app, `express.json()` / `urlencoded`, GET `/health`, db connection test (use legacy `config/database` and add or reuse `testConnection`), then `app.listen(PORT)`. Do **not** mount auth/debug/webhook yet; confirm server starts and db test runs.
- Add `express` (and any types) to Memo_v2 `package.json` if missing.
- Optional: add a small `Memo_v2/src/routes/index.ts` that will later export auth, debug, webhook routers.

### Phase 2 — Webhook in Memo_v2 and calendar/gmail context fix

- Add `Memo_v2/src/routes/webhook.ts` and implement the same flow as v1's `src/routes/webhook.ts`: GET/POST `/whatsapp`, `handleIncomingMessage`, normalize phone, message ID cache, typing indicator, route text/audio/image.
- **RequestUserContext and context fix:** In the text-message path, build `RequestUserContext` in one place:
  - Use legacy `getUserService()`: `findOrCreateByWhatsappNumber(userPhone)`, then `getGoogleTokens(user.id)`.
  - Build capabilities (and `googleConnected`) from plan type and tokens (same logic as ContextAssemblyNode or v1 onboarding).
  - Build `context: RequestUserContext` (user, planType, whatsappNumber, capabilities, googleTokens, googleConnected).
  - Invoke the graph **only** inside legacy context:  
    `response = await RequestContext.run(context, () => invokeMemoGraphSimple(userPhone, messageText, { ... }));`  
  - Use the **legacy** `RequestContext` from `Memo_v2/src/legacy/core/context/RequestContext.ts`. No second storage or wrapper from v1.
- For this phase, you can **skip** full onboarding (welcome steps, "connect Google" prompts, etc.): if the user exists and you have tokens, build `context` and run the graph. Optionally return early with a short message when user is not "ready" (e.g. no plan or no tokens when calendar/gmail are needed).
- Dependencies to bring into Memo_v2 for the webhook only:
  - WhatsApp types (e.g. `WhatsAppMessage`, `WhatsAppWebhookPayload`): add under `Memo_v2/src/types/` or reuse from a shared types file.
  - `normalizeWhatsAppNumber`: add a small util in Memo_v2 (copy from v1 webhook).
  - MessageIdCache: copy or reimplement under Memo_v2 (e.g. `Memo_v2/src/services/webhook/MessageIdCache.ts`).
  - Use Memo_v2's existing `downloadWhatsAppMedia`, `sendTypingIndicator`, `sendWhatsAppMessage`, `processAudioMessage`, `processImageMessage`, `invokeMemoGraphSimple`.
- Mount the webhook router in `server.ts` under `/webhook` (and gate by ENVIRONMENT if desired). Do **not** import or run v1's webhook or v1's RequestContext.

**Result:** server + webhook run in Memo_v2; graph runs inside legacy `RequestContext.run(context, ...)` so calendar/gmail see the correct context.

### Phase 3 — Auth routes in Memo_v2

- Copy or adapt `src/routes/auth.ts` and the auth services it needs into Memo_v2:
  - `src/services/auth/GoogleOAuthService.ts`, `src/services/auth/GoogleTokenManager.ts` — move to e.g. `Memo_v2/src/legacy/services/auth/` (or `Memo_v2/src/services/auth/`) and fix imports to use legacy config/database/types where needed.
  - Add auth router in Memo_v2 (e.g. `Memo_v2/src/routes/auth.ts`) that uses the migrated Google OAuth service and callback; mount at `/auth` in `server.ts`.

### Phase 4 — Onboarding (optional but recommended)

- Migrate onboarding so the webhook can return "connect Google" / welcome messages and still build `RequestUserContext` when the user is ready:
  - Copy `src/onboarding/OnboardingFlow.ts`, `src/onboarding/onboardingMessages.ts`, and `src/services/onboarding/UserOnboardingHandler.ts` into Memo_v2 (e.g. `Memo_v2/src/legacy/onboarding/` and `Memo_v2/src/legacy/services/onboarding/` or equivalent). Update imports to legacy UserService, auth, WhatsApp send, etc.
  - In Memo_v2 webhook's text path: call the migrated onboarding handler; if `!onboardingCheck.shouldProcess`, send its message and return; otherwise use `onboardingCheck.context` as `context` and run `RequestContext.run(context, () => invokeMemoGraphSimple(...))`. This keeps a single place where context is set and the graph is run.

### Phase 5 — Scheduler and reminder in Memo_v2

- Copy `src/services/scheduler/SchedulerService.ts` and `src/services/reminder/ReminderService.ts` into Memo_v2 (e.g. under `Memo_v2/src/legacy/services/scheduler/` and `Memo_v2/src/legacy/services/reminder/`). Fix imports to legacy database, UserService, WhatsApp send, etc. Add `node-cron` (and any types) to Memo_v2 `package.json` if needed.
- In `Memo_v2/src/server.ts`, after db test, instantiate and start the scheduler (same as current v1 index), so reminders and morning digest run from v2.

### Phase 6 — Debug route and supporting services in Memo_v2

- Copy or adapt `src/routes/debug.ts` into Memo_v2: POST `/api/debug/process` that builds a synthetic `WhatsAppMessage` and calls the **Memo_v2** `handleIncomingMessage`. Mount at `/api/debug` in `server.ts`, guarded by ENVIRONMENT.
- Copy or reimplement as needed: `src/services/debug/DebugForwarderService.ts`, `src/services/performance/PerformanceTracker.ts`, `src/services/performance/PerformanceLogService.ts` (or use existing legacy performance services in Memo_v2). Integrate into the webhook (performance start/end, optional upload, debug forward) so behavior matches v1.

### Phase 7 — Root project as launcher only

- Change root `src/index.ts` so it no longer creates the Express app or mounts routes. Instead: build Memo_v2 (e.g. `npm run build:memo-v2` or equivalent), then start the server by running Memo_v2's entry (e.g. `require('../Memo_v2/dist/server.js')` or `node Memo_v2/dist/server.js`). Ensure env (dotenv, PORT, etc.) is loaded before starting.
- Update root `package.json` scripts if needed (e.g. `start` runs Memo_v2 server; `dev` builds Memo_v2 and runs Memo_v2 server with nodemon/ts-node pointing at Memo_v2).
- Remove or deprecate the old v1 server bootstrap and v1 webhook/auth/debug route registration from the root so that the only active server and webhook are in Memo_v2.

---

## Calendar/Gmail context fix (summary)

- **Cause:** Legacy Calendar/Gmail use Memo_v2's legacy `RequestContext` (its own AsyncLocalStorage). The v1 webhook set only v1's RequestContext, so legacy code saw no context.
- **Fix:** Webhook and server run in Memo_v2. In the single place where the graph is invoked (new webhook's text handler), build `RequestUserContext` (user, planType, whatsappNumber, capabilities, googleTokens, googleConnected) using legacy UserService (and optionally the migrated onboarding handler). Then run:  
  `RequestContext.run(context, () => invokeMemoGraphSimple(...))`  
  using **only** the legacy `RequestContext` from `Memo_v2/src/legacy/core/context/RequestContext.ts`. No duplicate context-building in ExecutorNode and no v1 RequestContext in the loop.

---

## Dependency summary (what moves into Memo_v2)

| Concern | Current location | Target in Memo_v2 |
|--------|------------------|-------------------|
| ENVIRONMENT, DEBUG_* | src/config/environment.ts | Memo_v2/src/config/environment.ts |
| Server (Express, health, listen) | src/index.ts | Memo_v2/src/server.ts |
| Webhook (GET/POST, handleIncomingMessage) | src/routes/webhook.ts | Memo_v2/src/routes/webhook.ts |
| RequestUserContext + run(graph) | v1 RequestContext.run + onboarding context | Build in webhook; legacy RequestContext.run(context, invokeMemoGraphSimple) |
| Auth (Google OAuth) | src/routes/auth.ts, services/auth/* | Memo_v2 routes + legacy/services/auth (or equivalent) |
| Onboarding | onboarding/*, UserOnboardingHandler | Memo_v2 legacy/onboarding + services/onboarding |
| Scheduler + Reminder | SchedulerService, ReminderService | Memo_v2 legacy/services/scheduler, reminder |
| Debug route | src/routes/debug.ts | Memo_v2/src/routes/debug.ts |
| MessageIdCache, Performance*, DebugForwarder | src/services/* | Memo_v2 services (or legacy) |
| WhatsApp types, normalizeWhatsAppNumber | src/types, webhook | Memo_v2 types + utils |

---

## Order of work

1. Phase 1 — get Memo_v2 server and config running.
2. Phase 2 — webhook in Memo_v2 + context fix (graph always run inside legacy `RequestContext.run(context, ...)`).
3. Phases 3–6 — auth, onboarding, scheduler, debug and supporting services (can be parallelized or reordered if some are optional short-term).
4. Phase 7 — root becomes launcher only; remove v1 server/webhook from root.

After Phase 2, the app can already run from Memo_v2 with text/audio/image handling and working calendar/gmail; the rest of the phases make Memo_v2 fully self-contained and the root a thin launcher.
