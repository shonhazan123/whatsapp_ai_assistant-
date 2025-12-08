# Planning Logic Consolidation - Implementation Guide

## Overview

This guide shows the exact changes needed to consolidate the two planning logic points into one.

---

## File 1: `src/config/system-prompts.ts`

### Location: `getIntentClassifierPrompt()` function (around line 1520)

### Change: Add multi-step logic to existing prompt

#### Current Section (around line 1655):
```
OUTPUT INSTRUCTIONS:
- Set "requiresPlan": true when the orchestrator should generate or execute a plan (multi-step or multi-agent). 
  Set to false when a single direct agent call is sufficient.
- **CRITICAL**: "Delete all events except X" is a SINGLE-AGENT request → requiresPlan: false.
```

#### Enhanced Section (ADD MORE DETAIL):
```
OUTPUT INSTRUCTIONS:
- Set "requiresPlan": true in these cases:
  1. Multi-agent requests (e.g., "find contact and email them")
  2. Single agent with MULTIPLE SEQUENTIAL operations (e.g., "delete X and create Y")
     - DELETE + CREATE/ADD operations together
     - UPDATE + CREATE operations together
     - DELETE recurring but KEEP specific instances
  
- Set "requiresPlan": false in these cases:
  1. Single operation (create, delete, update, get)
  2. Bulk operations of same type (e.g., "delete all tasks")
  3. "Delete with exceptions" - this is a SINGLE delete operation with excludeSummaries parameter
  4. Operations that can be done in parallel or are independent

CRITICAL DISTINCTIONS:
- "Delete all events except X" → requiresPlan: FALSE (single delete with exceptions parameter)
- "Delete event X and create event Y" → requiresPlan: TRUE (two different operations)
- "Delete recurring events and keep only this week" → requiresPlan: TRUE (delete + conditional keep)
```

#### Current Examples Section (around line 1640):
```
- User: "Delete all events this week except ultrasound" → primaryIntent: "calendar", requiresPlan: false
- User: "תמחק את כל האירועים השבוע חוץ מהישיבה עם דניאל ורוי" → primaryIntent: "calendar", requiresPlan: false
```

#### Enhanced Examples Section (ADD MORE):
```
SINGLE-AGENT, SINGLE OPERATION (requiresPlan: false):
- User: "Delete all events this week except ultrasound" 
  → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"]
  Reason: Single delete operation with exceptions parameter

- User: "תמחק את כל האירועים השבוע חוץ מהישיבה עם דניאל ורוי" 
  → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"]
  Reason: Single delete operation with exceptions

- User: "Create event tomorrow at 2pm"
  → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"]
  Reason: Single create operation

- User: "Delete all my completed tasks"
  → primaryIntent: "database", requiresPlan: false, involvedAgents: ["database"]
  Reason: Bulk delete of same type

SINGLE-AGENT, MULTI-STEP (requiresPlan: true):
- User: "Delete all my tasks and add banana to shopping list"
  → primaryIntent: "database", requiresPlan: true, involvedAgents: ["database"]
  Reason: DELETE + ADD operations require sequential execution

- User: "Delete the recurring event and keep only this week's events"
  → primaryIntent: "calendar", requiresPlan: true, involvedAgents: ["calendar"]
  Reason: Delete + conditional keep requires multi-step

- User: "תמחק את האירועים החוזרים ותשאיר רק את השבוע"
  → primaryIntent: "calendar", requiresPlan: true, involvedAgents: ["calendar"]
  Reason: Delete recurring + keep specific requires sequential steps

- User: "Update event time and create a new reminder"
  → primaryIntent: "calendar", requiresPlan: true, involvedAgents: ["calendar"]
  Reason: UPDATE + CREATE operations

MULTI-AGENT (requiresPlan: true):
- User: "Find Tal's phone number and schedule a meeting with her"
  → primaryIntent: "multi-task", requiresPlan: true, involvedAgents: ["database", "calendar"]
  Reason: Multiple agents involved
```

### Summary of Changes:
1. Add detailed rules for when single-agent needs planning
2. Add explicit examples of single-agent multi-step cases
3. Make the distinction clear between "delete with exceptions" vs "delete + create"

---

## File 2: `src/orchestration/MultiAgentCoordinator.ts`

### Change 1: Remove the second AI call

#### Current Code (lines 66-71):
```typescript
const involvedAgents = this.resolveInvolvedAgents(intentDecision);

// Check if request requires planning even for single agent (e.g., delete + add operations)
const requiresMultiStepPlan = await this.requiresMultiStepPlan(messageText, involvedAgents);

if (!intentDecision.requiresPlan && !requiresMultiStepPlan && involvedAgents.length === 1) {
  return await this.executeSingleAgent(involvedAgents[0], messageText, userPhone, context);
}
```

#### New Code (simplified):
```typescript
const involvedAgents = this.resolveInvolvedAgents(intentDecision);

// Route directly to agent if no planning needed
if (!intentDecision.requiresPlan && involvedAgents.length === 1) {
  return await this.executeSingleAgent(involvedAgents[0], messageText, userPhone, context);
}
```

### Change 2: Remove requiresMultiStepPlan function

#### Current Code (lines 604-663):
```typescript
private async requiresMultiStepPlan(messageText: string, involvedAgents: AgentName[]): Promise<boolean> {
  // Only check if single agent is involved
  if (involvedAgents.length !== 1) {
    return false;
  }

  try {
    const requestId = setAgentNameForTracking('plan-analyzer');

    const completion = await this.openaiService.createCompletion({
      messages: [
        {
          role: 'system',
          content: `You are a request analyzer...`
        },
        // ... rest of prompt ...
      ],
      // ... rest of config ...
    }, requestId);

    // ... parsing logic ...
  } catch (error) {
    // ... error handling ...
  }
}
```

#### New Code:
```typescript
// REMOVED - Logic moved to intent detection
```

### Summary of Changes:
1. Remove line 67 (the second AI call)
2. Simplify line 69 condition (remove `requiresMultiStepPlan` check)
3. Delete entire `requiresMultiStepPlan` function (lines 604-663)

**Result**: ~60 lines of code removed!

---

## File 3: Documentation Updates

### `docs/project-instruction/orchestrator-and-flows.md`

#### Update: Section on Planning Logic

**Before:**
```
The orchestrator makes two checks to determine if planning is needed:
1. Intent detection
2. Multi-step analysis for single-agent requests
```

**After:**
```
The orchestrator makes one check to determine if planning is needed:
- Intent detection analyzes the request and determines both which agents to use 
  and whether orchestrator planning is required
- Handles both multi-agent and single-agent multi-step scenarios
```

---

## Testing Checklist

After implementing the changes, test these scenarios:

### ✅ Should Route Directly (No Planning)

1. **Simple calendar operations**
   - [ ] "What's on my calendar Friday?"
   - [ ] "Create event tomorrow at 2pm"
   - [ ] "Delete event titled 'meeting'"

2. **Delete with exceptions**
   - [ ] "Delete all events this week except ultrasound"
   - [ ] "תמחק את כל האירועים השבוע חוץ מהישיבה עם דניאל ורוי"
   - [ ] "Clear my calendar tomorrow except doctor appointments"

3. **Bulk operations**
   - [ ] "Delete all completed tasks"
   - [ ] "Show all tasks for this week"
   - [ ] "Create multiple events for next week"

### ✅ Should Create Plan (Multi-Step)

1. **Same-agent multi-step**
   - [ ] "Delete all tasks and add banana to shopping list"
   - [ ] "Delete recurring event and keep only this week"
   - [ ] "תמחק את האירועים החוזרים ותשאיר רק את השבוע"
   - [ ] "Update event time and create reminder"

2. **Multi-agent**
   - [ ] "Find Tal's phone and schedule meeting"
   - [ ] "Email Dana and add to calendar"
   - [ ] "Get contact info and send email"

### ✅ Edge Cases

1. **Ambiguous phrasing**
   - [ ] "Delete everything except what I need" (should ask for clarification)
   - [ ] "Fix my calendar" (vague, might route to general)

2. **Complex operations**
   - [ ] "Delete all events from last month, create weekly meeting, and email team"
   - [ ] "Clear calendar Monday-Wednesday except work meetings"

---

## Performance Metrics to Track

### Before Implementation:
- Average latency for single-agent requests: ~3-6 seconds
- AI calls per request: 2 (intent + multi-step)
- Average token cost: ~3,000 tokens

### After Implementation (Expected):
- Average latency for single-agent requests: ~1-3 seconds (50% reduction)
- AI calls per request: 1 (intent only)
- Average token cost: ~2,200 tokens (27% reduction)

### Monitoring Points:
1. Log every request with:
   - `intentDecision.requiresPlan` value
   - Actual route taken (direct vs planned)
   - Latency
   - Token usage

2. Watch for:
   - Any requests that should have been planned but weren't
   - Any requests that were unnecessarily planned
   - Performance improvements vs baseline

---

## Rollback Plan

If issues are discovered:

### Step 1: Immediate Fix
```typescript
// In MultiAgentCoordinator.ts, line 66, uncomment:
const requiresMultiStepPlan = await this.requiresMultiStepPlan(messageText, involvedAgents);

// In line 69, restore:
if (!intentDecision.requiresPlan && !requiresMultiStepPlan && involvedAgents.length === 1) {
```

### Step 2: Investigate
- Check logs to see which requests failed
- Identify what the intent detector missed
- Update prompt with missing cases

### Step 3: Re-test
- Add failing cases as test scenarios
- Verify intent detector now handles them
- Re-deploy consolidated version

---

## Implementation Order

1. ✅ **First**: Update `getIntentClassifierPrompt()` with enhanced logic
2. ✅ **Second**: Test intent detection in isolation (temporary logging)
3. ✅ **Third**: Comment out (don't delete) `requiresMultiStepPlan` call
4. ✅ **Fourth**: Update condition to use only intent detection
5. ✅ **Fifth**: Full integration testing
6. ✅ **Sixth**: Monitor production for 24-48 hours
7. ✅ **Seventh**: Delete old `requiresMultiStepPlan` function
8. ✅ **Eighth**: Update documentation

---

## Success Criteria

✅ All test cases pass
✅ Latency reduced by ~40-50%
✅ Token usage reduced by ~20-30%
✅ No regression in functionality
✅ Cleaner, more maintainable code
✅ Single source of truth for planning logic

---

## Estimated Effort

- **Prompt Updates**: 30 minutes
- **Code Changes**: 15 minutes
- **Testing**: 1-2 hours
- **Monitoring**: 1-2 days
- **Documentation**: 30 minutes

**Total Active Work**: ~3 hours
**Total Including Monitoring**: ~2-3 days

