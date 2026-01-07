# Memo V2 System Architecture Diagrams

> **Status**: System Architecture Documentation  
> **Last Updated**: January 2026  
> **Purpose**: Visual system diagrams for Memo V2 LangGraph architecture

---

## Table of Contents

1. [High-Level System Overview](#1-high-level-system-overview)
2. [LangGraph Flow Diagram](#2-langgraph-flow-diagram)
3. [Component Architecture](#3-component-architecture)
4. [Memory Architecture](#4-memory-architecture)
5. [Resolver & Executor Flow](#5-resolver--executor-flow)
6. [Data Flow Diagram](#6-data-flow-diagram)

---

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph "External Systems"
        WA[WhatsApp API]
        GC[Google Calendar API]
        GM[Gmail API]
        SB[Vector DB<br/>Second Brain]
        DB[(Supabase<br/>PostgreSQL)]
    end

    subgraph "V1 Services (Reused)"
        WH[Webhook Handler<br/>src/routes/webhook.ts]
        SCHED[Scheduler Service<br/>Cron Jobs]
        REM[Reminder Service<br/>Nudges & Digests]
        CAL_SVC[Calendar Service]
        TASK_SVC[Task Service]
        LIST_SVC[List Service]
        GMAIL_SVC[Gmail Service]
        SB_SVC[Second Brain Service]
    end

    subgraph "Memo V2 - LangGraph Core"
        LG[LangGraph<br/>State Machine]
        STATE[MemoState<br/>Persistent State]
        CHECK[Checkpointer<br/>MemorySaver/Supabase]
    end

    subgraph "V2 Nodes"
        CA[ContextAssembly<br/>Node]
        RC[ReplyContext<br/>Node]
        PL[Planner<br/>Node LLM]
        HITL[HITL Gate<br/>Node]
        RR[Resolver Router<br/>Node]
        JOIN[Join Node]
        RF[Response Formatter<br/>Node]
        RW[Response Writer<br/>Node LLM]
        MU[Memory Update<br/>Node]
    end

    subgraph "V2 Resolvers (LLM)"
        CR[Calendar Find<br/>Resolver]
        CMR[Calendar Mutate<br/>Resolver]
        DTR[Database Task<br/>Resolver]
        DLR[Database List<br/>Resolver]
        GR[Gmail<br/>Resolver]
        SBR[Second Brain<br/>Resolver]
        GENR[General<br/>Resolver]
        MR[Meta<br/>Resolver]
    end

    subgraph "V2 Executors (Code)"
        CE[Calendar<br/>Executor]
        DE[Database<br/>Executor]
        GE[Gmail<br/>Executor]
        SBE[Second Brain<br/>Executor]
    end

    WA -->|POST /webhook| WH
    WH -->|invoke| LG
    LG --> STATE
    STATE <--> CHECK

    LG --> CA
    CA --> RC
    RC --> PL
    PL --> HITL
    HITL -->|interrupt| CHECK
    HITL -->|continue| RR
    RR --> CR & CMR & DTR & DLR & GR & SBR & GENR & MR

    CR --> CE
    CMR --> CE
    DTR --> DE
    DLR --> DE
    GR --> GE
    SBR --> SBE

    CE --> CAL_SVC
    DE --> TASK_SVC & LIST_SVC
    GE --> GMAIL_SVC
    SBE --> SB_SVC

    CAL_SVC --> GC
    TASK_SVC --> DB
    LIST_SVC --> DB
    GMAIL_SVC --> GM
    SB_SVC --> SB

    CE & DE & GE & SBE --> JOIN
    JOIN --> RF
    RF --> RW
    RW --> MU
    MU --> STATE
    STATE --> LG
    LG -->|final_response| WH
    WH -->|sendMessage| WA

    SCHED --> REM
    REM -->|trigger| WH

    style LG fill:#e1f5ff
    style STATE fill:#fff4e1
    style CHECK fill:#ffe1f5
    style PL fill:#e1ffe1
    style RW fill:#e1ffe1
    style HITL fill:#ffe1e1
```

---

## 2. LangGraph Flow Diagram

```mermaid
flowchart TD
    START([User Message]) --> CA[ContextAssembly Node<br/>Code: Load user profile,<br/>timezone, memory]

    CA --> RC[ReplyContext Node<br/>Code: Handle reply-to,<br/>numbered lists, images]

    RC --> PL[Planner Node<br/>LLM: NL → Plan DSL]

    PL --> HITL{HITL Gate<br/>Code: Check confidence,<br/>risk, missing fields}

    HITL -->|confidence < 0.7<br/>OR missing_fields<br/>OR risk=high| INTERRUPT[interrupt<br/>Pause graph]
    HITL -->|OK| RR[Resolver Router<br/>Code: Build DAG,<br/>route to resolvers]

    INTERRUPT --> WAIT([Wait for User Reply])
    WAIT -->|Command resume| RR

    RR --> PARALLEL{Parallel Execution}

    PARALLEL --> CR[Calendar Find<br/>Resolver LLM]
    PARALLEL --> CMR[Calendar Mutate<br/>Resolver LLM]
    PARALLEL --> DTR[Database Task<br/>Resolver LLM]
    PARALLEL --> DLR[Database List<br/>Resolver LLM]
    PARALLEL --> GR[Gmail Resolver LLM]
    PARALLEL --> SBR[Second Brain<br/>Resolver LLM]

    CR --> CE[Calendar Executor<br/>Code: API calls]
    CMR --> CE
    DTR --> DE[Database Executor<br/>Code: DB operations]
    DLR --> DE
    GR --> GE[Gmail Executor<br/>Code: API calls]
    SBR --> SBE[Second Brain Executor<br/>Code: Vector DB]

    CE --> JOIN[Join Node<br/>Code: Merge results,<br/>detect failures]
    DE --> JOIN
    GE --> JOIN
    SBE --> JOIN

    JOIN --> RF[Response Formatter<br/>Code: ISO dates → human,<br/>categorization]

    RF --> RW[Response Writer<br/>LLM: Tone, phrasing,<br/>UX polish]

    RW --> MU[Memory Update<br/>Code: Update recent_messages,<br/>long-term summary]

    MU --> END([Send WhatsApp Response])

    style PL fill:#90EE90
    style RW fill:#90EE90
    style CR fill:#90EE90
    style CMR fill:#90EE90
    style DTR fill:#90EE90
    style DLR fill:#90EE90
    style GR fill:#90EE90
    style SBR fill:#90EE90
    style HITL fill:#FFB6C1
    style INTERRUPT fill:#FFB6C1
```

---

## 3. Component Architecture

```mermaid
graph LR
    subgraph "Entry Points"
        WEBHOOK[Webhook Handler<br/>V1 Reused]
        CRON[Cron Jobs<br/>V1 Reused]
    end

    subgraph "LangGraph Core"
        GRAPH[StateGraph<br/>MemoState]
        CHECKPOINT[Checkpointer<br/>MemorySaver/Supabase]
    end

    subgraph "Node Layer"
        CONTEXT[Context Nodes<br/>ContextAssembly<br/>ReplyContext]
        PLAN[Planning Nodes<br/>Planner LLM<br/>HITL Gate]
        RESOLVE[Resolver Nodes<br/>8 Resolvers LLM]
        EXECUTE[Executor Nodes<br/>4 Executors Code]
        RESPONSE[Response Nodes<br/>Formatter Code<br/>Writer LLM]
        MEMORY[Memory Node<br/>Memory Update Code]
    end

    subgraph "Service Layer (V1 Reused)"
        CAL[Calendar Service]
        TASK[Task Service]
        LIST[List Service]
        GMAIL[Gmail Service]
        SB[Second Brain Service]
        QUERY[Query Resolver]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL<br/>Supabase)]
        VDB[(Vector DB<br/>Second Brain)]
        GOOGLE[Google APIs<br/>Calendar & Gmail]
    end

    subgraph "LLM Services"
        LLM[LLM Service<br/>Config Manager]
        OPENAI[OpenAI API<br/>gpt-4o/gpt-4o-mini]
    end

    WEBHOOK --> GRAPH
    CRON --> GRAPH
    GRAPH <--> CHECKPOINT

    GRAPH --> CONTEXT
    CONTEXT --> PLAN
    PLAN --> RESOLVE
    RESOLVE --> EXECUTE
    EXECUTE --> RESPONSE
    RESPONSE --> MEMORY
    MEMORY --> GRAPH

    EXECUTE --> CAL & TASK & LIST & GMAIL & SB
    RESOLVE --> QUERY

    CAL --> GOOGLE
    TASK --> PG
    LIST --> PG
    GMAIL --> GOOGLE
    SB --> VDB

    PLAN --> LLM
    RESOLVE --> LLM
    RESPONSE --> LLM
    LLM --> OPENAI

    style GRAPH fill:#e1f5ff
    style CHECKPOINT fill:#ffe1f5
    style PLAN fill:#e1ffe1
    style RESOLVE fill:#e1ffe1
    style RESPONSE fill:#e1ffe1
```

---

## 4. Memory Architecture

```mermaid
graph TB
    subgraph "Memory Types"
        ST[Short-term<br/>LangGraph State<br/>Per-request]
        RM[Recent Messages<br/>10 messages<br/>500 tokens]
        DIS[Disambiguation<br/>5 minutes]
        IMG[Image Context<br/>3 user messages]
        RT[Recent Tasks<br/>Per-session]
        LT[Long-term<br/>Supabase Optional<br/>Persistent]
        SB[Second Brain<br/>Vector DB<br/>Persistent]
    end

    subgraph "Memory Lifecycle"
        START([Request Start]) --> LOAD[ContextAssembly Node<br/>Load from storage]
        LOAD --> ST
        LOAD --> RM
        LOAD --> LT
        LOAD --> SB

        ST --> EXEC[Graph Execution<br/>State mutations]
        RM --> EXEC
        DIS --> EXEC
        IMG --> EXEC
        RT --> EXEC

        EXEC --> UPDATE[Memory Update Node<br/>Update state]
        UPDATE --> ENFORCE[Enforce Limits<br/>10 messages<br/>500 tokens]
        ENFORCE --> SAVE[Save to State]
        SAVE --> END([Request End])

        END --> CLEANUP[Cleanup<br/>Every 12 hours<br/>Remove old conversations]
        CLEANUP --> DIS
        CLEANUP --> IMG
    end

    subgraph "Storage"
        LGS[LangGraph State<br/>Checkpointer]
        PG[(PostgreSQL<br/>conversation_memory)]
        VD[(Vector DB<br/>Embeddings)]
    end

    ST --> LGS
    RM --> LGS
    DIS --> LGS
    IMG --> LGS
    RT --> LGS
    LT --> PG
    SB --> VD

    style ST fill:#fff4e1
    style RM fill:#fff4e1
    style DIS fill:#fff4e1
    style IMG fill:#fff4e1
    style RT fill:#fff4e1
    style LT fill:#e1f5ff
    style SB fill:#e1f5ff
```

---

## 5. Resolver & Executor Flow

```mermaid
flowchart LR
    subgraph "Plan Step"
        PS[PlanStep<br/>capability: calendar<br/>action: update_event<br/>constraints: {...}]
    end

    subgraph "Resolver Layer (LLM)"
        RR[Resolver Router<br/>Routes to resolver]

        CR[Calendar Find<br/>Resolver]
        CMR[Calendar Mutate<br/>Resolver]
        DTR[Database Task<br/>Resolver]
        DLR[Database List<br/>Resolver]
        GR[Gmail Resolver]
        SBR[Second Brain<br/>Resolver]
        GENR[General Resolver]
        MR[Meta Resolver]
    end

    subgraph "Query Resolution"
        QR[Query Resolver<br/>Entity lookup<br/>Disambiguation]
    end

    subgraph "Resolver Result"
        RES{Resolver Result}
        EXEC_TYPE[type: execute<br/>args: {...}]
        CLARIFY_TYPE[type: clarify<br/>question: string<br/>options: array]
    end

    subgraph "Executor Layer (Code)"
        CE[Calendar Executor<br/>Calendar Service]
        DE[Database Executor<br/>Task/List Service]
        GE[Gmail Executor<br/>Gmail Service]
        SBE[Second Brain Executor<br/>Second Brain Service]
    end

    subgraph "Execution Result"
        ER[Execution Result<br/>success: boolean<br/>data: any<br/>error: string]
    end

    PS --> RR
    RR --> CR & CMR & DTR & DLR & GR & SBR & GENR & MR

    CMR -.->|if no eventId| QR
    DTR -.->|if no taskId| QR
    GR -.->|if no emailId| QR

    QR -->|candidates found| CLARIFY_TYPE
    QR -->|one match| EXEC_TYPE

    CR --> EXEC_TYPE
    CMR --> EXEC_TYPE
    DTR --> EXEC_TYPE
    DLR --> EXEC_TYPE
    GR --> EXEC_TYPE
    SBR --> EXEC_TYPE
    GENR --> EXEC_TYPE
    MR --> EXEC_TYPE

    EXEC_TYPE --> CE & DE & GE & SBE
    CLARIFY_TYPE --> HITL[HITL Gate<br/>interrupt]

    CE --> ER
    DE --> ER
    GE --> ER
    SBE --> ER

    style PS fill:#fff4e1
    style CR fill:#90EE90
    style CMR fill:#90EE90
    style DTR fill:#90EE90
    style DLR fill:#90EE90
    style GR fill:#90EE90
    style SBR fill:#90EE90
    style GENR fill:#90EE90
    style MR fill:#90EE90
    style CLARIFY_TYPE fill:#FFB6C1
    style HITL fill:#FFB6C1
```

---

## 6. Data Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant WhatsApp as WhatsApp API
    participant Webhook as Webhook Handler (V1)
    participant Graph as LangGraph
    participant State as MemoState
    participant Nodes as V2 Nodes
    participant Resolvers as Resolvers (LLM)
    participant Executors as Executors (Code)
    participant Services as V1 Services
    participant APIs as External APIs

    User->>WhatsApp: Send message
    WhatsApp->>Webhook: POST /webhook/whatsapp
    Webhook->>Webhook: Normalize, dedupe, typing indicator

    Webhook->>Graph: invoke(message, thread_id)
    Graph->>State: Initialize MemoState

    Graph->>Nodes: ContextAssembly Node
    Nodes->>State: Load user profile, timezone, memory
    State-->>Nodes: Populated state

    Graph->>Nodes: ReplyContext Node
    Nodes->>State: Handle reply-to, images
    State-->>Nodes: Enhanced message

    Graph->>Nodes: Planner Node (LLM)
    Nodes->>State: Read state
    State-->>Nodes: Context
    Nodes->>Nodes: LLM call: NL → Plan DSL
    Nodes->>State: planner_output
    State-->>Graph: Updated state

    Graph->>Nodes: HITL Gate Node
    Nodes->>State: Check confidence, risk
    State-->>Nodes: State
    alt Needs clarification
        Nodes->>Graph: interrupt()
        Graph->>Webhook: Return interrupt payload
        Webhook->>WhatsApp: Send clarification question
        WhatsApp->>User: Question
        User->>WhatsApp: Reply
        WhatsApp->>Webhook: POST /webhook/whatsapp
        Webhook->>Graph: invoke(Command({resume: reply}), thread_id)
        Graph->>State: Resume with user input
    end

    Graph->>Nodes: Resolver Router Node
    Nodes->>State: Build DAG, route to resolvers
    State-->>Nodes: Routes

    loop For each plan step
        Graph->>Resolvers: Resolver Node (LLM)
        Resolvers->>State: Read plan step
        State-->>Resolvers: Plan step
        Resolvers->>Resolvers: LLM call: PlanStep → Tool args
        Resolvers->>State: resolver_results
        State-->>Graph: Updated state

        Graph->>Executors: Executor Node (Code)
        Executors->>State: Read resolver result
        State-->>Executors: Tool args
        Executors->>Services: Call V1 service
        Services->>APIs: API calls
        APIs-->>Services: Data
        Services-->>Executors: Result
        Executors->>State: execution_results
        State-->>Graph: Updated state
    end

    Graph->>Nodes: Join Node
    Nodes->>State: Merge parallel results
    State-->>Nodes: Merged results

    Graph->>Nodes: Response Formatter Node
    Nodes->>State: Format dates, categorize
    State-->>Nodes: Formatted response
    Nodes->>State: formatted_response
    State-->>Graph: Updated state

    Graph->>Nodes: Response Writer Node (LLM)
    Nodes->>State: Read formatted response
    State-->>Nodes: Formatted data
    Nodes->>Nodes: LLM call: Generate user message
    Nodes->>State: final_response
    State-->>Graph: Updated state

    Graph->>Nodes: Memory Update Node
    Nodes->>State: Update recent_messages
    State-->>Graph: Final state

    Graph->>Webhook: Return final_response
    Webhook->>WhatsApp: Send message
    WhatsApp->>User: Response
```

---

## 7. HITL (Human-in-the-Loop) Flow

```mermaid
stateDiagram-v2
    [*] --> Planning: User message

    Planning --> HITLCheck: Plan generated

    HITLCheck --> NeedClarification: confidence < 0.7<br/>OR missing_fields<br/>OR risk = high
    HITLCheck --> ReadyToExecute: OK

    NeedClarification --> Interrupted: interrupt()
    Interrupted --> Waiting: Graph paused<br/>State saved

    Waiting --> UserReply: User responds
    UserReply --> Resumed: Command({resume: reply})
    Resumed --> HITLCheck: Updated state

    ReadyToExecute --> Resolving: Route to resolvers
    Resolving --> Executing: Tool args ready
    Executing --> Formatting: Execution complete
    Formatting --> Writing: Formatted
    Writing --> Responding: Message generated
    Responding --> [*]: Response sent

    note right of Interrupted
        LangGraph interrupt()
        - Pauses graph execution
        - Saves state to checkpointer
        - Returns to webhook handler
    end note

    note right of Waiting
        State persisted in:
        - MemorySaver (dev)
        - SupabaseCheckpointer (prod)
    end note
```

---

## 8. Cron & Scheduled Jobs Flow

```mermaid
graph TB
    subgraph "V1 Services (Unchanged)"
        SCHED[Scheduler Service<br/>Cron Jobs]
        REM[Reminder Service<br/>Nudges & Digests]
    end

    subgraph "Cron Triggers"
        MINUTE[Every 1 minute<br/>sendUpcomingReminders]
        HOUR[Every hour<br/>sendMorningDigest]
    end

    subgraph "Reminder Types"
        ONCE[One-time Reminders]
        RECUR[Recurring Reminders]
        NUDGE[Nudge Reminders<br/>Every X minutes]
        OVERDUE[Overdue Notifications]
        DIGEST[Morning Digest<br/>Daily summary]
    end

    subgraph "Optional V2 Enhancement"
        RW[Response Writer Node<br/>LLM polish]
    end

    subgraph "Output"
        TEMPLATE[Template Message<br/>V1 format]
        ENHANCED[Enhanced Message<br/>V2 LLM polish]
        WHATSAPP[WhatsApp API]
    end

    SCHED --> MINUTE
    SCHED --> HOUR

    MINUTE --> REM
    HOUR --> REM

    REM --> ONCE & RECUR & NUDGE & OVERDUE & DIGEST

    ONCE --> TEMPLATE
    RECUR --> TEMPLATE
    NUDGE --> TEMPLATE
    OVERDUE --> TEMPLATE
    DIGEST --> TEMPLATE

    TEMPLATE -.->|Optional| RW
    RW -.->|Optional| ENHANCED

    TEMPLATE --> WHATSAPP
    ENHANCED --> WHATSAPP

    style SCHED fill:#fff4e1
    style REM fill:#fff4e1
    style RW fill:#90EE90,stroke-dasharray: 5 5
    style ENHANCED fill:#90EE90,stroke-dasharray: 5 5
```

---

## Legend

### Node Types

- 🟢 **Green (LLM Nodes)**: Nodes that make LLM calls (Planner, Resolvers, Response Writer)
- 🔵 **Blue (Code Nodes)**: Nodes that execute code logic (Context, HITL, Executors, Formatters)
- 🟡 **Yellow (State/Storage)**: State management and storage layers
- 🔴 **Red (Control Flow)**: HITL interrupts and control logic
- ⚪ **White (V1 Services)**: Services reused from V1 without modification

### Data Flow

- **Solid arrows**: Direct data flow
- **Dashed arrows**: Optional or conditional flow
- **Bidirectional arrows**: Read/write access

### Notes

- All V1 services are reused without modification
- LangGraph provides state management and pause/resume via checkpointer
- LLM calls are centralized through LLM Service configuration manager
- HITL uses LangGraph's native `interrupt()` mechanism

---

_For detailed specifications, see [BLUEPRINT.md](./BLUEPRINT.md)_
