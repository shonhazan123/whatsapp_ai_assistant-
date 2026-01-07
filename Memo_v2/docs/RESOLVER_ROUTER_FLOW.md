# ResolverRouterNode → ExecutorNode → JoinNode Flow

> **Visual explanation of the execution pipeline from resolver routing to result joining**

---

## Table of Contents

1. [High-Level Flow Overview](#1-high-level-flow-overview)
2. [Use Case 1: Single Step (Simple Request)](#2-use-case-1-single-step-simple-request)
3. [Use Case 2: Parallel Steps (Independent Operations)](#3-use-case-2-parallel-steps-independent-operations)
4. [Use Case 3: Dependent Steps (Sequential Operations)](#4-use-case-3-dependent-steps-sequential-operations)
5. [Use Case 4: Mixed (Parallel + Sequential)](#5-use-case-4-mixed-parallel--sequential)
6. [Function Call Details](#6-function-call-details)
7. [Error Handling Scenarios](#7-error-handling-scenarios)

---

## 1. High-Level Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPLETE EXECUTION PIPELINE                         │
└─────────────────────────────────────────────────────────────────────────┘

PlannerNode
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    RESOLVER ROUTER NODE                                 │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 1. process(state)                                                │  │
│  │    ├─ Read plan from state.plannerOutput.plan                   │  │
│  │    ├─ buildExecutionGroups(plan)                                │  │
│  │    │   └─ Build dependency DAG, group by dependencies           │  │
│  │    └─ For each group: executeGroup(group, state)                 │  │
│  │                                                                   │  │
│  │ 2. executeGroup(group, state)                                    │  │
│  │    ├─ If parallelizable: Promise.allSettled()                   │  │
│  │    └─ Else: Sequential for loop                                  │  │
│  │                                                                   │  │
│  │ 3. routeAndExecute(step, state)                                  │  │
│  │    ├─ findResolver(capability, action)                           │  │
│  │    ├─ resolver.resolve(step, state)  ← LLM CALL HERE            │  │
│  │    └─ Return RoutingResult                                        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│                    state.resolverResults (Map)                          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        EXECUTOR NODE                                    │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 1. process(state)                                                │  │
│  │    ├─ Read resolverResults from state                           │  │
│  │    ├─ Filter: only type='execute'                               │  │
│  │    ├─ Group by capability (for potential parallelism)           │  │
│  │    └─ For each result: executeStep() in parallel                 │  │
│  │                                                                   │  │
│  │ 2. executeStep(stepId, capability, args, userPhone)              │  │
│  │    ├─ Switch on capability:                                     │  │
│  │    │   ├─ calendar → CalendarServiceAdapter.execute()            │  │
│  │    │   ├─ database → TaskServiceAdapter / ListServiceAdapter    │  │
│  │    │   ├─ gmail → GmailServiceAdapter.execute()                  │  │
│  │    │   ├─ second-brain → SecondBrainServiceAdapter.execute()     │  │
│  │    │   └─ general/meta → Return args as-is (no service call)    │  │
│  │    └─ Return ExecutionResult                                     │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│                    state.executionResults (Map)                        │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          JOIN NODE                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 1. process(state)                                                │  │
│  │    ├─ Read executionResults from state                           │  │
│  │    ├─ Count successes and failures                               │  │
│  │    ├─ Detect partial failures                                    │  │
│  │    ├─ Build summary                                              │  │
│  │    └─ Return unified executionResults                            │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│                              ▼                                          │
│                    Continue to ResponseFormatterNode                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Use Case 1: Single Step (Simple Request)

**User Message**: "היי" (Hi)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: PlannerNode Output                                          │
└─────────────────────────────────────────────────────────────────────┘

state.plannerOutput = {
  intentType: 'conversation',
  confidence: 0.7,
  plan: [
    {
      id: 'A',
      capability: 'general',
      action: 'respond',
      constraints: {},
      changes: {},
      dependsOn: []
    }
  ]
}

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: ResolverRouterNode.process()                                │
└─────────────────────────────────────────────────────────────────────┘

1. buildExecutionGroups(plan)
   ├─ Input: [Step A]
   ├─ Dependencies: [] (empty)
   ├─ Output: [
   │     {
   │       groupIndex: 0,
   │       steps: [Step A],
   │       parallelizable: false  // Only 1 step
   │     }
   │   ]

2. executeGroup(group[0], state)
   ├─ parallelizable: false → Sequential execution
   └─ routeAndExecute(Step A, state)
      ├─ findResolver('general', 'respond')
      │  └─ Returns: GeneralResolver instance
      ├─ resolver.resolve(Step A, state)
      │  ├─ GeneralResolver.callLLM(Step A, state)  ← LLM CALL
      │  │  ├─ System Prompt: "You are Memo..."
      │  │  ├─ User Message: "היי" + context
      │  │  ├─ Function: generalResponse({ response, language })
      │  │  └─ LLM Returns: { response: "שלום! איך אפשר לעזור?", language: "he" }
      │  └─ Returns: {
      │       stepId: 'A',
      │       type: 'execute',
      │       args: {
      │         response: "שלום! איך אפשר לעזור?",
      │         language: "he"
      │       }
      │     }
      └─ Returns: {
           stepId: 'A',
           resolverName: 'general_resolver',
           result: { stepId: 'A', type: 'execute', args: {...} }
         }

3. State Update
   state.resolverResults = Map {
     'A' => {
       stepId: 'A',
       type: 'execute',
       args: { response: "שלום! איך אפשר לעזור?", language: "he" }
     }
   }

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: ExecutorNode.process()                                      │
└─────────────────────────────────────────────────────────────────────┘

1. Read resolverResults
   ├─ Size: 1
   └─ Step A: type='execute' ✓

2. executeStep('A', 'general', args, userPhone)
   ├─ capability: 'general'
   ├─ Switch: case 'general'
   │  └─ No external service call
   │     └─ result = { success: true, data: args }
   └─ Returns: {
        stepId: 'A',
        success: true,
        data: {
          response: "שלום! איך אפשר לעזור?",
          language: "he"
        },
        durationMs: 2
      }

3. State Update
   state.executionResults = Map {
     'A' => {
       stepId: 'A',
       success: true,
       data: { response: "...", language: "he" },
       durationMs: 2
     }
   }

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: JoinNode.process()                                          │
└─────────────────────────────────────────────────────────────────────┘

1. Read executionResults
   ├─ Size: 1
   └─ All successful: 1

2. Build Summary
   ├─ totalSteps: 1
   ├─ successfulSteps: 1
   ├─ failedSteps: 0
   ├─ partialFailure: false
   └─ errors: []

3. Return
   └─ state.executionResults (unchanged, passed through)

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: Continue to ResponseFormatterNode                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Function Call Sequence

```
ResolverRouterNode.process()
  └─ buildExecutionGroups([Step A])
     └─ Returns: [Group 0: [Step A]]
  └─ executeGroup(Group 0, state)
     └─ routeAndExecute(Step A, state)
        └─ findResolver('general', 'respond')
           └─ Returns: GeneralResolver
        └─ GeneralResolver.resolve(Step A, state)
           └─ GeneralResolver.callLLM(Step A, state)  ← LLM API CALL
              └─ LLMService.callLLM()
                 └─ OpenAIService.createCompletion()
                    └─ Returns: { response: "...", language: "he" }
           └─ Returns: ResolverResult { type: 'execute', args: {...} }

ExecutorNode.process()
  └─ executeStep('A', 'general', args, userPhone)
     └─ Switch: 'general' → No service call
        └─ Returns: ExecutionResult { success: true, data: {...} }

JoinNode.process()
  └─ Build summary from executionResults
     └─ Returns: { executionResults: Map }
```

---

## 3. Use Case 2: Parallel Steps (Independent Operations)

**User Message**: "מה יש לי היום בלוח שנה וגם תשלח לי את המשימות שלי"  
(What do I have today in calendar and also send me my tasks)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: PlannerNode Output                                          │
└─────────────────────────────────────────────────────────────────────┘

state.plannerOutput = {
  intentType: 'operation',
  confidence: 0.9,
  plan: [
    {
      id: 'A',
      capability: 'calendar',
      action: 'list_events',
      constraints: { timeMin: '2025-01-03T00:00:00', timeMax: '2025-01-03T23:59:59' },
      changes: {},
      dependsOn: []  ← No dependencies
    },
    {
      id: 'B',
      capability: 'database',
      action: 'list_tasks',
      constraints: {},
      changes: {},
      dependsOn: []  ← No dependencies
    }
  ]
}

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: ResolverRouterNode.process()                                │
└─────────────────────────────────────────────────────────────────────┘

1. buildExecutionGroups(plan)
   ├─ Input: [Step A, Step B]
   ├─ Step A.dependsOn: [] → Ready
   ├─ Step B.dependsOn: [] → Ready
   ├─ Both ready → Same group
   └─ Output: [
         {
           groupIndex: 0,
           steps: [Step A, Step B],
           parallelizable: true  ← Can run in parallel!
         }
       ]

2. executeGroup(group[0], state)
   ├─ parallelizable: true → Parallel execution
   ├─ Promise.allSettled([
   │     routeAndExecute(Step A, state),
   │     routeAndExecute(Step B, state)
   │   ])
   │
   ├─ [Parallel Branch 1] routeAndExecute(Step A, state)
   │  ├─ findResolver('calendar', 'list_events')
   │  │  └─ Returns: CalendarFindResolver
   │  ├─ CalendarFindResolver.resolve(Step A, state)
   │  │  ├─ CalendarFindResolver.callLLM(Step A, state)  ← LLM CALL 1
   │  │  │  └─ Returns: { operation: 'getEvents', timeMin: '...', timeMax: '...' }
   │  │  └─ Returns: { stepId: 'A', type: 'execute', args: {...} }
   │  └─ Returns: RoutingResult { stepId: 'A', resolverName: 'calendar_find_resolver', result: {...} }
   │
   └─ [Parallel Branch 2] routeAndExecute(Step B, state)
      ├─ findResolver('database', 'list_tasks')
      │  └─ Returns: DatabaseTaskResolver
      ├─ DatabaseTaskResolver.resolve(Step B, state)
      │  ├─ DatabaseTaskResolver.callLLM(Step B, state)  ← LLM CALL 2 (parallel)
      │  │  └─ Returns: { operation: 'getAll', filters: {...} }
      │  └─ Returns: { stepId: 'B', type: 'execute', args: {...} }
      └─ Returns: RoutingResult { stepId: 'B', resolverName: 'database_task_resolver', result: {...} }

3. State Update
   state.resolverResults = Map {
     'A' => { stepId: 'A', type: 'execute', args: { operation: 'getEvents', ... } },
     'B' => { stepId: 'B', type: 'execute', args: { operation: 'getAll', ... } }
   }

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: ExecutorNode.process()                                      │
└─────────────────────────────────────────────────────────────────────┘

1. Read resolverResults
   ├─ Size: 2
   ├─ Step A: type='execute' ✓
   └─ Step B: type='execute' ✓

2. Execute in parallel (Promise.all)
   ├─ [Parallel] executeStep('A', 'calendar', args, userPhone)
   │  ├─ capability: 'calendar'
   │  ├─ Switch: case 'calendar'
   │  │  └─ CalendarServiceAdapter.execute(args)
   │  │     └─ getCalendarService().getEvents(...)  ← V1 Service Call
   │  │        └─ Returns: { success: true, data: [{ id: 'evt-1', summary: '...', ... }] }
   │  └─ Returns: ExecutionResult { stepId: 'A', success: true, data: {...} }
   │
   └─ [Parallel] executeStep('B', 'database', args, userPhone)
      ├─ capability: 'database'
      ├─ Switch: case 'database'
      │  ├─ isListOperation(args) → false
      │  └─ TaskServiceAdapter.execute(args)
      │     └─ getTaskService().getAll(...)  ← V1 Service Call
      │        └─ Returns: { success: true, data: [{ id: 'task-1', text: '...', ... }] }
      └─ Returns: ExecutionResult { stepId: 'B', success: true, data: {...} }

3. State Update
   state.executionResults = Map {
     'A' => { stepId: 'A', success: true, data: { events: [...] } },
     'B' => { stepId: 'B', success: true, data: { tasks: [...] } }
   }

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: JoinNode.process()                                          │
└─────────────────────────────────────────────────────────────────────┘

1. Read executionResults
   ├─ Size: 2
   ├─ Step A: success=true ✓
   └─ Step B: success=true ✓

2. Build Summary
   ├─ totalSteps: 2
   ├─ successfulSteps: 2
   ├─ failedSteps: 0
   ├─ partialFailure: false
   └─ errors: []

3. Return
   └─ state.executionResults (both results merged)

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 5: ResponseFormatterNode                                       │
└─────────────────────────────────────────────────────────────────────┘
   └─ Formats both calendar events and tasks for display
```

### Function Call Sequence

```
ResolverRouterNode.process()
  └─ buildExecutionGroups([Step A, Step B])
     └─ Returns: [Group 0: [Step A, Step B]]  // Both ready, parallelizable
  └─ executeGroup(Group 0, state)
     └─ Promise.allSettled([
           routeAndExecute(Step A, state),  ← Parallel
           routeAndExecute(Step B, state)    ← Parallel
         ])
        ├─ [Thread 1] CalendarFindResolver.resolve() → LLM Call 1
        └─ [Thread 2] DatabaseTaskResolver.resolve() → LLM Call 2 (simultaneous)

ExecutorNode.process()
  └─ Promise.all([
        executeStep('A', 'calendar', ...),  ← Parallel
        executeStep('B', 'database', ...)  ← Parallel
      ])
     ├─ [Thread 1] CalendarServiceAdapter.execute() → V1 Service Call 1
     └─ [Thread 2] TaskServiceAdapter.execute() → V1 Service Call 2 (simultaneous)

JoinNode.process()
  └─ Merge both results
     └─ Returns: { executionResults: Map with both A and B }
```

---

## 4. Use Case 3: Dependent Steps (Sequential Operations)

**User Message**: "מחק את הפגישה עם דנה ואז צור משימה להתקשר אליה"  
(Delete the meeting with Dana and then create a task to call her)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: PlannerNode Output                                          │
└─────────────────────────────────────────────────────────────────────┘

state.plannerOutput = {
  intentType: 'operation',
  confidence: 0.85,
  plan: [
    {
      id: 'A',
      capability: 'calendar',
      action: 'delete_event',
      constraints: { summary: 'פגישה עם דנה' },
      changes: {},
      dependsOn: []  ← No dependencies
    },
    {
      id: 'B',
      capability: 'database',
      action: 'create_task',
      constraints: { text: 'להתקשר לדנה' },
      changes: {},
      dependsOn: ['A']  ← Depends on Step A completing first
    }
  ]
}

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: ResolverRouterNode.process()                                │
└─────────────────────────────────────────────────────────────────────┘

1. buildExecutionGroups(plan)
   ├─ Input: [Step A, Step B]
   ├─ Step A.dependsOn: [] → Ready ✓
   ├─ Step B.dependsOn: ['A'] → NOT ready (A not completed yet)
   ├─ Group 0: [Step A] (only ready step)
   ├─ After A completes: Step B.dependsOn: ['A'] → Ready ✓
   └─ Group 1: [Step B]
   └─ Output: [
         {
           groupIndex: 0,
           steps: [Step A],
           parallelizable: false
         },
         {
           groupIndex: 1,
           steps: [Step B],
           parallelizable: false
         }
       ]

2. Execute Group 0
   └─ routeAndExecute(Step A, state)
      ├─ CalendarMutateResolver.resolve(Step A, state)
      │  ├─ CalendarMutateResolver.callLLM(Step A, state)  ← LLM CALL 1
      │  │  └─ Returns: { operation: 'deleteBySummary', summary: 'פגישה עם דנה', ... }
      │  └─ Returns: { stepId: 'A', type: 'execute', args: {...} }
      └─ State Update: resolverResults['A'] = {...}

3. Execute Group 1 (after Group 0 completes)
   └─ routeAndExecute(Step B, state)
      ├─ DatabaseTaskResolver.resolve(Step B, state)
      │  ├─ DatabaseTaskResolver.callLLM(Step B, state)  ← LLM CALL 2 (after A)
      │  │  └─ Returns: { operation: 'create', text: 'להתקשר לדנה', ... }
      │  └─ Returns: { stepId: 'B', type: 'execute', args: {...} }
      └─ State Update: resolverResults['B'] = {...}

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: ExecutorNode.process()                                      │
└─────────────────────────────────────────────────────────────────────┘

1. Read resolverResults
   ├─ Size: 2
   ├─ Step A: type='execute' ✓
   └─ Step B: type='execute' ✓

2. Execute (can be parallel since no dependencies in executor)
   ├─ executeStep('A', 'calendar', args, userPhone)
   │  └─ CalendarServiceAdapter.execute()
   │     └─ getCalendarService().deleteBySummary(...)  ← V1 Service Call 1
   │
   └─ executeStep('B', 'database', args, userPhone)
      └─ TaskServiceAdapter.execute()
         └─ getTaskService().create(...)  ← V1 Service Call 2

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: JoinNode.process()                                          │
└─────────────────────────────────────────────────────────────────────┘
   └─ Merge both results (both successful)
```

### Function Call Sequence

```
ResolverRouterNode.process()
  └─ buildExecutionGroups([Step A, Step B])
     ├─ Group 0: [Step A]  // A has no dependencies
     └─ Group 1: [Step B]  // B depends on A
  └─ For each group (sequential):
     ├─ executeGroup(Group 0)  ← Execute A first
     │  └─ CalendarMutateResolver.resolve() → LLM Call 1
     └─ executeGroup(Group 1)  ← Execute B after A completes
        └─ DatabaseTaskResolver.resolve() → LLM Call 2

ExecutorNode.process()
  └─ Both steps execute (can be parallel, no dependencies in executor)
     ├─ executeStep('A', ...) → V1 Service Call 1
     └─ executeStep('B', ...) → V1 Service Call 2

JoinNode.process()
  └─ Merge results
```

---

## 5. Use Case 4: Mixed (Parallel + Sequential)

**User Message**: "צור אירוע מחר בשעה 10, תשלח לי את האימיילים שלי, ואז צור משימה לבדוק אותם"  
(Create event tomorrow at 10, send me my emails, then create a task to check them)

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ STEP 1: PlannerNode Output                                          │
└─────────────────────────────────────────────────────────────────────┘

state.plannerOutput = {
  plan: [
    {
      id: 'A',
      capability: 'calendar',
      action: 'create_event',
      constraints: { summary: 'אירוע', start: '2025-01-04T10:00:00' },
      dependsOn: []
    },
    {
      id: 'B',
      capability: 'gmail',
      action: 'list_emails',
      constraints: {},
      dependsOn: []
    },
    {
      id: 'C',
      capability: 'database',
      action: 'create_task',
      constraints: { text: 'לבדוק אימיילים' },
      dependsOn: ['B']  ← Depends on B (emails must be fetched first)
    }
  ]
}

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 2: ResolverRouterNode.process()                                │
└─────────────────────────────────────────────────────────────────────┘

1. buildExecutionGroups(plan)
   ├─ Step A: dependsOn [] → Ready ✓
   ├─ Step B: dependsOn [] → Ready ✓
   ├─ Step C: dependsOn ['B'] → NOT ready
   ├─ Group 0: [Step A, Step B]  ← Parallel
   └─ Group 1: [Step C]  ← After B completes
   └─ Output: [
         { groupIndex: 0, steps: [A, B], parallelizable: true },
         { groupIndex: 1, steps: [C], parallelizable: false }
       ]

2. Execute Group 0 (Parallel)
   ├─ [Parallel] CalendarMutateResolver.resolve(Step A)  ← LLM Call 1
   └─ [Parallel] GmailResolver.resolve(Step B)  ← LLM Call 2

3. Execute Group 1 (After Group 0)
   └─ DatabaseTaskResolver.resolve(Step C)  ← LLM Call 3

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 3: ExecutorNode.process()                                      │
└─────────────────────────────────────────────────────────────────────┘
   └─ All 3 steps execute (A and B can be parallel, C can run after)

┌─────────────────────────────────────────────────────────────────────┐
│ STEP 4: JoinNode.process()                                          │
└─────────────────────────────────────────────────────────────────────┘
   └─ Merge all 3 results
```

### Timeline Visualization

```
Time →
│
├─ Group 0 (Parallel)
│  ├─ Step A: CalendarMutateResolver.resolve()  [LLM Call 1] ─┐
│  └─ Step B: GmailResolver.resolve()           [LLM Call 2] ─┤ Simultaneous
│                                                              │
│  ├─ Step A: CalendarServiceAdapter.execute()  [Service 1] ──┐
│  └─ Step B: GmailServiceAdapter.execute()     [Service 2] ─┤ Simultaneous
│
├─ Group 1 (Sequential, after Group 0)
│  └─ Step C: DatabaseTaskResolver.resolve()    [LLM Call 3]
│  └─ Step C: TaskServiceAdapter.execute()      [Service 3]
│
└─ JoinNode: Merge all results
```

---

## 6. Function Call Details

### 6.1 ResolverRouterNode Functions

#### `process(state: MemoState)`
```typescript
// Entry point
1. Read plan from state.plannerOutput.plan
2. If empty → return {}
3. buildExecutionGroups(plan)
4. For each group:
   - executeGroup(group, state)
5. Return { resolverResults: Map<stepId, ResolverResult> }
```

#### `buildExecutionGroups(plan: PlanStep[])`
```typescript
// Builds dependency DAG and groups steps
Algorithm:
1. Initialize: groups = [], completed = Set(), remaining = [...plan]
2. While remaining.length > 0:
   a. Find all steps where dependsOn.every(dep => completed.has(dep))
   b. If none found → circular dependency, execute one at a time
   c. Remove ready steps from remaining
   d. Add to completed
   e. Create group: { groupIndex, steps: ready, parallelizable: ready.length > 1 }
3. Return groups
```

#### `executeGroup(group: ExecutionGroup, state: MemoState)`
```typescript
// Executes a group of steps
If group.parallelizable:
  - Promise.allSettled(group.steps.map(step => routeAndExecute(step, state)))
Else:
  - Sequential: for (step of group.steps) await routeAndExecute(step, state)
```

#### `routeAndExecute(step: PlanStep, state: MemoState)`
```typescript
// Routes step to resolver and executes
1. findResolver(step.capability, step.action)
2. If not found:
   - Try fallback resolver for capability
   - If still not found → return error result
3. resolver.resolve(step, state)  ← LLM CALL HAPPENS HERE
4. Return RoutingResult { stepId, resolverName, result }
```

### 6.2 ExecutorNode Functions

#### `process(state: MemoState)`
```typescript
// Entry point
1. Read resolverResults from state
2. Filter: only type='execute'
3. For each result:
   - Find step from plan
   - executeStep(stepId, capability, args, userPhone) in parallel
4. Wait for all: Promise.all(executionPromises)
5. Return { executionResults: Map<stepId, ExecutionResult> }
```

#### `executeStep(stepId, capability, args, userPhone)`
```typescript
// Executes a single step using service adapter
Switch (capability):
  - 'calendar' → CalendarServiceAdapter.execute(args)
  - 'database' → TaskServiceAdapter or ListServiceAdapter.execute(args)
  - 'gmail' → GmailServiceAdapter.execute(args)
  - 'second-brain' → SecondBrainServiceAdapter.execute(args)
  - 'general'/'meta' → Return { success: true, data: args }
```

### 6.3 JoinNode Functions

#### `process(state: MemoState)`
```typescript
// Merges execution results
1. Read executionResults from state
2. Count successes and failures
3. Build summary:
   - totalSteps
   - successfulSteps
   - failedSteps
   - partialFailure: failCount > 0 && successCount > 0
4. If all failed → return error
5. Return { executionResults }
```

---

## 7. Error Handling Scenarios

### Scenario 7.1: Resolver Not Found

```
routeAndExecute(step, state)
  └─ findResolver('unknown', 'action')
     └─ Returns: undefined
  └─ Try fallback resolver
     └─ RESOLVER_REGISTRY.filter(r => r.capability === 'unknown')
        └─ Returns: []
  └─ Return error result:
     {
       stepId: step.id,
       resolverName: 'none',
       result: {
         type: 'execute',
         args: { error: 'No resolver found for unknown:action', _fallback: true }
       }
     }
```

### Scenario 7.2: LLM Call Fails in Resolver

```
CalendarMutateResolver.resolve(step, state)
  └─ callLLM(step, state)
     └─ LLMService.callLLM() throws error
  └─ Catch block:
     └─ console.error('[CalendarMutateResolver] LLM call failed')
     └─ Return: step.constraints (fallback)
  └─ Returns: ResolverResult { type: 'execute', args: constraints }
```

### Scenario 7.3: Service Call Fails in Executor

```
executeStep('A', 'calendar', args, userPhone)
  └─ CalendarServiceAdapter.execute(args)
     └─ getCalendarService().createEvent() throws error
  └─ Catch block:
     └─ console.error('[ExecutorNode] Error executing step A')
     └─ Return: {
          stepId: 'A',
          success: false,
          error: error.message,
          durationMs: ...
        }
```

### Scenario 7.4: Partial Failure in JoinNode

```
JoinNode.process(state)
  └─ executionResults:
     ├─ Step A: success=true
     └─ Step B: success=false
  └─ Summary:
     ├─ successfulSteps: 1
     ├─ failedSteps: 1
     └─ partialFailure: true
  └─ Log warning: '[JoinNode] Partial failure detected'
  └─ Continue with successful results (don't fail entire request)
```

### Scenario 7.5: Circular Dependency

```
buildExecutionGroups(plan)
  └─ Step A: dependsOn: ['B']
  └─ Step B: dependsOn: ['A']
  └─ Loop: No steps ready (both depend on each other)
  └─ Detection: ready.length === 0
  └─ Action: Execute one at a time (break circular dependency)
     └─ groups.push({ steps: [Step A], parallelizable: false })
     └─ completed.add('A')
     └─ Next iteration: Step B.dependsOn: ['A'] → A completed → Ready ✓
```

---

## 8. State Transitions

### State Flow Through Nodes

```
┌─────────────────────────────────────────────────────────────────────┐
│ State Before ResolverRouterNode                                     │
└─────────────────────────────────────────────────────────────────────┘

state = {
  plannerOutput: {
    plan: [Step A, Step B, ...]
  },
  resolverResults: Map {}  ← Empty
}

┌─────────────────────────────────────────────────────────────────────┐
│ State After ResolverRouterNode                                      │
└─────────────────────────────────────────────────────────────────────┘

state = {
  plannerOutput: { ... },
  resolverResults: Map {
    'A' => { stepId: 'A', type: 'execute', args: {...} },
    'B' => { stepId: 'B', type: 'execute', args: {...} }
  }
}

┌─────────────────────────────────────────────────────────────────────┐
│ State After ExecutorNode                                            │
└─────────────────────────────────────────────────────────────────────┘

state = {
  plannerOutput: { ... },
  resolverResults: Map { ... },  ← Still present
  executionResults: Map {  ← NEW
    'A' => { stepId: 'A', success: true, data: {...} },
    'B' => { stepId: 'B', success: true, data: {...} }
  }
}

┌─────────────────────────────────────────────────────────────────────┐
│ State After JoinNode                                                │
└─────────────────────────────────────────────────────────────────────┘

state = {
  plannerOutput: { ... },
  resolverResults: Map { ... },
  executionResults: Map { ... }  ← Validated and merged
}
```

---

## 9. Key Design Decisions

### 9.1 Why Parallel Execution in ResolverRouterNode?

**Answer**: Resolvers are stateless and only read from `state`. They can safely run in parallel if they have no dependencies.

### 9.2 Why Sequential Groups?

**Answer**: If Step B depends on Step A, B needs A's result. Dependencies are resolved at the group level.

### 9.3 Why Separate ExecutorNode?

**Answer**: 
- **Separation of concerns**: Resolvers convert intent → args, Executors execute args → results
- **Parallelization**: Executors can run in parallel even if resolvers were sequential
- **Error isolation**: Resolver errors don't prevent executor execution

### 9.4 Why JoinNode?

**Answer**:
- **Unified results**: Merge all execution results into single state
- **Failure detection**: Identify partial failures
- **Recovery decisions**: Decide if HITL is needed for recovery

---

## 10. Performance Characteristics

### Time Complexity

| Scenario | Resolver Time | Executor Time | Total |
|----------|---------------|---------------|-------|
| Single step | O(1) LLM call | O(1) service call | ~2-5s |
| 2 parallel steps | O(1) LLM calls (parallel) | O(1) service calls (parallel) | ~2-5s |
| 2 sequential steps | O(2) LLM calls (sequential) | O(1) service calls (parallel) | ~4-10s |
| 3 mixed (2+1) | O(2) + O(1) LLM calls | O(3) service calls (parallel) | ~4-8s |

### Parallelization Benefits

- **2 independent steps**: ~50% time reduction (parallel resolvers + parallel executors)
- **3 independent steps**: ~66% time reduction
- **Dependent steps**: No parallelization benefit (must wait for dependencies)

---

## Summary

The ResolverRouterNode → ExecutorNode → JoinNode pipeline provides:

1. **Intelligent routing**: Finds correct resolver for each step
2. **Dependency management**: Builds DAG and executes in correct order
3. **Parallelization**: Maximizes parallelism where safe
4. **Error resilience**: Handles failures gracefully
5. **Unified results**: Merges all execution results for response formatting

The architecture ensures that:
- **Resolvers use LLM** to convert semantic intent → concrete tool args
- **Executors use code** to execute tool calls via V1 services
- **JoinNode merges** all results for downstream processing


