# Planning Logic Consolidation Analysis

## Current Architecture: Two Separate Planning Decisions

### 1. **First Decision: Intent Detection** (`detectIntent`)

**Location**: `src/services/ai/OpenAIService.ts` (line 246)

**Prompt**: `SystemPrompts.getIntentClassifierPrompt()` in `src/config/system-prompts.ts` (line ~1520)

**What it does**:

- Analyzes the user's message with conversation context
- Returns: `{ primaryIntent, requiresPlan, involvedAgents, confidence }`
- **Decides TWO things**:
  1. Which agent(s) to use (`involvedAgents`)
  2. Whether orchestrator planning is needed (`requiresPlan`)

**Decision criteria for `requiresPlan`**:

- `true` → Multi-agent requests OR multi-step operations
- `false` → Single agent, single operation

**Examples from prompt**:

```
"Find Tal's phone and schedule meeting" → requiresPlan: true (multi-agent)
"What's on my calendar Friday?" → requiresPlan: false (single-agent)
"Delete all events except ultrasound" → requiresPlan: false (single delete with exceptions)
```

---

### 2. **Second Decision: Multi-Step Analysis** (`requiresMultiStepPlan`)

**Location**: `src/orchestration/MultiAgentCoordinator.ts` (line 604)

**Prompt**: Inline in the function (lines 617-638)

**What it does**:

- **Only runs if**: Single agent is involved (`involvedAgents.length === 1`)
- Makes an additional AI call to check if the request has multiple sequential operations
- Returns: boolean (`true` = needs planning, `false` = single operation)

**Decision criteria**:

- `true` → DELETE + CREATE, UPDATE + CREATE, dependent operations
- `false` → Single operation, bulk operations of same type, "delete with exceptions"

**Examples from prompt**:

```
"delete all tasks and add banana" → true (delete + add)
"create event for tomorrow" → false (single create)
"delete all events except ultrasound" → false (single delete with exceptions)
```

---

## Current Flow in MultiAgentCoordinator.handleRequest()

```typescript
// Line 53: First AI call
const intentDecision = await this.openaiService.detectIntent(messageText, context);

// Line 67: Second AI call (only for single-agent requests)
const requiresMultiStepPlan = await this.requiresMultiStepPlan(messageText, involvedAgents);

// Line 69: Decision logic - BOTH must be false to skip planning
if (!intentDecision.requiresPlan && !requiresMultiStepPlan && involvedAgents.length === 1) {
  return await this.executeSingleAgent(...);  // Direct route
}

// Line 73: Otherwise, create a plan
const plan = await this.planActions(...);
```

---

## Why Two Separate Calls?

### Historical Context:

1. **Intent Detection** was created first to route between agents
2. **Multi-Step Analysis** was added later to handle same-agent multi-step operations (e.g., "delete X and create Y")

### Current Redundancy:

- Both are asking the LLM essentially the same question: "Does this need planning?"
- Intent detector has broad scope (all cases)
- Multi-step analyzer has narrow scope (single-agent edge cases)

---

## Problems with Current Architecture

### 1. **Performance**

- Makes **TWO sequential AI calls** for every single-agent request
- Added latency: ~1-3 seconds per call
- Doubled token cost for planning decision

### 2. **Complexity**

- Two prompts must be kept in sync
- Changes require updating both locations
- Debugging is harder (which one failed?)

### 3. **Inconsistency Risk**

- If prompts diverge, results can conflict
- Example: Intent says `false`, multi-step says `true` → confusing behavior
- The "delete with exceptions" bug was caused by this inconsistency

### 4. **Code Smell**

```typescript
if (!intentDecision.requiresPlan && !requiresMultiStepPlan && involvedAgents.length === 1)
```

This logic is trying to compensate for the fact that `intentDecision.requiresPlan` wasn't detailed enough.

---

## Consolidation Plan

### Goal

Merge both planning decisions into a **single LLM call** that returns:

```typescript
{
  primaryIntent: string,
  requiresPlan: boolean,
  involvedAgents: string[],
  confidence: string,
  planningReason?: string  // NEW: Why planning is needed
}
```

### Strategy: Enhance Intent Detection with Multi-Step Logic

---

## Implementation Plan (No Code, Just Strategy)

### Phase 1: Enhance Intent Detection Prompt

**File**: `src/config/system-prompts.ts` → `getIntentClassifierPrompt()`

**Changes**:

1. Add all the multi-step planning logic from `requiresMultiStepPlan` into the intent classifier
2. Add explicit examples for same-agent multi-step cases:
   - "delete X and add Y" → requiresPlan: true
   - "delete recurring and keep this week" → requiresPlan: true
   - "delete all except X" → requiresPlan: false
3. Add decision rules:
   - Multi-agent request → requiresPlan: true
   - Single agent + multiple sequential operations → requiresPlan: true
   - Single agent + single operation (including bulk/exceptions) → requiresPlan: false

**Result**: One comprehensive prompt that handles ALL planning decisions

---

### Phase 2: Remove requiresMultiStepPlan Function

**File**: `src/orchestration/MultiAgentCoordinator.ts`

**Changes**:

1. Remove `requiresMultiStepPlan()` function (lines 604-663)
2. Update `handleRequest()` to use only `intentDecision.requiresPlan`:
   ```typescript
   // Line 69 becomes simpler:
   if (!intentDecision.requiresPlan && involvedAgents.length === 1) {
     return await this.executeSingleAgent(...);
   }
   ```
3. Remove the line 67 call entirely

**Result**: Clean, simple routing logic with single AI call

---

### Phase 3: Testing Strategy

**Test Cases to Verify**:

1. **Multi-agent requests** (should plan):

   - "Find Tal's phone and schedule meeting"
   - "Email Dana and add to calendar"

2. **Single-agent, single operation** (should NOT plan):

   - "What's on my calendar Friday?"
   - "Create event tomorrow at 2pm"
   - "Delete all events except ultrasound"

3. **Single-agent, multi-step** (SHOULD plan):

   - "Delete all tasks and add banana to shopping list"
   - "Delete recurring event and keep only this week"
   - "תמחק את האירועים החוזרים ותשאיר רק את השבוע"

4. **Edge cases**:
   - Bulk operations: "create multiple events"
   - Conditional operations: "delete if overdue"
   - Updates: "update event time to 3pm"

---

### Phase 4: Documentation Updates

**Files to Update**:

1. `docs/project-instruction/orchestrator-and-flows.md`

   - Update to reflect single planning decision
   - Remove references to two-step validation

2. `docs/architecture-analysis/planning-logic-consolidation.md` (this file)
   - Mark as implemented
   - Add before/after metrics

---

## Expected Benefits

### 1. **Performance Improvement**

- **Before**: 2 AI calls for every single-agent request (~2-6 seconds)
- **After**: 1 AI call (~1-3 seconds)
- **Savings**: 50% reduction in planning latency
- **Token cost**: Cut in half for planning decisions

### 2. **Simplified Logic**

```typescript
// Before (complex):
if (!intentDecision.requiresPlan && !requiresMultiStepPlan && involvedAgents.length === 1)

// After (simple):
if (!intentDecision.requiresPlan && involvedAgents.length === 1)
```

### 3. **Easier Maintenance**

- One prompt to update instead of two
- Single source of truth for planning logic
- Clearer debugging (only one call to inspect)

### 4. **Better Consistency**

- No risk of conflicting decisions
- All examples in one place
- Unified decision-making

---

## Migration Checklist

- [ ] Phase 1: Enhance intent detection prompt with multi-step logic
- [ ] Test intent detection with all test cases
- [ ] Phase 2: Remove requiresMultiStepPlan function
- [ ] Test end-to-end flows
- [ ] Phase 3: Run full regression test suite
- [ ] Phase 4: Update documentation
- [ ] Monitor performance metrics
- [ ] Validate token usage reduction

---

## Risk Assessment

### Low Risk

- Intent detection already handles most cases correctly
- Multi-step logic is well-defined with clear examples
- Can be rolled back easily (just revert commits)

### Mitigation

- Keep requiresMultiStepPlan commented out temporarily (not deleted)
- Test thoroughly before removing old code
- Monitor logs for any edge cases that fail

---

## Summary

**Current State**: Two separate AI calls making redundant planning decisions
**Target State**: One comprehensive AI call that handles all planning logic
**Benefit**: 50% faster, simpler code, easier maintenance, no inconsistency bugs
**Complexity**: Low - mostly prompt consolidation
**Risk**: Low - clear rollback path
