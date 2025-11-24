# Calendar Agent Natural-Language Revamp

## Overview

The calendar agent currently struggles to interpret follow-up instructions that refer to events by name (e.g., “עדכן את החתונה לשבע”) because the runtime expects an `eventId`. The goal of this initiative is to align the calendar pipeline with the database agents: the language model always works with human-readable fields, and the runtime resolves those fields into precise calendar operations.

## Objectives

- **Prompt-Driven Behaviour** – Encode strict rules in the system prompt so the model always supplies `summary`, natural-language time ranges, attendee info, and other descriptive parameters instead of IDs.
- **User-Scoped Resolution** – Reuse the `QueryResolver` and `ConversationWindow` infrastructure to map natural-language references to events, including disambiguation flows.
- **Robust Operations** – Make update/delete calls succeed when only a title and contextual time are provided, while preserving confirmations for destructive actions.
- **Traceability** – Provide clear logs and documentation so regressions are easy to diagnose.

## Scope

The work focuses on:

- System prompt adjustments for the calendar agent.
- Function signature changes so the user identifier reaches the calendar runtime.
- Enhancements to `QueryResolver` for event resolution and disambiguation.
- Refactoring `CalendarFunction` operations to depend on resolved summaries.
- Optional helpers inside `CalendarService` to streamline searches and logging.
- Manual and automated validation to verify the new behaviour.

Out of scope:

- Broader calendar feature additions (e.g., timezone support beyond current defaults).
- Changes to non-calendar agents unless required for integration.

## Phase Breakdown

1. **Phase 1 – Prompt & Signature Alignment**  
   Update prompts, pass `userId` through calendar functions, ensure plumbing is ready for natural-language resolution.

2. **Phase 2 – Prompt-Driven Event Resolution**  
   Teach the calendar agent’s prompt to produce fully populated JSON arguments (summary, time windows, language, etc.) so runtime logic remains lightweight.

3. **Phase 3 – Calendar Function Refactor**  
   Simplify runtime logic: honour prompt-supplied fields, provide sensible defaults (e.g., 10:00–11:00 when time is omitted), and support time-window-only deletes without extra confirmation steps.

4. **Phase 4 – Service & Confirmation Enhancements**  
   Provide helper search methods, improve logging, and align confirmation UX with the database agent.

5. **Phase 5 – Validation & Rollout**  
   Execute manual scenarios, add automated coverage, and finalise documentation.

## Deliverables

- Updated system prompt and calendar runtime code.
- Event resolution utilities and supporting tests.
- Documentation: this README, a running progress log, and testing notes.
- Optional scripts or tooling for manual validation.

## Testing Strategy

- **Manual Regression** – Simulate conversations that create an event, then update/delete it using only natural-language references; cover ambiguous titles and vague times (e.g., “בערב”).
- **Automated Coverage** – Add integration tests (or scripted conversations) that mirror the manual cases to prevent regressions.
- **Logging Verification** – Confirm logs include the natural-language query, derived time ranges, match counts, and chosen event IDs.

## Success Criteria

- The agent no longer depends on `eventId` inputs from the user or the LLM.
- Follow-up instructions referencing event names succeed consistently.
- Disambiguation prompts appear when multiple matches exist, and numeric responses resolve correctly.
- Destructive actions require confirmation when multiple events are affected.
- Documentation and testing steps exist for future maintenance.
