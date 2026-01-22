# Focus WhatsApp Assistant V1 - System Architecture Diagrams

> **Status**: System Architecture Documentation  
> **Last Updated**: January 2026  
> **Purpose**: Visual system diagrams for Focus WhatsApp Assistant V1 architecture

---

## Table of Contents

1. [High-Level System Overview](#1-high-level-system-overview)
2. [Message Processing Flow](#2-message-processing-flow)
3. [Component Architecture](#3-component-architecture)
4. [Agent & Orchestration Flow](#4-agent--orchestration-flow)
5. [BaseAgent Execution Flow](#5-baseagent-execution-flow)
6. [Data Flow Diagram](#6-data-flow-diagram)
7. [Memory & Context Management](#7-memory--context-management)
8. [Cron & Scheduled Jobs](#8-cron--scheduled-jobs)

---

## 1. High-Level System Overview

```mermaid
graph TB
    subgraph "External Systems"
        WA[WhatsApp Cloud API]
        GC[Google Calendar API]
        GM[Gmail API]
        PG[(PostgreSQL<br/>Supabase)]
        VDB[(Vector DB<br/>Second Brain)]
        OPENAI[OpenAI API<br/>GPT-4o/Whisper]
    end

    subgraph "Entry Layer"
        WEBHOOK[Webhook Handler<br/>routes/webhook.ts]
        AUTH[OAuth Handler<br/>routes/auth.ts]
    end

    subgraph "Main Processing"
        INDEX_V2[index-v2.ts<br/>processMessageV2]
        MAIN_AGENT[MainAgent<br/>Entry & Routing]
        COORD[MultiAgentCoordinator<br/>Planning & Execution]
    end

    subgraph "Agents Layer"
        CAL_AGENT[CalendarAgent]
        DB_AGENT[DatabaseAgent]
        GMAIL_AGENT[GmailAgent]
        SB_AGENT[SecondBrainAgent]
        BASE_AGENT[BaseAgent<br/>executeWithAI]
    end

    subgraph "Function Handlers"
        CAL_FUNC[CalendarFunctions<br/>calendarOperations]
        DB_FUNC[DatabaseFunctions<br/>taskOperations<br/>listOperations]
        GMAIL_FUNC[GmailFunctions<br/>gmailOperations]
        SB_FUNC[SecondBrainFunction<br/>memoryOperations]
    end

    subgraph "Services Layer"
        CAL_SVC[CalendarService]
        TASK_SVC[TaskService]
        LIST_SVC[ListService]
        GMAIL_SVC[GmailService]
        SB_SVC[SecondBrainService]
        USER_SVC[UserService]
        OPENAI_SVC[OpenAIService<br/>LLM Gateway]
    end

    subgraph "Infrastructure"
        RESP_FORMAT[ResponseFormatter]
        CONV_WIN[ConversationWindow<br/>Short-term Memory]
        QUERY_RES[QueryResolver<br/>Fuzzy Lookup]
        PERF_TRACK[PerformanceTracker]
        REQ_CTX[RequestContext<br/>Per-request Context]
    end

    subgraph "Scheduled Jobs"
        SCHED[SchedulerService<br/>Cron Jobs]
        REMINDER[ReminderService<br/>Nudges & Digests]
    end

    WA -->|POST /webhook| WEBHOOK
    WEBHOOK -->|processMessageV2| INDEX_V2
    INDEX_V2 --> MAIN_AGENT
    MAIN_AGENT --> COORD
    COORD --> CAL_AGENT & DB_AGENT & GMAIL_AGENT & SB_AGENT

    CAL_AGENT --> BASE_AGENT
    DB_AGENT --> BASE_AGENT
    GMAIL_AGENT --> BASE_AGENT
    SB_AGENT --> BASE_AGENT

    BASE_AGENT --> OPENAI_SVC
    BASE_AGENT --> CAL_FUNC & DB_FUNC & GMAIL_FUNC & SB_FUNC
    BASE_AGENT --> RESP_FORMAT

    CAL_FUNC --> CAL_SVC & QUERY_RES
    DB_FUNC --> TASK_SVC & LIST_SVC & QUERY_RES
    GMAIL_FUNC --> GMAIL_SVC & QUERY_RES
    SB_FUNC --> SB_SVC

    CAL_SVC --> GC
    GMAIL_SVC --> GM
    TASK_SVC --> PG
    LIST_SVC --> PG
    SB_SVC --> VDB
    USER_SVC --> PG
    OPENAI_SVC --> OPENAI

    MAIN_AGENT --> CONV_WIN
    BASE_AGENT --> CONV_WIN
    COORD --> PERF_TRACK
    BASE_AGENT --> PERF_TRACK
    BASE_AGENT --> REQ_CTX

    SCHED --> REMINDER
    REMINDER --> WA

    WEBHOOK --> AUTH
    AUTH --> GC & GM

    style MAIN_AGENT fill:#e1f5ff
    style COORD fill:#fff4e1
    style BASE_AGENT fill:#e1ffe1
    style OPENAI_SVC fill:#ffe1f5
    style CONV_WIN fill:#fff4e1
    style QUERY_RES fill:#fff4e1
```

---

## 2. Message Processing Flow

```mermaid
flowchart TD
    START([WhatsApp Message<br/>Text/Audio/Image]) --> WEBHOOK[Webhook Handler<br/>handleIncomingMessage]

    WEBHOOK --> NORM[Normalize Phone Number<br/>Duplicate Check<br/>Typing Indicator]

    NORM --> MSG_TYPE{Message Type?}

    MSG_TYPE -->|text| TEXT[Use Message Text]
    MSG_TYPE -->|audio| AUDIO[Transcribe Audio<br/>Whisper API]
    MSG_TYPE -->|image| IMAGE[Analyze Image<br/>GPT-4o Vision<br/>Store Context]

    AUDIO --> TEXT
    IMAGE --> ONBOARD
    TEXT --> ONBOARD[Onboarding Check<br/>UserOnboardingHandler]

    ONBOARD -->|Skip| END1([Return Early])
    ONBOARD -->|Continue| PROCESS[processMessageV2<br/>index-v2.ts]

    PROCESS --> MAIN[MainAgent<br/>processRequest]

    MAIN --> REPLY_CTX[Handle Reply Context<br/>Numbered Lists<br/>Image Context]

    REPLY_CTX --> CONV_CTX[Get Conversation Context<br/>ConversationWindow]

    CONV_CTX --> COORD[MultiAgentCoordinator<br/>handleRequest]

    COORD --> INTENT[Intent Detection<br/>OpenAIService.detectIntent<br/>Single LLM Call]

    INTENT --> ROUTE{Routing Decision}

    ROUTE -->|requiresPlan=false<br/>single agent| DIRECT[Direct Route<br/>executeSingleAgent]
    ROUTE -->|requiresPlan=true<br/>OR multi-agent| PLAN[Planning Step<br/>MultiAgentPlanner<br/>LLM Call]

    PLAN --> FILTER[Filter Plan<br/>Capability Check<br/>Google Connection]

    FILTER --> EXEC[Execute Plan<br/>Sequential Execution<br/>Honor Dependencies]

    DIRECT --> AGENT[Target Agent<br/>processRequest]
    EXEC --> AGENT

    AGENT --> BASE[BaseAgent.executeWithAI<br/>LLM + Function Calls]

    BASE --> FUNC[Function Handler<br/>*Functions.ts]

    FUNC --> SVC[Service Layer<br/>*Service.ts]

    SVC --> EXT{External System}
    EXT -->|Calendar| GC[Google Calendar API]
    EXT -->|Gmail| GM[Gmail API]
    EXT -->|Database| PG[(PostgreSQL)]
    EXT -->|Memory| VDB[(Vector DB)]

    SVC --> RESULT[Execution Result]

    RESULT --> FORMAT[ResponseFormatter<br/>Format Response<br/>Optional LLM Polish]

    FORMAT --> MEM_UPDATE[Update ConversationWindow<br/>Add Messages]

    MEM_UPDATE --> WEBHOOK_RESP[Return Response]
    WEBHOOK_RESP --> SEND[sendWhatsAppMessage]
    SEND --> END([Send to WhatsApp])

    style MAIN fill:#e1f5ff
    style COORD fill:#fff4e1
    style BASE fill:#e1ffe1
    style INTENT fill:#90EE90
    style PLAN fill:#90EE90
    style FORMAT fill:#e1ffe1
```

---

## 3. Component Architecture

```mermaid
graph LR
    subgraph "Entry Points"
        WEBHOOK[Webhook Handler<br/>routes/webhook.ts]
        AUTH[OAuth Handler<br/>routes/auth.ts]
        INDEX[HTTP Server<br/>index.ts]
    end

    subgraph "Processing Layer"
        INDEX_V2[index-v2.ts<br/>processMessageV2]
        MAIN[MainAgent<br/>Routing & Context]
    end

    subgraph "Orchestration Layer"
        COORD[MultiAgentCoordinator<br/>Planning & Execution]
        INTENT[Intent Detection<br/>OpenAIService]
        PLAN[Planner<br/>MultiAgentPlanner]
    end

    subgraph "Agent Layer"
        CAL[CalendarAgent]
        DB[DatabaseAgent]
        GMAIL[GmailAgent]
        SB[SecondBrainAgent]
        BASE[BaseAgent<br/>executeWithAI]
    end

    subgraph "Function Layer"
        CAL_F[CalendarFunctions]
        DB_F[DatabaseFunctions]
        GMAIL_F[GmailFunctions]
        SB_F[SecondBrainFunction]
    end

    subgraph "Service Layer"
        CAL_S[CalendarService]
        TASK_S[TaskService]
        LIST_S[ListService]
        GMAIL_S[GmailService]
        SB_S[SecondBrainService]
        USER_S[UserService]
        OPENAI_S[OpenAIService]
    end

    subgraph "Infrastructure Services"
        RESP[ResponseFormatter]
        CONV[ConversationWindow]
        QUERY[QueryResolver]
        PERF[PerformanceTracker]
        CTX[RequestContext]
        CACHE[PromptCacheService]
    end

    subgraph "Data & External"
        PG[(PostgreSQL)]
        VDB[(Vector DB)]
        GC[Google APIs]
        OPENAI_API[OpenAI API]
    end

    subgraph "Scheduled Jobs"
        SCHED[SchedulerService]
        REM[ReminderService]
    end

    INDEX --> WEBHOOK & AUTH
    WEBHOOK --> INDEX_V2
    INDEX_V2 --> MAIN
    MAIN --> COORD
    COORD --> INTENT & PLAN
    COORD --> CAL & DB & GMAIL & SB

    CAL & DB & GMAIL & SB --> BASE
    BASE --> OPENAI_S & CAL_F & DB_F & GMAIL_F & SB_F & RESP

    CAL_F --> CAL_S & QUERY
    DB_F --> TASK_S & LIST_S & QUERY
    GMAIL_F --> GMAIL_S & QUERY
    SB_F --> SB_S

    CAL_S --> GC
    GMAIL_S --> GC
    TASK_S --> PG
    LIST_S --> PG
    SB_S --> VDB
    USER_S --> PG
    OPENAI_S --> OPENAI_API & CACHE

    BASE --> CONV & PERF & CTX
    MAIN --> CONV

    INDEX --> SCHED
    SCHED --> REM

    style MAIN fill:#e1f5ff
    style COORD fill:#fff4e1
    style BASE fill:#e1ffe1
    style OPENAI_S fill:#ffe1f5
    style CONV fill:#fff4e1
```

---

## 4. Agent & Orchestration Flow

```mermaid
flowchart TD
    USER_MSG[User Message] --> MAIN[MainAgent.processRequest]

    MAIN --> REPLY[Handle Reply Context<br/>Numbered Lists<br/>Image Context]

    REPLY --> CONV[Get Conversation Context<br/>ConversationWindow.getContext]

    CONV --> COORD[MultiAgentCoordinator<br/>handleRequest]

    COORD --> INTENT[Intent Detection<br/>OpenAIService.detectIntent<br/>Single LLM Call]

    INTENT --> INTENT_RES{Intent Result}

    INTENT_RES -->|primaryIntent=general| GEN[Generate General Response<br/>MainAgent Prompt]
    INTENT_RES -->|involvedAgents=[]| GEN
    INTENT_RES -->|Valid Intent| RESOLVE[Resolve Involved Agents]

    RESOLVE --> ROUTE{Route Decision<br/>requiresPlan?<br/>agentCount?}

    ROUTE -->|requiresPlan=false<br/>AND single agent| DIRECT[Direct Route<br/>executeSingleAgent]
    ROUTE -->|requiresPlan=true<br/>OR multi-agent| PLAN_STEP[Planning Step<br/>MultiAgentPlanner Prompt<br/>LLM Call]

    PLAN_STEP --> PLAN_RES[Plan Array<br/>PlannedAction[]]

    PLAN_RES -->|empty plan| FALLBACK{agentCount = 1?}
    FALLBACK -->|yes| DIRECT
    FALLBACK -->|no| NO_ACTION[No Action Response]

    PLAN_RES -->|valid plan| FILTER[Filter Plan<br/>Capability Check<br/>Google Connection]

    FILTER -->|no allowed actions| DENIED[Capability Denied Message]
    FILTER -->|allowed actions| EXEC[Execute Plan<br/>Sequential Execution]

    DIRECT --> AGENT_EXEC[Agent Execution<br/>agent.processRequest]
    EXEC --> AGENT_EXEC

    AGENT_EXEC --> BASE[BaseAgent.executeWithAI]

    BASE --> RESULT[Execution Result]

    EXEC --> COLLECT[Collect Results<br/>ExecutionResult[]]
    COLLECT --> SUMMARY{Multi-agent?}

    SUMMARY -->|single agent| COMBINE[Combine Responses]
    SUMMARY -->|multi-agent| SUMMARY_LLM[Generate Summary<br/>Multi-agent Summary Prompt<br/>LLM Call]

    COMBINE --> RETURN[Return Response]
    SUMMARY_LLM --> RETURN
    GEN --> RETURN
    NO_ACTION --> RETURN
    DENIED --> RETURN

    RETURN --> MAIN_RET[MainAgent Returns]

    style MAIN fill:#e1f5ff
    style COORD fill:#fff4e1
    style INTENT fill:#90EE90
    style PLAN_STEP fill:#90EE90
    style SUMMARY_LLM fill:#90EE90
    style BASE fill:#e1ffe1
```

---

## 5. BaseAgent Execution Flow

```mermaid
sequenceDiagram
    participant Agent as Domain Agent<br/>Calendar/Database/etc
    participant Base as BaseAgent
    participant OpenAI as OpenAIService
    participant Func as Function Handler<br/>*Functions.ts
    participant Svc as Service Layer<br/>*Service.ts
    participant API as External API/DB
    participant Format as ResponseFormatter
    participant Conv as ConversationWindow

    Agent->>Base: executeWithAI(message, systemPrompt, functions)
    Base->>Base: Prepend Time Context<br/>prependTimeContext()

    Base->>OpenAI: createCompletion(messages, functions)
    Note over OpenAI: System prompt (cached)<br/>Context messages<br/>User message with time

    OpenAI-->>Base: LLM Response<br/>function_call OR tool_calls

    alt Function/Tool Call
        Base->>Base: Extract functionName, functionArgs
        Base->>Func: executeFunction(functionName, args, userId)
        Func->>Svc: Call service method
        Svc->>API: API/DB call
        API-->>Svc: Data/Result
        Svc-->>Func: Service Result
        Func-->>Base: FunctionResult<br/>{success, data, message}

        Base->>Base: Build assistant message<br/>with function_call/tool_calls
        Base->>Base: Build function result message<br/>role: function/tool

        Base->>Format: formatResponse(systemPrompt, messages)
        Note over Format: Optional LLM polish<br/>using cheap model
        Format-->>Base: Formatted Response
    else Direct Response
        OpenAI-->>Base: Direct text response
        Base->>Format: formatResponse(...)
        Format-->>Base: Formatted Response
    end

    Base->>Base: filterAgentResponse(response)<br/>Remove JSON/tool noise

    Base->>Conv: addMessage(userPhone, 'assistant', response)

    Base-->>Agent: Final Response String

    Note over Base: Performance tracking<br/>Token usage logged<br/>via PerformanceTracker
```

---

## 6. Data Flow Diagram

```mermaid
sequenceDiagram
    participant User
    participant WA as WhatsApp API
    participant Webhook as Webhook Handler
    participant Main as MainAgent
    participant Coord as MultiAgentCoordinator
    participant Agent as Domain Agent
    participant Base as BaseAgent
    participant OpenAI as OpenAIService
    participant Func as Function Handler
    participant Svc as Service
    participant Ext as External API/DB
    participant Format as ResponseFormatter
    participant Conv as ConversationWindow

    User->>WA: Send message
    WA->>Webhook: POST /webhook/whatsapp

    Webhook->>Webhook: Normalize, dedupe, typing indicator

    alt Audio Message
        Webhook->>Webhook: transcribeAudio()<br/>Whisper API
    else Image Message
        Webhook->>Webhook: analyzeImage()<br/>GPT-4o Vision<br/>Store in ConversationWindow
    end

    Webhook->>Webhook: Onboarding check
    Webhook->>Main: processMessageV2(message)

    Main->>Main: Handle reply context<br/>Numbered lists, images
    Main->>Conv: getContext(userPhone)
    Conv-->>Main: Recent messages

    Main->>Coord: handleRequest(message, context)

    Coord->>OpenAI: detectIntent(message, context)
    OpenAI-->>Coord: IntentDecision<br/>{primaryIntent, requiresPlan, involvedAgents}

    alt Direct Route
        Coord->>Agent: executeSingleAgent(agent, message)
    else Planning Route
        Coord->>OpenAI: planActions(message, context)<br/>MultiAgentPlanner prompt
        OpenAI-->>Coord: Plan[]<br/>PlannedAction[]
        Coord->>Coord: Filter plan (capabilities)
        Coord->>Coord: executePlan(plan)
        loop For each action
            Coord->>Agent: agent.processRequest(payload)
        end
        Coord->>OpenAI: Generate summary (if multi-agent)
        OpenAI-->>Coord: Summary response
    end

    Agent->>Base: executeWithAI(message, prompt, functions)

    Base->>Base: Prepend time context
    Base->>OpenAI: createCompletion(messages, functions)
    OpenAI-->>Base: LLM response<br/>(function_call or text)

    alt Function Call
        Base->>Func: executeFunction(name, args, userId)
        Func->>Svc: Service method call
        Svc->>Ext: API/DB operation
        Ext-->>Svc: Data/Result
        Svc-->>Func: Service result
        Func-->>Base: FunctionResult

        Base->>Base: Build messages with function result
        Base->>Format: formatResponse(...)
    else Direct Response
        Base->>Format: formatResponse(...)
    end

    Format-->>Base: Formatted response
    Base->>Base: filterAgentResponse()
    Base-->>Agent: Final response

    Agent-->>Coord: Response string
    Coord-->>Main: Response string

    Main->>Conv: addMessage(userPhone, 'user', message)
    Main->>Conv: addMessage(userPhone, 'assistant', response)

    Main-->>Webhook: Response string
    Webhook->>WA: sendWhatsAppMessage(response)
    WA->>User: Response message
```

---

## 7. Memory & Context Management

```mermaid
graph TB
    subgraph "Memory Types"
        CONV_WIN[ConversationWindow<br/>Short-term Memory<br/>In-memory]
        DB_MEM[conversation_memory table<br/>Long-term Memory<br/>Optional]
        SECOND_BRAIN[SecondBrainService<br/>Vector DB<br/>Persistent]
    end

    subgraph "ConversationWindow Structure"
        MESSAGES[Recent Messages<br/>Max 10 messages<br/>Max 500 tokens]
        DISAMB[Disambiguation Context<br/>5 minutes TTL]
        IMAGE_CTX[Image Context<br/>Last 3 user messages]
        TASK_CTX[Recent Task Snapshots<br/>Per session]
    end

    subgraph "Usage Points"
        MAIN[MainAgent<br/>Reply context<br/>Get context]
        BASE[BaseAgent<br/>Add messages]
        REMINDER[ReminderService<br/>Store reminder metadata]
        WEBHOOK[Webhook Handler<br/>Image context storage]
    end

    subgraph "Operations"
        ADD[addMessage<br/>role, content, metadata]
        GET[getContext<br/>Returns recent messages]
        REPLY[getRepliedToMessage<br/>By WhatsApp message ID]
        PUSH[pushRecentTasks<br/>Store task snapshots]
        CLEAR[clearDisambiguation<br/>After resolution]
    end

    MAIN --> ADD
    MAIN --> GET
    MAIN --> REPLY
    BASE --> ADD
    REMINDER --> ADD
    WEBHOOK --> ADD

    ADD --> MESSAGES
    ADD --> DISAMB
    ADD --> IMAGE_CTX
    PUSH --> TASK_CTX

    GET --> MESSAGES
    REPLY --> MESSAGES

    MESSAGES --> CONV_WIN
    DISAMB --> CONV_WIN
    IMAGE_CTX --> CONV_WIN
    TASK_CTX --> CONV_WIN

    CONV_WIN -.->|Optional| DB_MEM
    CONV_WIN -.->|Store/Search| SECOND_BRAIN

    style CONV_WIN fill:#fff4e1
    style DB_MEM fill:#e1f5ff
    style SECOND_BRAIN fill:#e1f5ff
```

---

## 8. Cron & Scheduled Jobs

```mermaid
graph TB
    subgraph "Scheduler"
        INDEX[index.ts<br/>Server Startup]
        SCHED[SchedulerService<br/>start]
    end

    subgraph "Cron Jobs"
        MINUTE[Every 1 minute<br/>sendUpcomingReminders]
        HOUR[Every hour<br/>sendMorningDigest<br/>Timezone-aware]
    end

    subgraph "ReminderService"
        REM[ReminderService]
        ONE_TIME[One-time Reminders<br/>Due soon]
        RECUR[Recurring Reminders<br/>Due soon]
        NUDGE[Nudge Reminders<br/>Every X minutes]
        OVERDUE[Overdue Notifications]
        DIGEST[Morning Digest<br/>Daily summary]
    end

    subgraph "Reminder Processing"
        QUERY[Query Tasks<br/>Filter by date/time]
        GROUP[Group by User<br/>Group by Time Window]
        FORMAT[Format Message<br/>Template-based]
        ENHANCE[Enhance with AI<br/>Optional LLM polish]
        SEND[sendWhatsAppMessage]
        UPDATE[Update DB<br/>next_reminder_at]
        CONV[Store in ConversationWindow<br/>Reminder metadata]
    end

    subgraph "Data Source"
        PG[(PostgreSQL<br/>tasks table)]
        USER_SVC[UserService<br/>Get user timezone]
    end

    INDEX --> SCHED
    SCHED --> MINUTE
    SCHED --> HOUR

    MINUTE --> REM
    HOUR --> REM

    REM --> ONE_TIME & RECUR & NUDGE & OVERDUE & DIGEST

    ONE_TIME --> QUERY
    RECUR --> QUERY
    NUDGE --> QUERY
    OVERDUE --> QUERY
    DIGEST --> QUERY

    QUERY --> PG
    QUERY --> USER_SVC

    QUERY --> GROUP
    GROUP --> FORMAT
    FORMAT --> ENHANCE
    ENHANCE --> SEND
    SEND --> UPDATE
    UPDATE --> PG
    SEND --> CONV

    CONV --> WA[WhatsApp API]

    style SCHED fill:#fff4e1
    style REM fill:#fff4e1
    style ENHANCE fill:#90EE90,stroke-dasharray: 5 5
```

---

## 9. QueryResolver Flow (Disambiguation)

```mermaid
flowchart TD
    USER[User Query<br/>"update the meeting"] --> RESOLVER[QueryResolver<br/>resolveOneOrAsk]

    RESOLVER --> TYPE{Entity Type}

    TYPE -->|calendar| CAL_QUERY[Query CalendarService<br/>getEvents with fuzzy search]
    TYPE -->|task| TASK_QUERY[Query TaskService<br/>getAll with filters]
    TYPE -->|list| LIST_QUERY[Query ListService<br/>getAll]
    TYPE -->|contact| CONTACT_QUERY[Query ContactService<br/>getAll]
    TYPE -->|email| GMAIL_QUERY[Query GmailService<br/>search]

    CAL_QUERY --> FUZZY[Fuzzy Matching<br/>fuzzy.ts<br/>Levenshtein distance]
    TASK_QUERY --> FUZZY
    LIST_QUERY --> FUZZY
    CONTACT_QUERY --> FUZZY
    GMAIL_QUERY --> FUZZY

    FUZZY --> MATCHES[Get Matches<br/>Score > threshold]

    MATCHES --> COUNT{Match Count}

    COUNT -->|0 matches| NOT_FOUND[Return Not Found<br/>null entity]
    COUNT -->|1 match| SINGLE[Return Single Match<br/>entity]
    COUNT -->|>1 matches| MULTIPLE[Return Disambiguation<br/>candidates array]

    MULTIPLE --> FORMAT[Format Disambiguation<br/>Numbered list<br/>Hebrew/English]

    FORMAT --> STORE[Store in ConversationWindow<br/>disambiguationContext]

    STORE --> USER_REPLY[User Replies<br/>"2" or "#1"]

    USER_REPLY --> PARSE[Parse Number Reference<br/>Extract index]

    PARSE --> SELECT[Select Candidate<br/>candidates[index-1]]

    SELECT --> SINGLE

    SINGLE --> RETURN[Return Entity<br/>Use for operation]
    NOT_FOUND --> RETURN_ERR[Return Error<br/>Entity not found]

    style RESOLVER fill:#fff4e1
    style FUZZY fill:#e1f5ff
    style STORE fill:#fff4e1
```

---

## Legend

### Component Types

- 🔵 **Blue (Entry/Orchestration)**: Entry points and orchestration logic (Webhook, MainAgent, Coordinator)
- 🟢 **Green (LLM)**: Components that make LLM calls (OpenAIService, Agents, Formatters)
- 🟡 **Yellow (Infrastructure)**: Infrastructure services (ConversationWindow, QueryResolver, PerformanceTracker)
- 🔴 **Red (External)**: External systems and APIs
- ⚪ **White (Services)**: Domain services and data layers

### Flow Types

- **Solid arrows**: Direct data flow and execution
- **Dashed arrows**: Optional or conditional flow
- **Bidirectional arrows**: Read/write access

### Key Design Patterns

1. **Agent Pattern**: All agents extend `BaseAgent` and use `executeWithAI` for LLM interaction
2. **Function Handler Pattern**: Functions define schemas and delegate to services
3. **Orchestration Pattern**: `MultiAgentCoordinator` handles multi-step and multi-agent workflows
4. **Context Injection**: Time context prepended to user messages (keeps prompts cacheable)
5. **Memory Management**: `ConversationWindow` manages short-term memory, `SecondBrainService` for long-term

---

## Key Architectural Principles

1. **Single LLM Gateway**: All LLM calls go through `OpenAIService`
2. **Centralized Prompts**: All system prompts in `system-prompts.ts`
3. **Function Schema = Prompt Description**: Function schemas match what prompts describe
4. **No Confirmations**: Delete operations execute immediately (UX decision)
5. **Performance Tracking**: All AI calls logged with tokens, duration, function calls
6. **Language Mirroring**: System mirrors user language (Hebrew/English)

---

_For detailed specifications, see other documentation files in `docs/project-instruction/`_
