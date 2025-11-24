## Reminder Update Improvements

### Overview

- Goal: let the assistant understand reminder-update requests without relying on UUIDs, reuse recent task context, and deliver structured reminder payloads to the database layer.
- Context: current flow fails when users reference newly created tasks or use natural language like “תזכיר לי על המשימות האלה”.

### Progress So Far

- **Prompts refreshed (`src/config/system-prompts.ts`)**
  - Added explicit guidance for distinguishing reminder updates from task creation.
  - Documented when to call `taskOperations.update` vs `updateMultiple`.
  - Introduced code examples showing single-task updates, fallback to create, and multi-task handling.
- **Recent task cache (`src/core/memory/ConversationWindow.ts`, `src/agents/functions/DatabaseFunctions.ts`)**
  - ConversationWindow now stores a rolling list of recent task snapshots per user.
  - TaskFunction writes to that cache after create/update/complete operations and prunes it on delete.
  - System messages summarize the cached tasks so downstream LLM calls can reference the correct text.
- **Structured reminder payloads (`src/agents/functions/DatabaseFunctions.ts`)**
  - Function schema now accepts `reminderDetails` for single or bulk updates.
  - Reminder payloads are resolved via QueryResolver and translated into legacy fields before hitting `TaskService`.
- **Reminder helper refactor (`src/services/database/TaskService.ts`)**
  - Unified validation, defaulting, and `next_reminder_at` calculation for create, single-update, and bulk-update flows.
  - Bulk updates now honor the same reminder rules, including clearing and recurring scenarios.

### Next Steps

- Clean up error messaging around duplicate tasks / invalid UUIDs so the agent can surface actionable guidance.
- Add regression tests that cover reminder updates, cache reuse, and bulk update scenarios.

### Notes

- Phase checkpoints enforced: each phase waits for explicit confirmation before starting.
- No automated tests run yet; regression suite still pending.
