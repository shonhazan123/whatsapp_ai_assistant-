# Memo V2 — System Diagram (Current Runtime)

This document is the **current** system diagram for Memo_v2 as implemented today.

If any diagram here contradicts code, **code wins**. Update this file.

## Canonical implementation references

- Graph + routers + interrupt timeout: `Memo_v2/src/graph/index.ts`
- Runtime state contract: `Memo_v2/src/graph/state/MemoState.ts`
- Cross-node types: `Memo_v2/src/types/index.ts`
- Canonical HITL types: `Memo_v2/src/types/hitl.ts`

## 1) End-to-end flow (user message → response)

```mermaid
flowchart TD
    userMessage[UserMessage] --> webhook[Webhook_V1]
    webhook --> invoke[invokeMemoGraph]

    invoke --> contextAssembly[ContextAssemblyNode]
    contextAssembly --> replyContext[ReplyContextNode]
    replyContext --> planner[PlannerNode_LLM]
    planner --> capabilityCheck[CapabilityCheckNode]

    capabilityCheck -->|blocked_finalResponse| responseWriter[ResponseWriterNode_LLM]
    capabilityCheck -->|ok| hitlGate[HITLGateNode_controlPlane]

    hitlGate -->|no_pendingHITL| resolverRouter[ResolverRouterNode]

    resolverRouter --> entityResolution[EntityResolutionNode]

    entityResolution -->|needs_disambiguation| hitlGate
    entityResolution -->|resolved_or_notFound| executor[ExecutorNode]

    executor --> joinNode[JoinNode]
    joinNode --> responseFormatter[ResponseFormatterNode]
    responseFormatter --> responseWriter
    responseWriter --> memoryUpdate[MemoryUpdateNode]
    memoryUpdate --> webhook
```

## 2) HITL control-plane (pendingHITL contract)

`HITLGateNode` is the single HITL control-plane. It manages one `pendingHITL` at a time and routes via `Command({ update, goto })`.

```mermaid
flowchart TD
  user[UserMessage] --> invoke[invokeMemoGraph]
  invoke --> planner[PlannerNode]
  planner --> hitlGate[HITLGateNode_controlPlane]

  hitlGate -->|no_pendingHITL| resolverRouter[ResolverRouterNode]
  resolverRouter --> entityRes[EntityResolutionNode]

  entityRes -->|machine_disambiguation| hitlGate

  hitlGate -->|interrupt_pendingHITL| webhook[Webhook_returns_question]
  webhook --> user

  user -->|reply| invoke
  hitlGate -->|resume_validate_storeResult| cmd["Command(update+goto)"]
  cmd -->|goto_planner_replan| planner
  cmd -->|goto_continue| resolverRouter
  cmd -->|goto_apply_selection| entityRes
```

## 3) HITL interrupt/resume sequence

```mermaid
sequenceDiagram
    participant User
    participant Webhook as Webhook_V1
    participant Graph as LangGraph
    participant HITL as HITLGateNode

    User->>Webhook: Message
    Webhook->>Graph: invokeMemoGraph(thread_id=userPhone)
    Graph->>HITL: creates pendingHITL + interrupt(payload)
    HITL-->>Graph: pause_state_persisted
    Graph-->>Webhook: __interrupt__ payload
    Webhook-->>User: send question/options

    User->>Webhook: Reply
    Webhook->>Graph: invokeMemoGraph(Command({resume: reply}))
    Graph->>HITL: interrupt() returns reply
    HITL->>HITL: validate reply vs expectedInput
    HITL-->>Graph: Command({update: hitlResults + clear pendingHITL, goto: returnTo.node})
```

## 4) Resolver → entity resolution → execution

Key contracts:
- Resolvers return semantic args in `state.resolverResults`.
- Entity resolution produces ID-resolved args in `state.executorArgs` (preferred by executor).
- Disambiguation state is **machine-only** (candidates + metadata, no user-facing text).
- Only true disambiguation routes to HITL; not_found continues to response with explanation.
- Executor enforces **idempotency** via `executedOperations[traceId:stepId]` ledger.

```mermaid
flowchart LR
    plan[PlanStep] --> resolver[ResolverRouterNode_runs_resolvers]
    resolver --> resolverResults[state.resolverResults]

    resolverResults --> entityRes[EntityResolutionNode]
    entityRes -->|resolved| executorArgs[state.executorArgs]
    entityRes -->|disambiguation_machine_only| hitl[HITLGateNode_interrupt]
    entityRes -->|not_found| executionResultsFailed[state.executionResults_failed_step]

    executorArgs --> executor[ExecutorNode_adapters]
    executor -->|idempotency_check| ledger[state.executedOperations]
    executionResultsFailed --> responseFormatter[ResponseFormatterNode]
    executor --> responseFormatter
```

## 5) External systems and service adapters

- **Calendar/Gmail** require hydrated `authContext` (tokens) provided by `ContextAssemblyNode`.
- **Database/SecondBrain** use userPhone-based adapters.

```mermaid
flowchart TB
    subgraph externalSystems[ExternalSystems]
        whatsappAPI[WhatsAppAPI]
        googleCalendarAPI[GoogleCalendarAPI]
        gmailAPI[GmailAPI]
        postgres[(Postgres_Supabase)]
        vectorDb[(VectorDB)]
    end

    subgraph memoV2[MemoV2]
        executor[ExecutorNode]
        calendarAdapter[CalendarServiceAdapter]
        gmailAdapter[GmailServiceAdapter]
        taskAdapter[TaskServiceAdapter]
        listAdapter[ListServiceAdapter]
        secondBrainAdapter[SecondBrainServiceAdapter]
    end

    executor --> calendarAdapter --> googleCalendarAPI
    executor --> gmailAdapter --> gmailAPI
    executor --> taskAdapter --> postgres
    executor --> listAdapter --> postgres
    executor --> secondBrainAdapter --> vectorDb
    whatsappAPI --> memoV2
```
