---
name: Fix bulk calendar delete
overview: "Fix the bulk calendar delete flow: (1) improve LLM resolver prompt so plural delete routes to deleteBySummary, (2) make HITLGateNode the single gate for all disambiguation user-interaction — normalize replies to clean values (number, 'all', switch_intent) before they reach entity resolver, (3) simplify applySelection() to only accept clean normalized inputs and handle operation upgrade."
todos:
  - id: fix-resolver-prompt
    content: "Update CalendarMutateResolver system prompt: rewrite delete operation selection rules, remove '(no window)' qualifier from deleteBySummary, add plural delete examples, add delete vs deleteBySummary discriminator rule"
    status: pending
  - id: fix-hitl-disambiguation-normalizer
    content: "HITLGateNode.handleDisambiguationResume(): add LLM fallback so ALL disambiguation replies are normalized to clean values (number, 'all', or switch_intent) before reaching entity resolver. Remove free-text passthrough."
    status: pending
  - id: fix-apply-selection-cleanup
    content: "Clean up CalendarEntityResolver.applySelection(): remove all raw user-text interpretation (Hebrew/English keyword matching). Only accept clean inputs: number, number[], or 'all'. Add operation upgrade from 'delete' to 'deleteBySummary' when 'all' is selected."
    status: pending
isProject: false
---

# Fix Bulk Calendar Delete Routing

## Problem

Two issues compound into the bug:

1. The LLM resolver picks `operation: 'delete'` (single-event path) instead of `deleteBySummary` when user uses plural language ("delete them").
2. The disambiguation HITL path passes raw user text straight through to `CalendarEntityResolver.applySelection()`, which also fails to interpret it. User interaction should never be handled inside entity resolver — HITLGateNode is the single gate for all user-facing interaction.

### Architectural Principle

**HITLGateNode owns all user interaction.** Entity resolver should never interpret raw user text. By the time `applySelection()` is called, it should only receive clean, normalized values:

- A **number** (1-based selection index)
- An **array of numbers** (multi-selection)
- The string `**"all"`** (select all candidates)

## Fix 1 (Primary): Improve LLM Resolver Prompt

**File:** [CalendarResolvers.ts](Memo_v2/src/graph/resolvers/CalendarResolvers.ts)

The current operation selection guidance (lines 246-248) is ambiguous:

```
- User wants to DELETE/CANCEL a SINGLE event → "delete"
- User wants to DELETE ALL events in a time window → "deleteByWindow"
- User wants to DELETE all events matching summary (no window) → "deleteBySummary"
```

**Changes to the system prompt:**

1. Rewrite operation selection rules — make singular/plural boundary explicit:

```
- User wants to DELETE/CANCEL a SINGLE event (singular language, specific date) → "delete"
- User wants to DELETE ALL events in a time window (no specific summary) → "deleteByWindow"
- User wants to DELETE MULTIPLE events matching a summary/name (with or without time window) → "deleteBySummary"
```

1. Update AVAILABLE OPERATIONS descriptions:

```
- **delete**: Delete a SINGLE event (user treats it as one specific event)
- **deleteBySummary**: Delete all events matching summary (with or without time window). Use when user refers to MULTIPLE events by name.
- **deleteByWindow**: Delete ALL events in a time window regardless of summary
```

1. Add plural delete examples:

```
Example X - Delete multiple named events (plural language):
User: "תמחקי אותם" (context: previously discussed "קייטנה לאפיק" events on March 24-30)
→ { "operation": "deleteBySummary", "summary": "קייטנה לאפיק", "timeMin": "...", "timeMax": "...", "language": "he" }

Example Y - Delete all events with same name:
User: "delete all the team meetings next week"
→ { "operation": "deleteBySummary", "summary": "team meeting", "timeMin": "...", "timeMax": "...", "language": "en" }
```

1. Add discriminator rule:

```
### delete vs deleteBySummary:
- "delete" = user refers to ONE specific event (singular: "the event", "את האירוע", specific date)
- "deleteBySummary" = user refers to MULTIPLE events by name (plural: "אותם", "them", "all the X", "את כל ה-X")
- When in doubt, prefer deleteBySummary — it safely handles both single and multiple matches.
```

## Fix 2: HITLGateNode — Normalize ALL Disambiguation Replies

**File:** [HITLGateNode.ts](Memo_v2/src/graph/nodes/HITLGateNode.ts)

### The Gap

Currently disambiguation has only deterministic keyword matching (line 458: "Entity disambiguation uses deterministic validation only"). The `validateSingleChoice()` method falls through to a free-text passthrough (line 1063: `return { valid: true, parsed: trimmed }`) that dumps raw user text directly into entity resolver.

The planner HITL path already has the right pattern: fast path (deterministic) -> LLM interpreter (fallback) -> state transition. Disambiguation should follow the same pattern.

### Changes

**A) Update `handleDisambiguationResume()` (line 562):**

Add a check after `validateReply()` — if the result is a "clean" match (number or exact "all" keyword), pass through directly. Otherwise, call a new lightweight `callDisambiguationInterpreter()` to normalize it.

```typescript
private async handleDisambiguationResume(state, pending, rawReply): Command {
  const validation = this.validateReply(rawReply, pending);

  // Layer 1: deterministic fast path — number or exact "all" keyword
  if (validation.valid && this.isCleanDisambiguationMatch(validation.parsed, pending)) {
    return this.buildDisambiguationCommand(state, pending, validation.parsed, rawReply);
  }

  // Layer 2: LLM interpreter — normalize free-text to known value
  const interpreted = await this.callDisambiguationInterpreter(pending, rawReply);

  if (interpreted === null) {
    return this.buildSwitchIntentCommand(state, pending, rawReply);
  }

  // Normalized to number or "all"
  return this.buildDisambiguationCommand(state, pending, interpreted, rawReply);
}
```

**B) Add `isCleanDisambiguationMatch()` helper:**

Returns `true` if parsed is a number, array of numbers, or one of the normalized "all" keywords (`['all', 'both', 'כולם', 'שניהם']`). Returns `false` if it was the free-text fallback (raw string that isn't a known keyword).

**C) Add `callDisambiguationInterpreter()` method:**

Lightweight LLM call (gpt-4o-mini, ~200 tokens) that normalizes free-text disambiguation replies. Only fires when deterministic matching fails — no added cost on the happy path.

System prompt:

```
You are classifying a user's reply to a numbered-options question.

The question was: "{pending.question}"
Options: {pending.options as numbered list}

The user replied: "{rawReply}"

Determine what the user meant. Return JSON:
- { "selection": <number> } if user picked a specific option (1-based)
- { "selection": "all" } if user wants ALL options
- { "selection": null } if the reply is unrelated or a new request

Return only the JSON.
```

**D) Normalize "all" keywords in the deterministic path:**

In `validateSingleChoice()`, when exact "all" keywords match (line 1057-1059), normalize to the canonical string `"all"` instead of passing the raw keyword:

```typescript
// Before (passes raw: "כולם", "שניהם", etc.)
return { valid: true, parsed: trimmed };

// After (always normalizes to "all")
return { valid: true, parsed: 'all' };
```

This ensures entity resolver always receives `"all"` regardless of which language/synonym the user used.

**E) Remove free-text fallback in `validateSingleChoice()`:**

Remove line 1063 (`return { valid: true, parsed: trimmed }`). If no deterministic match, return `{ valid: false, parsed: null }` so the LLM layer is invoked.

## Fix 3: Simplify `applySelection()` — Clean Inputs Only

**File:** [CalendarEntityResolver.ts](Memo_v2/src/services/resolution/CalendarEntityResolver.ts)

Since HITLGateNode now guarantees normalized inputs, `applySelection()` can be cleaned up. It should only handle:

- `**number`** — select candidate at that index (1-based)
- `**number[]`** — select multiple candidates by index
- `**"all"**` — select all candidates

### Changes

**A) Remove raw user-text interpretation (lines 109-202):**

Remove all Hebrew/English keyword matching:

- Lines 114-131: `lowerSelection.includes('כולם')`, `lowerSelection.includes('רק')`, etc. for recurring choice
- Lines 173-175: `lowerSelection === 'both' || lowerSelection === 'שניהם' || lowerSelection === 'כולם'`
- Lines 191-201: `parseInt(selection, 10)` fallback and "Invalid selection" error

Replace with a clean switch on normalized input types:

```typescript
async applySelection(
  selection: number | number[] | 'all',
  candidates: ResolutionCandidate[],
  args: Record<string, any>
): Promise<ResolutionOutput> {
  const isRecurringChoice = candidates.length === 2 &&
    candidates.some(c => c.id === 'all') &&
    candidates.some(c => c.id === 'single');

  // "all" — select all candidates
  if (selection === 'all') {
    if (isRecurringChoice) {
      return this.applyRecurringAll(candidates, args);
    }
    return this.applySelectAll(candidates, args);
  }

  // number — single selection (1-based)
  if (typeof selection === 'number') {
    if (isRecurringChoice) {
      return this.applyRecurringByIndex(selection, candidates, args);
    }
    return this.applySingleSelection(selection, candidates, args);
  }

  // number[] — multi selection
  if (Array.isArray(selection)) {
    return this.applyMultiSelection(selection, candidates, args);
  }
}
```

**B) In `applySelectAll()`, upgrade operation when needed:**

```typescript
private applySelectAll(candidates, args): ResolutionOutput {
  const resolvedArgs = {
    ...args,
    eventIds: candidates.map(c => c.id),
  };
  if (args.operation === 'delete' || args.operation === 'deleteBySummary') {
    resolvedArgs.operation = 'deleteBySummary';
    resolvedArgs.deletedSummaries = candidates.map(c => c.entity?.summary || c.displayText);
    resolvedArgs.originalEvents = candidates.map(c => c.entity);
  }
  return { type: 'resolved', resolvedIds: candidates.map(c => c.id), args: resolvedArgs };
}
```

## Files Changed

- [CalendarResolvers.ts](Memo_v2/src/graph/resolvers/CalendarResolvers.ts) — prompt improvements (primary fix)
- [HITLGateNode.ts](Memo_v2/src/graph/nodes/HITLGateNode.ts) — normalize all disambiguation replies via deterministic + LLM fallback
- [CalendarEntityResolver.ts](Memo_v2/src/services/resolution/CalendarEntityResolver.ts) — simplify `applySelection()` to only accept clean inputs

## No Changes To

- **EntityResolutionNode** — correctly delegates to resolver's `applySelection()`
- **CalendarServiceAdapter** — `deleteBySummary()` already handles both single and bulk correctly

