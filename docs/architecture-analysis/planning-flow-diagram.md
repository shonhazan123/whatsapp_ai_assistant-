# Planning Logic Flow - Current vs Proposed

## CURRENT FLOW (Two AI Calls)

```
User Message: "תמחק את כל האירועים השבוע חוץ מהישיבה עם דניאל ורוי"
    |
    v
┌─────────────────────────────────────────────────────────────┐
│  MultiAgentCoordinator.handleRequest()                      │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 53: First AI Call
    v
┌─────────────────────────────────────────────────────────────┐
│  OpenAIService.detectIntent()                               │
│  ──────────────────────────────────────────────────────────│
│  Prompt: getIntentClassifierPrompt() (~200 lines)          │
│  Cost: ~2,000 tokens                                        │
│  Duration: ~1-3 seconds                                     │
│  ──────────────────────────────────────────────────────────│
│  Returns:                                                   │
│  {                                                          │
│    primaryIntent: "calendar",                              │
│    requiresPlan: false,        ← First decision            │
│    involvedAgents: ["calendar"],                           │
│    confidence: "high"                                       │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 64: Check agent count
    v
┌─────────────────────────────────────────────────────────────┐
│  involvedAgents.length === 1?                               │
│  YES → Continue to second check                             │
│  NO  → Skip to planning                                     │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 67: Second AI Call (for single-agent only)
    v
┌─────────────────────────────────────────────────────────────┐
│  MultiAgentCoordinator.requiresMultiStepPlan()             │
│  ──────────────────────────────────────────────────────────│
│  Prompt: Inline prompt (~20 lines)                         │
│  Cost: ~1,000 tokens                                        │
│  Duration: ~1-3 seconds                                     │
│  ──────────────────────────────────────────────────────────│
│  Returns:                                                   │
│  {                                                          │
│    requiresPlan: false         ← Second decision           │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 69: Combined decision
    v
┌─────────────────────────────────────────────────────────────┐
│  if (!intentDecision.requiresPlan &&                        │
│      !requiresMultiStepPlan &&                              │
│      involvedAgents.length === 1)                           │
│  ──────────────────────────────────────────────────────────│
│  ALL THREE CONDITIONS MUST BE TRUE                          │
└─────────────────────────────────────────────────────────────┘
    |
    |  Both said "no plan needed"
    v
┌─────────────────────────────────────────────────────────────┐
│  executeSingleAgent(calendar, message, ...)                │
│  → Direct route to Calendar Agent                           │
│  → Calendar handles delete with excludeSummaries            │
└─────────────────────────────────────────────────────────────┘

TOTAL: 2 AI calls, 3-6 seconds, ~3,000 tokens
```

---

## PROPOSED FLOW (One AI Call)

```
User Message: "תמחק את כל האירועים השבוע חוץ מהישיבה עם דניאל ורוי"
    |
    v
┌─────────────────────────────────────────────────────────────┐
│  MultiAgentCoordinator.handleRequest()                      │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 53: ONLY AI Call
    v
┌─────────────────────────────────────────────────────────────┐
│  OpenAIService.detectIntent() [ENHANCED]                    │
│  ──────────────────────────────────────────────────────────│
│  Prompt: ENHANCED getIntentClassifierPrompt()              │
│         (includes multi-step logic from requiresMultiStep)  │
│  Cost: ~2,200 tokens (slightly more comprehensive)         │
│  Duration: ~1-3 seconds                                     │
│  ──────────────────────────────────────────────────────────│
│  Decision logic now includes:                               │
│  ✓ Multi-agent detection                                   │
│  ✓ Same-agent multi-step detection                         │
│  ✓ "Delete with exceptions" = single operation             │
│  ✓ "Delete + Create" = multi-step                          │
│  ──────────────────────────────────────────────────────────│
│  Returns:                                                   │
│  {                                                          │
│    primaryIntent: "calendar",                              │
│    requiresPlan: false,        ← ONE comprehensive decision│
│    involvedAgents: ["calendar"],                           │
│    confidence: "high"                                       │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
    |
    |  Line 67: [REMOVED] - No second call needed
    |
    |  Line 69: Simplified decision
    v
┌─────────────────────────────────────────────────────────────┐
│  if (!intentDecision.requiresPlan &&                        │
│      involvedAgents.length === 1)                           │
│  ──────────────────────────────────────────────────────────│
│  ONLY TWO CONDITIONS (simpler logic)                        │
└─────────────────────────────────────────────────────────────┘
    |
    |  Decision said "no plan needed"
    v
┌─────────────────────────────────────────────────────────────┐
│  executeSingleAgent(calendar, message, ...)                │
│  → Direct route to Calendar Agent                           │
│  → Calendar handles delete with excludeSummaries            │
└─────────────────────────────────────────────────────────────┘

TOTAL: 1 AI call, 1-3 seconds, ~2,200 tokens

IMPROVEMENT: 50% faster, 27% fewer tokens, simpler code
```

---

## Side-by-Side Comparison

| Aspect                  | Current (Two Calls) | Proposed (One Call) | Improvement   |
| ----------------------- | ------------------- | ------------------- | ------------- |
| **AI Calls**            | 2 sequential        | 1                   | 50% reduction |
| **Latency**             | 3-6 seconds         | 1-3 seconds         | 50% faster    |
| **Token Cost**          | ~3,000 tokens       | ~2,200 tokens       | 27% cheaper   |
| **Code Complexity**     | 3 conditions        | 2 conditions        | Simpler       |
| **Prompts to Maintain** | 2 separate          | 1 unified           | Easier        |
| **Consistency Risk**    | High (can conflict) | None                | More reliable |
| **Debugging**           | Check 2 calls       | Check 1 call        | Easier        |

---

## Key Decision Points Consolidated

### Multi-Agent Requests

```
Before: Intent detector says "requiresPlan: true"
After:  Intent detector says "requiresPlan: true"
Status: ✅ Already handled correctly
```

### Single-Agent, Single Operation

```
Before: Intent says "false", multi-step says "false"
After:  Intent says "false"
Status: ✅ Simplified
```

### Single-Agent, Multi-Step (e.g., "delete X and create Y")

```
Before: Intent says "false", multi-step says "true" → goes to planning
After:  Intent says "true" → goes to planning
Status: ✅ Logic moved to intent detection
```

### Single-Agent, Delete with Exceptions

```
Before: Intent says "false", multi-step says "false"
After:  Intent says "false"
Status: ✅ Simplified (was causing bugs!)
```

---

## What Gets Merged Into Intent Detection Prompt

From `requiresMultiStepPlan` prompt, add to `getIntentClassifierPrompt`:

```
✅ ADD: "Delete + Create" requires planning
✅ ADD: "Update + Create" requires planning
✅ ADD: "Delete with exceptions" does NOT require planning
✅ ADD: Examples for same-agent multi-step
✅ ADD: Explicit rules for when single-agent needs planning
```

Result: One comprehensive prompt with ALL planning logic

---

## Implementation Difficulty: LOW

### Why Low Risk:

1. Intent detection already handles 90% of cases correctly
2. Just adding examples and rules from the second call
3. Can test incrementally
4. Easy to roll back if needed

### Steps:

1. Copy logic from `requiresMultiStepPlan` into intent classifier prompt
2. Test with all edge cases
3. Comment out (don't delete) `requiresMultiStepPlan` function
4. Test again
5. If successful, remove old code
6. If issues, uncomment and investigate

---

## Bottom Line

**Problem**: Making two AI calls to answer the same question
**Solution**: Merge into one comprehensive call
**Benefit**: Faster, cheaper, simpler, more reliable
**Effort**: Low (mostly prompt consolidation)
**Risk**: Very low (clear rollback path)
