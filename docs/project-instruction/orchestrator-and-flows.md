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

## Language & UX

- Mirror user language (Heb/En).
- Use concise confirmations; avoid dumping raw JSON to users.

## Files of Interest

- `src/orchestration/MultiAgentCoordinator.ts` – orchestration loop, routing decision, execution, summary
- `src/services/ai/OpenAIService.ts` – intent detection logic (single AI call for routing + planning decision)
- `src/config/system-prompts.ts` – intent classifier prompt (includes planning logic), planner prompt, agent prompts
- `src/agents/functions/*.ts` – per-agent functions and parameter schemas

## Performance Notes

**Optimization (Dec 2025)**: Consolidated planning logic into single intent detection call

- **Before**: 2 sequential AI calls (intent + multi-step analysis) = 3-6 seconds
- **After**: 1 comprehensive AI call = 1-3 seconds
- **Improvement**: 50% faster, 27% fewer tokens, simpler code
