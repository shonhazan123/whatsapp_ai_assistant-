# Memo V2 — Migration Checklist

> Tracking progress of migration from V1 to LangGraph-based V2

---

## Legend

- ⬜ Not started
- 🔄 In progress
- ✅ Complete
- ❌ Blocked
- 🔗 Dependency on another item

---

## Phase 1: Foundation (Week 1-2) ✅

### Project Setup ✅

- ✅ Create `Memo_v2/` folder structure
- ✅ Initialize `package.json` with dependencies
- ✅ Configure `tsconfig.json`
- ⬜ Set up LangSmith tracing (optional)
- ⬜ Create `.env.example` with required variables

### Reusable Services (Service Adapters) ✅

- ✅ `src/services/adapters/CalendarServiceAdapter.ts` (wraps V1 CalendarService)
- ✅ `src/services/adapters/TaskServiceAdapter.ts` (wraps V1 TaskService)
- ✅ `src/services/adapters/ListServiceAdapter.ts` (wraps V1 ListService)
- ✅ `src/services/adapters/GmailServiceAdapter.ts` (wraps V1 GmailService)
- ✅ `src/services/adapters/SecondBrainServiceAdapter.ts` (wraps V1 SecondBrainService)

### Reusable Utilities (Adapted from V1) ✅

- ✅ `src/utils/QueryResolverAdapter.ts` (no ConversationWindow dependency)
- ✅ `src/utils/fuzzy.ts`
- ✅ `src/utils/time.ts`
- ✅ `src/utils/timeContext.ts`

### State Schema ✅

- ✅ Define `MemoState` type in `src/graph/state/MemoState.ts`
- ✅ Define LangGraph `MemoStateAnnotation` (Annotation API)
- ✅ Create supporting types (PlanStep, ExecutionResult, etc.)

### Basic Graph Skeleton ✅

- ✅ Create `src/graph/index.ts` with node registration
- ✅ Create stub implementations for all nodes
- ✅ Verify graph compiles and runs with dummy data

---

## Phase 2: Core Nodes (Week 3-4) ✅

### ContextAssemblyNode ✅

- ✅ Load user profile from database
- ✅ Load recent messages (in-memory)
- ✅ Load long-term memory summary (if applicable)
- ✅ Build TimeContext with `getTimeContextString()`
- ✅ Unit tests

### ReplyContextNode ✅

- ✅ Detect WhatsApp reply-to messages
- ✅ Handle numbered list replies (disambiguation)
- ✅ Find image context in recent messages
- ✅ Build enhanced message with context
- ✅ Unit tests

### PlannerNode ✅

- ✅ Create Planner system prompt
- ✅ Implement LLM call with caching (stub for now)
- ✅ Parse and validate PlannerOutput
- ✅ Handle edge cases (empty plans, invalid JSON)
- ✅ Integration tests with sample messages

### HITLGateNode ✅

- ✅ Implement confidence threshold check
- ✅ Implement missing_fields check
- ✅ Implement risk_level check
- ✅ Generate clarification messages (templates)
- ✅ Use native LangGraph interrupt() (no shouldPause)
- ✅ Unit tests

### ResolverRouterNode ✅

- ✅ Build dependency DAG from plan
- ✅ Determine parallel execution groups
- ✅ Route to correct resolver based on capability + action
- ✅ Unit tests

### JoinNode ✅

- ✅ Merge parallel execution results
- ✅ Detect partial failures
- ✅ Decide recovery strategy or HITL
- ✅ Unit tests

### ResponseFormatterNode ✅

- ✅ Port `formatDatesInObject()` from V1
- ✅ Port `parseISOToLocalTime()` from V1
- ✅ Port `formatRelativeDate()` from V1
- ✅ Port `extractResponseContext()` from V1
- ✅ Port task categorization (overdue/upcoming/recurring)
- ✅ Unit tests

### ResponseWriterNode ✅

- ✅ Template-based responses (EN + HE)
- ✅ Generate human-friendly messages
- ✅ Handle error states
- ✅ Unit tests

### MemoryUpdateNode ✅

- ✅ Add messages to recentMessages
- ✅ Enforce memory limits (count + tokens)
- ✅ Long-term summary trigger (stub)
- ✅ Unit tests

### End-to-End Flow Test

- ✅ Test simple single-step flow (e.g., "create a task")
- ✅ Test multi-step flow (e.g., "find and update event")
- ⬜ Test disambiguation flow (pause/resume) - pending real HITL integration

---

## Phase 3: Resolvers (Week 5-6) ✅

### CalendarFindResolver ✅

- ✅ Define schema slice
- ✅ Create system prompt
- ✅ Implement `get` action
- ✅ Implement `getEvents` action
- ✅ Implement `checkConflicts` action
- ✅ Implement `getRecurringInstances` action
- ⬜ Integrate QueryResolver for entity lookup
- ✅ Unit tests

### CalendarMutateResolver ✅

- ✅ Define schema slice
- ✅ Create system prompt
- ✅ Implement `create` action
- ✅ Implement `createRecurring` action (weekly/monthly detection)
- ✅ Implement `update` action with searchCriteria
- ✅ Implement `delete` action with excludeSummaries
- ✅ Implement `deleteBySummary` action
- ✅ Implement `truncateRecurring` action
- ⬜ Integrate QueryResolver for entity lookup
- ✅ Unit tests

### DatabaseTaskResolver ✅

- ✅ Define schema slice (from TaskFunction)
- ✅ Create system prompt
- ✅ Implement `create` action with reminder support
- ✅ Implement `createMultiple` action
- ✅ Implement `get` / `getAll` actions
- ✅ Implement `update` action
- ✅ Implement `delete` / `deleteMultiple` actions
- ✅ Implement `complete` action
- ✅ Handle `reminderRecurrence` (nudge, daily, weekly, monthly)
- ⬜ Integrate QueryResolver for entity lookup
- ✅ Unit tests

### DatabaseListResolver ✅

- ✅ Define schema slice (from ListFunction)
- ✅ Create system prompt
- ✅ Implement all list operations
- ⬜ Integrate QueryResolver for entity lookup
- ✅ Unit tests

### GmailResolver ✅

- ✅ Define schema slice
- ✅ Create system prompt
- ✅ Implement all email operations
- ✅ Unit tests

### SecondBrainResolver ✅

- ✅ Define schema slice
- ✅ Create system prompt
- ✅ Implement store/search/update/delete
- ✅ Handle routing rules (descriptive vs action content)
- ✅ Unit tests

### GeneralResolver ✅

- ✅ Create system prompt for conversational responses
- ✅ Implement pure-LLM response generation
- ✅ Unit tests

### MetaResolver ✅

- ✅ Define capability descriptions (EN + HE)
- ✅ Implement template-based responses
- ✅ Unit tests

### ResolverRouterNode ✅

- ✅ Build dependency DAG from plan
- ✅ Determine parallel execution groups
- ✅ Route to correct resolver based on capability + action
- ✅ Unit tests

---

## Phase 4: Executors (Week 7) ✅

### Executors ✅

- ✅ `BaseExecutor` abstract class with common execution logic
- ✅ `CalendarExecutor` (wraps CalendarServiceAdapter)
- ✅ `DatabaseExecutor` (wraps TaskServiceAdapter + ListServiceAdapter)
- ✅ `GmailExecutor` (wraps GmailServiceAdapter)
- ✅ `SecondBrainExecutor` (wraps SecondBrainServiceAdapter)
- ✅ `GeneralExecutor` (for conversational responses)
- ✅ `MetaExecutor` (for capability descriptions)
- ✅ `ExecutorNode` unified executor for graph integration
- ✅ Unit tests (27 tests)

### Graph Integration ✅

- ✅ Wire `ExecutorNode` between `resolver_router` and `join`
- ✅ Parallel execution of capability-specific operations
- ✅ Error handling and result aggregation

---

## Phase 5: Cron & Integration (Week 8) 🔄

### CronSubGraph

> ✅ **DECISION**: Keep V1's cron/scheduler logic as-is (working great).
> No need to port to LangGraph - these are system-triggered, not user messages.

- ✅ `SchedulerService` - reused from V1 as-is
- ✅ `ReminderService` - reused from V1 as-is
- ✅ Morning brief logic - V1 already has LLM formatting
- ✅ Nudge reminders - V1 already working

### WhatsApp Webhook Integration

- ✅ Updated `src/routes/webhook.ts` to support V2 routing
- ✅ Added `USE_MEMO_V2=true` environment flag for switching
- ✅ V1 handles audio/image preprocessing before V2
- ✅ V1 handles onboarding, OAuth before V2
- ⬜ Enable V2 in production (set `USE_MEMO_V2=true`)

### V1 Service Adapters

- ✅ Created `v1-services.ts` bridge for dynamic loading
- ✅ CalendarServiceAdapter → V1 CalendarService
- ✅ TaskServiceAdapter → V1 TaskService
- ✅ ListServiceAdapter → V1 ListService
- ✅ GmailServiceAdapter → V1 GmailService
- ✅ SecondBrainServiceAdapter → V1 SecondBrainService
- ✅ Mock service injection for testing

### End-to-End Testing

- ⬜ Full flow: text message → response
- ⬜ Full flow: voice message → transcription → response
- ⬜ Full flow: image → analysis → response
- ⬜ Full flow: disambiguation → numbered reply → resume
- ⬜ Full flow: cron → morning brief

---

## Phase 6: Polish & Deploy (Week 9-10)

### Performance Optimization

- ⬜ Verify prompt caching is working
- ⬜ Optimize parallel execution
- ⬜ Profile LLM call latencies
- ⬜ Add caching for repeated queries (if applicable)

### Error Handling

- ⬜ Global error handler for graph
- ⬜ Graceful degradation on API failures
- ⬜ User-friendly error messages
- ⬜ Error logging and alerting

### Logging & Monitoring

- ⬜ LangSmith integration (if enabled)
- ⬜ Performance tracking (token usage, latencies)
- ⬜ Cost tracking per request
- ⬜ Dashboard for monitoring

### A/B Testing

- ⬜ Feature flag for V1 vs V2 routing
- ⬜ Percentage rollout mechanism
- ⬜ Comparison metrics collection

### Gradual Rollout

- ⬜ Deploy V2 alongside V1
- ⬜ Route 5% of users to V2
- ⬜ Monitor for issues
- ⬜ Increase to 25%, 50%, 100%
- ⬜ Deprecate V1

---

## V1 Features Verification Checklist

### Calendar

- ⬜ Single event creation
- ⬜ All-day event detection (YYYY-MM-DD format)
- ⬜ Recurring event creation (weekly)
- ⬜ Recurring event creation (monthly)
- ⬜ Event update (single instance)
- ⬜ Event update (entire series)
- ⬜ Event delete (single)
- ⬜ Event delete with excludeSummaries
- ⬜ Conflict checking
- ⬜ Attendee extraction from text
- ⬜ Reminder minutes before

### Tasks & Reminders

- ⬜ Single task creation
- ⬜ Multiple task creation
- ⬜ Task with due date
- ⬜ Task with reminder (interval before due)
- ⬜ Task with recurring reminder (daily/weekly/monthly)
- ⬜ Task with nudge (every X minutes)
- ⬜ Task completion
- ⬜ Task deletion (single and multiple)
- ⬜ Fuzzy matching for task lookup

### Lists

- ⬜ Checklist creation
- ⬜ Note creation
- ⬜ Add item to list
- ⬜ Toggle checklist item
- ⬜ Delete list item
- ⬜ Fuzzy matching for list lookup

### Gmail

- ⬜ Email search
- ⬜ Email reading
- ⬜ Draft creation
- ⬜ Email sending
- ⬜ Email reply
- ⬜ Email forwarding

### Second Brain

- ⬜ Store thought/note
- ⬜ Search memory
- ⬜ Context retrieval

### General

- ⬜ Conversational responses
- ⬜ Brainstorming help
- ⬜ Decision support

### Meta

- ⬜ "What can you do?"
- ⬜ "How do reminders work?"
- ⬜ Capability descriptions (EN + HE)

### Context Handling

- ⬜ Reply-to context
- ⬜ Numbered list disambiguation
- ⬜ Image context (follow-ups)
- ⬜ Time context injection
- ⬜ Hebrew language support
- ⬜ Time parsing (Hebrew + English)

---

## Known V1 Edge Cases to Verify

1. ⬜ "Delete all events except the doctor appointment"
2. ⬜ "Update the Thursday meeting to Friday"
3. ⬜ "Remind me every 10 minutes to drink water"
4. ⬜ "Add meeting notes: [long text about the meeting]" → second-brain
5. ⬜ Numbered reply after disambiguation ("2")
6. ⬜ Image → "create tasks from this"
7. ⬜ Voice message with Hebrew time expressions
8. ⬜ Multi-step: "Find my meeting with Dana and move it to tomorrow"

---

## Notes

### Items Not Migrated (Intentionally)

- `conversation_memory` Supabase table (replaced by LangGraph state)
- V1's `MultiAgentCoordinator` (replaced by graph)
- V1's `MainAgent` (replaced by graph)
- V1's agent-specific prompts (replaced by Resolver prompts)

### Items Requiring Modification

- `QueryResolver` — Remove `ConversationWindow` dependency
- `ResponseFormatter` — Adapt to node interface

---

_Update this checklist as implementation progresses._
