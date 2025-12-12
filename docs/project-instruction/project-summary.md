# Focus WhatsApp Assistant - Project Summary

## Overview

Focus WhatsApp Assistant is an AI-powered personal assistant accessible via WhatsApp. It helps users manage their calendar, tasks, reminders, emails, and long-term memory through natural language conversations in Hebrew and English.

---

## Core Capabilities

### Message Types Supported

1. **Text Messages** - Natural language commands and queries
2. **Voice Messages** - Audio transcription using OpenAI Whisper
   - Supports Hebrew and English
   - Automatically transcribes audio to text before processing
3. **Image Messages** - Vision analysis using GPT-4o
   - Extracts structured data from images (events, tasks, contacts, screenshots)
   - Supports image captions for context
   - Automatic compression and validation
   - Stores image context in conversation memory for follow-up actions

---

## Agent Architecture

The system uses a multi-agent architecture where specialized agents handle different domains:

### 1. **MainAgent** (Orchestrator)

- **Role**: Entry point and intent routing
- **Capabilities**:
  - Intent detection and classification
  - Routes requests to appropriate agents
  - Handles general conversation
  - Manages reply context and numbered list references
  - Coordinates multi-agent workflows

### 2. **CalendarAgent**

- **Role**: Google Calendar management
- **Capabilities**:
  - Create single, recurring, and bulk events
  - Weekly and monthly recurring patterns
  - Read and list events in time ranges
  - Update events (single instance or entire series)
  - Delete events (single, by summary, or with exclusions)
  - Check for scheduling conflicts
  - Truncate recurring series
  - All-day event support
  - Timezone handling

### 3. **DatabaseAgent**

- **Role**: Tasks, reminders, lists, and contacts
- **Capabilities**:
  - **Tasks & Reminders**:
    - Create tasks with due dates
    - Recurring reminders (daily, weekly, monthly, nudge)
    - Nudge reminders (repeating every X minutes/hours)
    - Bulk operations (create, update, delete multiple)
    - Filter by category, completion state, date windows
    - Automatic deletion on completion (no confirmation needed)
  - **Lists**:
    - Create checklists and note lists
    - Manage list items (add, update, delete, mark complete)

### 4. **GmailAgent**

- **Role**: Gmail account management
- **Capabilities**:
  - Search emails by sender, subject, labels, time ranges
  - Read email threads and messages
  - Compose and send new emails
  - Reply and forward messages
  - Manage mailbox (labels, archive, delete, mark read/unread)

### 5. **SecondBrainAgent**

- **Role**: Long-term unstructured memory
- **Capabilities**:
  - Store arbitrary notes and thoughts
  - Semantic search using vector embeddings
  - Summarize stored memories
  - Update and delete notes
  - Cross-time information retrieval

---

## System Flow

### Message Processing Flow

```
WhatsApp Message (Text/Voice/Image)
    ↓
Webhook Handler (src/routes/webhook.ts)
    ↓
[If Voice] → Transcribe Audio (Whisper)
[If Image] → Analyze Image (GPT-4o Vision) → Store Context
    ↓
MainAgent (Intent Detection)
    ↓
[Single Agent] → Direct Route
[Multi-Agent] → MultiAgentCoordinator
    ↓
Agent Execution (BaseAgent.executeWithAI)
    ↓
Function Handler (*Functions.ts)
    ↓
Service Layer (*Service.ts)
    ↓
External APIs (Google Calendar/Gmail) or Database
    ↓
Response Formatter
    ↓
WhatsApp Response
```

### Orchestration Flow

1. **Intent Detection** (OpenAI)

   - Determines primary intent, involved agents, and planning needs
   - Single AI call for routing + planning decision (~1-3 seconds)

2. **Routing Decision**:

   - If `requiresPlan: false` AND single agent → Direct route
   - If `requiresPlan: true` OR multiple agents → Planning step

3. **Planning** (when needed):

   - Builds JSON plan of `PlannedAction` items
   - Handles dependencies between actions
   - Filters by user capabilities and Google connection

4. **Execution**:

   - Executes actions in order, honoring dependencies
   - Collects results from each agent
   - Maintains running context for downstream steps

5. **Summary**:
   - Single agent: Combine responses
   - Multi-agent: Generate summary via LLM

### Planning Logic

**Requires Plan (TRUE)** when:

- Multi-agent requests (e.g., "find contact and email them")
- Single agent with multiple sequential operations (DELETE + CREATE, UPDATE + CREATE)

**Requires Plan (FALSE)** when:

- Single operation (create, delete, update, get, list)
- Bulk operations of same type
- Operations with filters/exceptions

---

## Key Features

### Time Awareness

- Automatic time context injection into user messages
- Format: `[Current time: Day, DD/MM/YYYY HH:mm (ISO+offset), Timezone: Asia/Jerusalem]`
- Keeps system prompts static (cacheable) while providing accurate time awareness

### Conversation Memory

- `ConversationWindow` - Short-term memory for disambiguation
- Stores recent tasks, events, and context
- Handles numbered list references ("ב1", "#1", "הראשון")
- Image context storage for follow-up actions

### Query Resolution

- `QueryResolver` - Fuzzy lookup across events/tasks/contacts/lists/emails
- Handles ambiguous queries with disambiguation prompts
- Supports natural language references

### Performance Tracking

- Logs all AI calls (tokens, duration, function calls)
- Tracks agent execution times
- Performance logs stored in database

### Prompt Caching

- System prompts cached for efficiency
- Function definitions cached
- Reduces token usage and latency

---

## File Structure

```
whatsapp-ai-assistant/
├── src/
│   ├── agents/
│   │   ├── functions/          # Function handlers (tools layer)
│   │   │   ├── CalendarFunctions.ts
│   │   │   ├── DatabaseFunctions.ts
│   │   │   ├── GmailFunctions.ts
│   │   │   └── SecondBrainFunction.ts
│   │   └── v2/                 # Domain agents
│   │       ├── MainAgent.ts
│   │       ├── CalendarAgent.ts
│   │       ├── DatabaseAgent.ts
│   │       ├── GmailAgent.ts
│   │       └── SecondBrainAgent.ts
│   ├── core/
│   │   ├── base/
│   │   │   └── BaseAgent.ts    # Base agent with executeWithAI
│   │   ├── container/
│   │   │   └── ServiceContainer.ts  # Dependency injection
│   │   ├── context/
│   │   │   └── RequestContext.ts    # Per-request user context
│   │   ├── factory/
│   │   │   └── AgentFactory.ts
│   │   ├── manager/
│   │   │   └── AgentManager.ts      # Agent registry
│   │   ├── memory/
│   │   │   └── ConversationWindow.ts  # Short-term memory
│   │   ├── orchestrator/
│   │   │   └── QueryResolver.ts      # Fuzzy entity resolution
│   │   └── types/
│   │       └── AgentTypes.ts
│   ├── config/
│   │   ├── system-prompts.ts        # All LLM prompts
│   │   ├── openai.ts
│   │   ├── database.ts
│   │   └── google.ts
│   ├── services/
│   │   ├── ai/
│   │   │   └── OpenAIService.ts     # Single gateway for LLM calls
│   │   ├── calendar/
│   │   │   └── CalendarService.ts
│   │   ├── database/
│   │   │   ├── TaskService.ts
│   │   │   ├── ListService.ts
│   │   │   ├── ContactService.ts
│   │   │   └── UserService.ts
│   │   ├── email/
│   │   │   └── GmailService.ts
│   │   ├── memory/
│   │   │   └── SecondBrainService.ts
│   │   ├── reminder/
│   │   │   └── ReminderService.ts
│   │   ├── scheduler/
│   │   │   └── SchedulerService.ts
│   │   ├── performance/
│   │   │   ├── PerformanceTracker.ts
│   │   │   └── PerformanceLogService.ts
│   │   ├── whatsapp.ts
│   │   └── transcription.ts         # Audio transcription
│   ├── orchestration/
│   │   └── MultiAgentCoordinator.ts  # Multi-agent planner/executor
│   ├── routes/
│   │   ├── webhook.ts                # WhatsApp webhook handler
│   │   └── auth.ts                   # Google OAuth
│   ├── utils/
│   │   ├── fuzzy.ts                  # Fuzzy search
│   │   ├── time.ts                   # Time parsing
│   │   ├── text.ts
│   │   └── timeContext.ts            # Time context injection
│   ├── index.ts                      # HTTP server entry
│   └── index-v2.ts                   # Main processing function
├── docs/
│   └── project-instruction/          # Architecture documentation
│       ├── master-manual.md
│       ├── agents-calendar.md
│       ├── agents-database.md
│       ├── agents-gmail.md
│       ├── agents-second-brain.md
│       ├── orchestrator-and-flows.md
│       └── project-summary.md        # This file
├── migrations/                        # Database migrations
└── scripts/                          # Utility scripts
```

---

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **LLM**: OpenAI (GPT-4o, GPT-4-turbo, Whisper)
- **Database**: PostgreSQL
- **External APIs**:
  - Google Calendar API
  - Gmail API
  - WhatsApp Cloud API
- **Vector DB**: For second-brain semantic search (embeddings)

---

## Key Design Principles

1. **Separation of Concerns**:

   - Agents handle LLM interaction
   - Functions define tool schemas
   - Services contain business logic
   - Database/APIs are abstracted

2. **LLM-Centric Architecture**:

   - All LLM calls go through `OpenAIService`
   - System prompts are centralized in `system-prompts.ts`
   - Function schemas match prompt descriptions

3. **Performance Optimization**:

   - Prompt caching for system prompts
   - Single intent detection call (50% faster)
   - Time context injection (keeps prompts cacheable)

4. **User Experience**:
   - No confirmations for deletions (immediate action)
   - Automatic completion detection
   - Language mirroring (Hebrew/English)
   - Context-aware replies

---

## Important Notes

- **No confirmations** for deletions - all delete operations execute immediately
- **Automatic task completion** - detects completion signals ("done", "עשיתי", "✓") and deletes tasks
- **Image context** - analyzed images stored in conversation memory for follow-up actions
- **Reply context** - understands references to previous messages and numbered lists
- **Timezone handling** - Default timezone: Asia/Jerusalem, configurable per user
- **Google connection required** for Calendar and Gmail agents
- **Database and SecondBrain** agents work without Google connection

---

## Documentation Files

- `master-manual.md` - Complete architecture guide
- `agents-calendar.md` - Calendar agent details
- `agents-database.md` - Database agent details
- `agents-gmail.md` - Gmail agent details
- `agents-second-brain.md` - Second-brain agent details
- `orchestrator-and-flows.md` - Orchestration and planning logic
