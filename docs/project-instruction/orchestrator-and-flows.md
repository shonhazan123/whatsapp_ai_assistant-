# Orchestrator & Multi-Agent Flows (MultiAgentCoordinator + Planner)

## Core Flow

1. **Intent detection** (OpenAI) → primary intent + involved agents + requiresPlan flag.
   - **ONE comprehensive AI call** determines both agent routing AND planning needs
   - Handles multi-agent coordination AND single-agent multi-step scenarios
   - Performance: ~1-3 seconds (50% faster than previous two-call approach)
2. **Routing Decision**:
   - If `requiresPlan: false` AND single agent → **Direct route** to agent (no planning)
   - If `requiresPlan: true` OR multiple agents → Continue to planning step
3. **Planning** (MultiAgentPlanner prompt, when needed):
   - Builds JSON plan of `PlannedAction` items: `id`, `agent`, `intent`, `userInstruction`, `executionPayload`, optional `dependsOn`, `notes`.
   - Same-agent multi-step (e.g., delete+create) must be separate actions with dependencies.
   - If plan empty → no-action message.
4. **Permission check** per agent (capabilities, Google connection).

5. **Execution** (in-order, honoring `dependsOn`):
   - For each action, call the target agent's `processRequest` with `executionPayload`.
   - Collect `ExecutionResult` (status success/failed/blocked, response/error, duration).
   - Maintains short running context for downstream steps.
6. **Summary**:
   - If single agent: combine responses.
   - If multi-agent: generate summary via multi-agent summary prompt.

## Resolver Schema System (January 2026)

The PlannerNode uses a **Schema-Based Routing System** for deterministic, high-precision routing decisions.

### Architecture

```
User Message → Pattern Matching → LLM Planner → Resolver Router → Resolver Execution
                     ↓                 ↓
              Routing Hints      Schema Context
```

### Key Components

1. **ResolverSchema** (`Memo_v2/src/graph/resolvers/ResolverSchema.ts`)
   - Defines each resolver's capabilities, action hints, trigger patterns, and examples
   - Provides pattern matching for pre-routing hints
   - Exports `formatSchemasForPrompt()` for LLM context injection

2. **Pattern Matching Layer**
   - Before LLM call, matches user message against resolver patterns
   - Scores each resolver by matched patterns + priority
   - Provides top candidates to LLM as routing hints

3. **Schema Registry**
   - All 8 resolvers have explicit schemas:
     - `meta_resolver` (priority: 100) - Help, capabilities, status
     - `database_task_resolver` (priority: 60) - Tasks, reminders
     - `database_list_resolver` (priority: 55) - Named lists
     - `calendar_find_resolver` (priority: 50) - Calendar queries
     - `calendar_mutate_resolver` (priority: 49) - Calendar mutations
     - `gmail_resolver` (priority: 45) - Email operations
     - `secondbrain_resolver` (priority: 40) - Memory storage/recall
     - `general_resolver` (priority: 10) - Fallback conversations

### Resolver Schema Structure

```typescript
interface ResolverSchema {
  name: string;           // e.g., "calendar_find_resolver"
  capability: Capability; // e.g., "calendar"
  summary: string;        // Brief description for Planner
  actionHints: string[];  // Action hints this resolver handles
  triggerPatterns: {
    hebrew: string[];     // Hebrew keywords/phrases
    english: string[];    // English keywords/phrases
  };
  examples: Array<{
    input: string;        // Example user message
    action: string;       // Expected action hint
  }>;
  priority: number;       // For conflict resolution
}
```

### Routing Decision Tree

The Planner follows this priority order:

1. **META** - "מה אתה יכול", "help", "what can you do"
2. **SECOND-BRAIN** - "תזכור ש", "remember that", "מה אמרתי על"
3. **GMAIL** - "מייל", "email", "inbox" (if connected)
4. **DATABASE vs CALENDAR**:
   - "תזכיר לי" (remind me) → DATABASE (task resolver)
   - "סיימתי" (done) → DATABASE (task resolver)
   - "רשימה" (list) → DATABASE (list resolver)
   - Time without "remind me" → CALENDAR
   - "תקבע" (schedule) → CALENDAR
5. **GENERAL** - Fallback for conversations

### Schema-Based Resolver Selection (selectResolver)

The `selectResolver()` function uses **ResolverSchema actionHints as the SINGLE SOURCE OF TRUTH** for routing within a capability. This ensures:
- PlannerNode, ResolverRouterNode, and selectResolver all use the same schema definitions
- No redundant action lists scattered across the codebase
- Adding new actions only requires updating the schema

**Algorithm:**
1. **Normalize the hint** - Convert spaces to underscores (e.g., "list tasks" → "list_tasks")
2. **Match against schema actionHints** - Check each resolver's schema for exact actionHint match
3. **Fallback to trigger patterns** - If no exact match, check triggerPatterns (Hebrew + English)
4. **Default to highest priority** - Return the highest-priority resolver for the capability

**Example for database capability:**
- Hint "list_tasks" → Matches `DATABASE_TASK_SCHEMA.actionHints` → DatabaseTaskResolver
- Hint "create_list" → Matches `DATABASE_LIST_SCHEMA.actionHints` → DatabaseListResolver
- Hint with "רשימה" → Matches `DATABASE_LIST_SCHEMA.triggerPatterns.hebrew` → DatabaseListResolver

### Files of Interest

- `Memo_v2/src/graph/resolvers/ResolverSchema.ts` - Schema definitions and pattern matching
- `Memo_v2/src/graph/resolvers/index.ts` - Registry exports and helper functions
- `Memo_v2/src/graph/nodes/PlannerNode.ts` - Schema-aware planning with pattern hints

## Agents & Responsibilities (at a glance)

- **calendar**: calendarOperations (events, recurring, conflicts, deletions).
- **gmail**: gmailOperations (mail read/search/compose/manage).
- **database**: taskOperations/listOperations/contactOperations (reminders, lists, contacts; no calendar/email).
- **second_brain**: unstructured memory (notes, semantic search).

## Planning Logic (Intent Detection)

Intent detection determines if orchestrator planning is needed:

### requiresPlan is TRUE when:

1. **Multi-agent requests** - Multiple agents must coordinate (e.g., "find contact and email them")
2. **Single agent with MULTIPLE SEQUENTIAL operations** - Different operation types that must execute in order:
   - DELETE + CREATE/ADD operations (e.g., "delete all tasks and add banana to list")
   - UPDATE + CREATE operations (e.g., "update event and create reminder")
   - DELETE recurring but KEEP specific instances (e.g., "delete recurring events and keep only this week")

### requiresPlan is FALSE when:

1. **Single operation** - One action type (create, delete, update, get, list)
2. **Bulk operations** - Multiple items of same operation type (e.g., "delete all completed tasks")
3. **Operations with filters/exceptions** - Single operation with parameters (e.g., "delete all events except X")

## Planning Rules (when plan is created)

- Minimal action set; separate verbs/goals into actions.
- Use `dependsOn` when later steps need earlier results.
- Keep language consistent with user; output strictly JSON array (planner).
- If unsupported/unclear → return [].

## Execution Rules (critical)

- Agents **must** call their functions; never claim deletion/creation without invoking.
- Orchestrator filters actions to allowed agents; skips blocked deps with `blocked` status.
- Context trimmed to recent messages to avoid overflow.

## Example: Delete Events With Exclusions (single-step, no plan needed)

**User request**: "תפנה את כל האירועים השבוע חוץ מהאולטרסאונד" (Clear all events this week except ultrasound)

**Intent detection**:

- Primary intent: `calendar`
- RequiresPlan: `false` (simple single-agent request)
- Route directly to Calendar Agent

**Calendar Agent execution** (single call):

- Receives: "תפנה את כל האירועים השבוע חוץ מהאולטרסאונד"
- Extracts:
  - Time window: "השבוע" → `timeMin`/`timeMax` for current week
  - Exception: "אולטרסאונד" → `excludeSummaries: ["אולטרסאונד"]`
- Calls: `{"operation":"delete","timeMin":"2025-12-08T00:00:00+02:00","timeMax":"2025-12-14T23:59:59+02:00","excludeSummaries":["אולטרסאונד"]}`
- `deleteByWindow`:
  - Fetches all events in time window
  - Filters OUT events containing "אולטרסאונד" (the exception to preserve)
  - Deletes all remaining events
- Returns: "✅ פיניתי את השבוע חוץ מהאולטרסאונד."

**User response**: "✅ פיניתי את השבוע חוץ מהאולטרסאונד."

**Why this approach?**:

- Simple single-operation request that doesn't require orchestrator planning
- Calendar Agent handles the exception filtering internally using `excludeSummaries` parameter
- More efficient than multi-step orchestration for straightforward "delete except X" requests
- Handles multiple exceptions seamlessly: "except ultrasound and Monday events"
- No ambiguity, no multi-step complexity needed

## Capability Constraints

- Calendar/Gmail require Google connection; denied if missing.
- Database and second_brain available without Google; database still respects plan entitlements.

## HITL (Human-in-the-Loop) Timeout

The system implements a **5-minute timeout** for HITL interrupts to prevent stale state buildup:

- When an interrupt is triggered (disambiguation, clarification, confirmation), a timestamp is stored
- On resume, the system checks if more than 5 minutes have passed
- If timed out, the pending interrupt is ignored and the message is treated as a fresh invocation
- This prevents issues where users abandon disambiguation flows and return hours/days later

**Implementation:**
- `interruptedAt` timestamp stored in `InterruptPayload.metadata`
- Timeout check in `invokeMemoGraph()` before resuming
- Constant: `INTERRUPT_TIMEOUT_MS = 5 * 60 * 1000` (5 minutes)

## HITL Interrupt Flow (Two Types)

The system has **two distinct types of HITL interrupts**:

### 1. Planner HITL (Confirmation/Clarification)
- Triggered by `HITLGateNode` when planner identifies high-risk operations
- Examples: Delete operations, unclear requests
- User response stored in `state.plannerHITLResponse`
- Does NOT create disambiguation object

### 2. Entity Resolution HITL (Disambiguation)
- Triggered by `EntityResolutionNode` when entity matching is ambiguous
- Examples: Multiple matching tasks, low-confidence fuzzy match
- User response stored in `state.disambiguation.userSelection`
- Requires valid `resolverStepId` and non-empty `candidates`

**Key Implementation Details:**

1. **HITLGateNode**: Distinguishes between planner and entity resolution HITL
   - Planner HITL: Sets `plannerHITLResponse`, NOT `disambiguation`
   - Entity Resolution HITL: Updates existing `disambiguation` with `userSelection`

2. **EntityResolutionNode**: Validates disambiguation before processing
   - Only processes if `resolverStepId` AND `candidates.length > 0`
   - Prevents confusion from planner HITL responses

3. **ResolverRouterNode**: Caches results to prevent re-execution
   - Skips steps that already have results in `state.resolverResults`
   - Prevents unnecessary LLM calls after resume

4. **DatabaseEntityResolver.applySelection()**: Handles yes/no responses
   - Recognizes "כן"/"yes" as confirmation for single-candidate matches
   - Recognizes "לא"/"no" as rejection (returns `not_found`)

**Files:**
- `Memo_v2/src/graph/nodes/HITLGateNode.ts` - Interrupt handling
- `Memo_v2/src/graph/nodes/EntityResolutionNode.ts` - Disambiguation processing
- `Memo_v2/src/graph/nodes/ResolverRouterNode.ts` - Result caching
- `Memo_v2/src/services/resolution/DatabaseEntityResolver.ts` - Selection handling

## LLM-Based Disambiguation Messages (Jan 2026)

When the PlannerNode triggers HITL due to low confidence or unclear intent, the system now uses an **LLM call to generate natural, conversational clarification messages** instead of robotic templates.

### Architecture

```
User Message → PlannerNode → HITLGateNode (needs clarification?)
                   ↓                    ↓
         routingSuggestions    generateClarificationWithLLM()
                   ↓                    ↓
              Stored in State    LLM generates friendly message
                                        ↓
                                  interrupt(payload)
```

### Key Components

1. **RoutingSuggestion** (`Memo_v2/src/types/index.ts`)
   - Pattern-matched suggestions computed from user message
   - Contains: `resolverName`, `capability`, `score`, `matchedPatterns`
   - Stored in `state.routingSuggestions` by PlannerNode

2. **Clarification LLM Call** (`HITLGateNode.generateClarificationWithLLM()`)
   - Uses `gpt-4o-mini` for fast, cheap generation (~200-400ms)
   - Receives full context: user message, routing suggestions, planner output
   - Generates response in user's language (Hebrew/English)
   - Falls back to static messages if LLM fails

### Context Provided to LLM

| Data | Purpose |
|------|---------|
| `userMessage` | Original request to understand intent |
| `language` | Respond in correct language |
| `routingSuggestions` | Possible capabilities that might match |
| `plannerOutput.confidence` | How uncertain the system is |
| `plannerOutput.missingFields` | What specific info is missing |
| `plannerOutput.plan` | What the planner thinks user wants |
| `hitlReason` | Why clarification is needed |

### Example Improvements

**Before (robotic):**
```
לא בטוח שהבנתי נכון. התכוונת ל:
• create event
אנא אשר או תקן אותי.
```

**After (LLM-generated):**
```
לא הצלחתי להבין - רצית שאוסיף אירוע ליומן מחר בשמונה, או שאזכיר לך משהו בזמן הזה?
```

### When LLM Is Used

- **Clarification cases**: Low confidence, missing fields, unclear intent
- **NOT used for**: High-risk confirmations (delete operations) - these use structured yes/no prompts

### Files

- `Memo_v2/src/graph/nodes/PlannerNode.ts` - Computes and stores `routingSuggestions`
- `Memo_v2/src/graph/nodes/HITLGateNode.ts` - `generateClarificationWithLLM()` method
- `Memo_v2/src/graph/state/MemoState.ts` - `routingSuggestions` state field
- `Memo_v2/src/types/index.ts` - `RoutingSuggestion` interface

## Language & UX

- Mirror user language (Heb/En).
- Use concise confirmations; avoid dumping raw JSON to users.

## Timezone Handling (Jan 2026)

The system uses proper timezone-aware time context to ensure accurate date/time handling for reminders and calendar events.

### Time Context Format

The `ContextAssemblyNode.buildTimeContext()` generates time context with ISO timestamp including timezone offset:

```
[Current time: Thursday, 22/01/2026 21:09 (2026-01-22T21:09:21+02:00), Day: Thursday (4), Timezone: Asia/Jerusalem]
```

**Key Components:**
- Human-readable date/time
- ISO timestamp WITH timezone offset (critical for LLM date calculations)
- Day of week name and index (0=Sunday, 6=Saturday)
- User's timezone (from database `users.timezone` field)

### Why This Matters

Without the timezone offset, when an LLM calculates "in one hour" from "21:00" and outputs `2026-01-22T22:00:00`, JavaScript interprets this as UTC (server time), causing incorrect reminder times. With the offset (`+02:00`), the timestamp is unambiguous.

### Files of Interest

- `Memo_v2/src/utils/timeContext.ts` - Time context utilities with timezone support
- `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts` - Builds time context using user's timezone
- `users.timezone` database field - Stores user's IANA timezone (default: Asia/Jerusalem)

## Multi-Capability Response Formatting (Jan 2026)

When a user request triggers multiple capabilities (e.g., "remind me to pack and add gym to calendar"), the system:

1. **JoinNode** merges all execution results into `state.executionResults`
2. **ResponseFormatterNode** builds per-step results with individual contexts (`stepResults` array)
3. **ResponseWriterNode** passes `stepResults` to the LLM with `_metadata.isMultiStep = true`
4. **ResponseFormatterPrompt** guides the LLM to write ONE natural, conversational response covering ALL actions

**Key Design Decision:** The response should sound like a human assistant explaining what they did, not robotic blocks:

```
✅ סידרתי לך הכל!
יצרתי תזכורת ל*בניית המחשב* להיום ב-18:00, וגם הוספתי ליומן מחר *אימון בחדר כושר* ב-08:00.
```

**NOT:**
```
✅ יצרתי תזכורת:
*לבנות את המחשב*
זמן: היום ב-18:00

✅ האירוע נוסף!
📌 כותרת: אימון
🕒 מחר ב-08:00
```

**Files:**
- `Memo_v2/src/types/index.ts` - `StepResult` interface, `FormattedResponse.stepResults`
- `Memo_v2/src/graph/nodes/ResponseFormatterNode.ts` - Builds per-step results
- `Memo_v2/src/graph/nodes/ResponseWriterNode.ts` - Passes stepResults to LLM
- `src/config/response-formatter-prompt.ts` - Multi-step formatting instructions

## Files of Interest

- `src/orchestration/MultiAgentCoordinator.ts` – orchestration loop, routing decision, execution, summary
- `src/services/ai/OpenAIService.ts` – intent detection logic (single AI call for routing + planning decision)
- `src/config/system-prompts.ts` – intent classifier prompt (includes planning logic), planner prompt, agent prompts
- `src/agents/functions/*.ts` – per-agent functions and parameter schemas
- `Memo_v2/src/graph/resolvers/ResolverSchema.ts` – Resolver schema definitions and pattern matching
- `Memo_v2/src/graph/nodes/PlannerNode.ts` – Schema-aware planner with pre-routing hints

## Performance Notes

**Optimization (Dec 2025)**: Consolidated planning logic into single intent detection call

- **Before**: 2 sequential AI calls (intent + multi-step analysis) = 3-6 seconds
- **After**: 1 comprehensive AI call = 1-3 seconds
- **Improvement**: 50% faster, 27% fewer tokens, simpler code

**Optimization (Jan 2026)**: Schema-based routing with pattern matching

- **Before**: LLM-only routing with hardcoded prompt rules
- **After**: Pattern matching pre-routing + schema-aware LLM decision
- **Improvement**: Near-100% deterministic routing, explicit resolver contracts
