# Memo V2 — System Diagram (Current Runtime)

This document is the **current** system diagram for Memo_v2 as implemented today.

If any diagram here contradicts code, **code wins**. Update this file.

## Canonical implementation references

- Graph + routers + interrupt timeout: `Memo_v2/src/graph/index.ts`
- Runtime state contract: `Memo_v2/src/graph/state/MemoState.ts`
- Cross-node types: `Memo_v2/src/types/index.ts`

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
    capabilityCheck -->|ok| hitlGate[HITLGateNode_interrupt]

    hitlGate -->|resume_intent_unclear| planner
    hitlGate -->|continue| resolverRouter[ResolverRouterNode]

    resolverRouter --> entityResolution[EntityResolutionNode]

    entityResolution -->|needs_disambiguation| hitlGate
    entityResolution -->|resolved_or_notFound| executor[ExecutorNode]

    executor --> joinNode[JoinNode]
    joinNode --> responseFormatter[ResponseFormatterNode]
    responseFormatter --> responseWriter
    responseWriter --> memoryUpdate[MemoryUpdateNode]
    memoryUpdate --> webhook
```

## 2) HITL interrupt/resume model (LangGraph)

**Two HITL families** exist in the current runtime:

- **Planner HITL** (clarification/confirmation/approval/intent_unclear): handled inside `HITLGateNode`, writes `plannerHITLResponse` on resume.
- **Entity-resolution HITL** (disambiguation selection): requested by `EntityResolutionNode` (`needsHITL + disambiguation + hitlReason='disambiguation'`) and surfaced via `HITLGateNode`.

```mermaid
sequenceDiagram
    participant User
    participant Webhook as Webhook_V1
    participant Graph as LangGraph
    participant HITL as HITLGateNode

    User->>Webhook: Message
    Webhook->>Graph: invokeMemoGraph(thread_id=userPhone)
    Graph->>HITL: interrupt(payload)
    HITL-->>Graph: pause_state_persisted
    Graph-->>Webhook: __interrupt__ payload
    Webhook-->>User: send question/options

    User->>Webhook: Reply
    Webhook->>Graph: invokeMemoGraph(Command({resume: reply}))
    Graph->>HITL: interrupt() returns reply
    HITL-->>Graph: writes plannerHITLResponse OR disambiguation.userSelection
```

## 3) Resolver → entity resolution → execution (current contracts)

Key contracts:
- Resolvers return semantic args in `state.resolverResults`.
- Entity resolution produces ID-resolved args in `state.executorArgs` (preferred by executor).
- Only true disambiguation interrupts execution; not_found continues to response with a friendly explanation.

```mermaid
flowchart LR
    plan[PlanStep] --> resolver[ResolverRouterNode_runs_resolvers]
    resolver --> resolverResults[state.resolverResults]

    resolverResults --> entityRes[EntityResolutionNode]
    entityRes -->|resolved| executorArgs[state.executorArgs]
    entityRes -->|disambiguation| hitl[HITLGateNode_interrupt]
    entityRes -->|not_found| executionResultsFailed[state.executionResults_failed_step]

    executorArgs --> executor[ExecutorNode_adapters]
    executionResultsFailed --> responseFormatter[ResponseFormatterNode]
    executor --> responseFormatter
```

## 4) External systems and service adapters (current)

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

