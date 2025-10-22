# 🧠 WhatsApp AI Assistant

---

# 🧠 Cursor Refactor & Upgrade Prompt — Focus (WhatsApp) LangGraph Multi-Agent Architecture

You are an expert **TypeScript engineer and AI systems architect**.

Your task is to **refactor and upgrade the existing Focus WhatsApp Assistant project** into a **modern, LangGraph-based multi-agent architecture** — without starting from scratch.

Preserve all current business logic, integrations (Supabase, Gmail, Google Calendar, WhatsApp webhook), and schema — but reorganize the system to follow the structure and patterns below.

---

## 🎯 Primary Objective

Upgrade the **current Focus WhatsApp AI assistant** (which now uses multiple isolated agents like `DatabaseAgent`, `CalendarAgent`, `GmailAgent`, etc.)

into a **LangGraph-based orchestrated multi-agent system** with:

- **Central reasoning pipeline**
- **Shared memory**
- **Human-in-the-Loop (HITL)**
- **Safe bulk CRUD**
- **Robust natural-language entity resolution**
- **Recurring event/task support**
- **Clear modular architecture**

The upgrade should **reuse and adapt** existing code (agents, toolsets, services, routes, and DB schema) — not replace functionality.

---

## 🏗️ New Architecture Overview

Replace the current architecture (Factory + Singleton + ServiceContainer pattern)

with an updated **LangGraph Orchestrator** that coordinates all domain agents.

### ✅ Required Agents

1. **MainAgent** – central orchestrator & conversation controller
2. **DatabaseAgent** – handles all Supabase task/list/contact CRUD
3. **CalendarAgent** – manages Google Calendar (create, update, recurring, bulk)
4. **GmailAgent** – handles sending/searching emails
5. **PlannerAgent** – plans and sequences multi-step actions (e.g., meeting scheduling)
6. *(Add placeholder)* **ProfessionalManagementAgent** – for future weekly/goal planning

---

## 🧠 System Flow

Your existing entry point (`index-v2.ts` / `webhook.ts`) should now route WhatsApp messages like this:

```
WhatsApp message
   ↓
MainAgent  →  IntentParser  →  QueryResolverNode
                      ↓
        (Planner / Calendar / Database / Gmail)
                      ↓
                 HITLNode (if needed)
                      ↓
              Response back to WhatsApp

```

---

## 📂 Refactored Folder Structure

Reorganize the codebase (keep existing services intact, just move and integrate them):

```
src/
├─ app/
│  └─ index.ts                      # Entry point, WhatsApp webhook → FocusGraph.run()
│
├─ core/
│  ├─ orchestrator/
│  │  ├─ FocusGraph.ts              # LangGraph nodes & edges
│  │  ├─ HITLNode.ts                # Human approval system
│  │  ├─ MemoryManager.ts           # Shared memory between agents
│  │  └─ QueryResolverNode.ts       # NLQ → candidate IDs before CRUD
│  │
│  ├─ agents/
│  │  ├─ MainAgent.ts
│  │  ├─ DatabaseAgent.ts
│  │  ├─ CalendarAgent.ts
│  │  ├─ GmailAgent.ts
│  │  ├─ PlannerAgent.ts
│  │  └─ ProfessionalManagementAgent.ts   # placeholder for weekly planning
│  │
│  └─ nlp/
│     ├─ IntentParser.ts
│     ├─ Decomposer.ts
│     └─ types.ts
│
├─ tools/
│  ├─ DatabaseToolset.ts
│  ├─ CalendarToolset.ts
│  ├─ GmailToolset.ts
│  └─ SharedToolset.ts
│
├─ services/                        # keep your existing service implementations
│  ├─ supabase/SupabaseService.ts
│  ├─ google/CalendarService.ts
│  ├─ google/GmailService.ts
│  └─ openai/OpenAIService.ts
│
├─ adapters/
│  ├─ whatsapp/Webhook.ts           # WhatsApp → FocusGraph input/output
│  └─ scheduler/ReminderWorker.ts   # Background reminders, Supabase polling
│
├─ utils/
│  ├─ logger.ts
│  ├─ text.ts                       # Hebrew/English detection
│  ├─ time.ts                       # natural → ISO, timezone aware
│  ├─ env.ts
│  └─ fuzzy.ts                      # fuzzy string matching helper
│
├─ types/
│  ├─ schema.ts                     # Zod schemas for Tasks, Events, Lists
│  └─ interfaces.ts                 # Shared agent/tool interfaces
│
└─ tests/
   ├─ e2e/pipeline.test.ts
   ├─ e2e/nlq.test.ts               # new tests for natural-language entity resolution
   └─ unit/agents.test.ts

```

> ⚠ Keep your existing /services folder intact — just rewire it to work through the new toolsets. and delete unceccesry
> 

---

## ⚙️ LangGraph Orchestrator (FocusGraph.ts)

Integrate **LangGraph** with your existing agents.

- Use `@langchain/langgraph` and `ChatOpenAI` for orchestration.
- Add nodes for each agent (Calendar, Database, Gmail, Planner) plus `QueryResolverNode` and `HITLNode`.
- Use your existing logic inside each agent’s `execute()` method, but make them **LangGraph Nodes**.

Example outline:

```tsx
import { StateGraph, Node } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";

import { MainAgent, CalendarAgent, DatabaseAgent, GmailAgent, PlannerAgent, HITLNode, QueryResolverNode } from "../agents";

const model = new ChatOpenAI({ model: "gpt-4o", temperature: 0.3 });
const memory = new MemorySaver();

export const FocusGraph = new StateGraph({
  name: "FocusOrchestrator",
  memory,
  nodes: [MainAgent, QueryResolverNode, CalendarAgent, DatabaseAgent, GmailAgent, PlannerAgent, HITLNode],
  edges: [
    { from: "start", to: "MainAgent" },
    { from: "MainAgent", to: "QueryResolverNode", condition: "needs_entity_resolution" },
    { from: "QueryResolverNode", to: "CalendarAgent", condition: "calendar_intent" },
    { from: "QueryResolverNode", to: "DatabaseAgent", condition: "task_intent" },
    { from: "MainAgent", to: "PlannerAgent", condition: "planning_intent" },
    { from: "any", to: "HITLNode", condition: "approval_required" },
    { from: "HITLNode", to: "end", condition: "done" }
  ]
});

```

---

## 🧱 Agent Conversion Instructions

Each current agent (like `CalendarAgent.ts`) should:

1. Be turned into a **LangGraph Node** (`Node({ name, execute })`).
2. Use its existing toolset and service logic inside `execute()`.
3. Return a structured state with `result`, `next`, and optional `HITL` request.
4. Rely on `QueryResolverNode` to resolve entity IDs or date ranges before CRUD.

Your old `executeWithAI()` calls become part of the **MainAgent** reasoning layer only.

---

## 🧩 Toolsets

Convert your `DatabaseFunctions`, `CalendarFunctions`, and `GmailFunctions`

into clean `Toolset` classes (pure CRUD, no LLM).

Reuse the same service calls (`CalendarService`, `SupabaseService`, etc.),

but expose only clean methods:

**Example:**

```tsx
export class CalendarToolset {
  async createEvent(input) { return await calendarService.createEvent(input); }
  async updateMany(candidates, patch) { ... }
  async deleteMany(candidates) { ... }
  async findFreeSlots(params) { ... }
  async createRecurring(input) { ... }
}

```

Agents will call these directly.

---

## ⚠️ Crucial Upgrade — Multi-Entity & Natural-Language Query Logic

You must fix existing bugs related to:

- multi-create/delete/update
- recurring (daily/weekly) items
- resolving events/tasks based on **natural-language references** like:
    
    > “תשנה את הכותרת עבודה ל פיתוח תוכנה באירוע שיש לי מחר בעשר בבוקר”
    > 

### Implement QueryResolverNode

Add a node that:

1. Parses time expressions (“מחר בעשר”, “השבוע”) using `chrono-node` and `date-fns`.
2. Extracts keywords (title, contact names, etc.).
3. Fuzzy matches existing tasks/events in Supabase or Calendar (threshold ≥ 0.6).
4. Returns candidate IDs to the target agent.

If multiple matches found → forward to `HITLNode` for clarification.

Use helpers:

```
src/utils/time.ts     // for relative time → ISO
src/utils/fuzzy.ts    // Levenshtein or cosine-similarity based fuzzy search
src/utils/text.ts     // language normalization

```

### Multi-Entity CRUD Safety

- Batch operations (≤10 items per batch, 200ms delay).
- Ask HITL confirmation before mass delete/update.
- Rollback logs in Supabase if partial failures occur.

### Recurrence Support

- Detect patterns like:
    - “כל יום”, “כל שבועיים”, “כל שני עד סוף השנה”
- Store recurrence as:
    - RRULE for Calendar events
    - JSONB `{ type: "weekly", days: ["Mon","Wed"], until: "..." }` for Tasks
- When updating/deleting → operate on master entity.

### Example: update by description

User: “תשנה את האירוע עבודה לפיתוח הסוכן מחר בעשר בבוקר”

→ QueryResolver finds event with summary≈“עבודה”, start≈“tomorrow 10:00”

→ CalendarAgent.updateEvent({ eventId, summary: "פיתוח הסוכן" })

---

## 🔐 HITL Improvements

- Require confirmation before any bulk or external (email/send/invite) action.
- For ambiguous queries → WhatsApp clarification message listing possible matches.

---

## 🕰 ReminderWorker Upgrade

Keep your current reminder mechanism but:

- Ensure it pulls events/tasks from both Calendar and Tasks.
- Send reminders via WhatsApp (Webhook) 15–30 minutes before due time.
- Include goal context (if available).

---

## 🧪 Tests to Add

| Test | Expected Behavior |
| --- | --- |
| Create recurring event every Monday | RRULE correctly stored |
| Update event “tomorrow 10:00” | Correct match + update |
| Delete all tasks today | Batch delete + HITL |
| Ambiguous match | Clarification prompt |
| Create multiple events | Batch create success |
| Recurring truncation | Updates master RRULE correctly |

---

## ✅ Migration Summary

- **KEEP:**
    - Supabase schema & services
    - Calendar/Gmail integrations
    - Logger, webhook, memory tables
- **REPLACE:**
    - Old Factory/ServiceContainer agent orchestration → LangGraph Orchestrator
    - FunctionHandlers → Toolsets
    - Per-agent `executeWithAI()` → single MainAgent reasoning flow
    - Ad-hoc date/title parsing → centralized `QueryResolverNode`
- **ADD:**
    - LangGraph integration
    - HITLNode, QueryResolverNode, MemoryManager
    - Multi-entity-safe CRUD
    - Recurrence support
    - Tests for NLQ robustness

---

## 🚀 Deliverables for Cursor

1. Refactor existing codebase into the structure described above.
2. Integrate LangGraph orchestration into `FocusGraph.ts`.
3. Update all agents to the new Node pattern.
4. Implement QueryResolver + fuzzy matching.
5. Add safe batch CRUD operations + HITL flow.
6. Retain all working integrations and database logic.
7. Add tests for multi-entity/NLQ behavior.
8. Ensure all user-facing logic (WhatsApp responses) remains consistent with current behavior.

---

### 🧩 Design Summary

> Upgrade current Focus WhatsApp AI assistant into a LangGraph multi-agent system.
> 
> 
> Each domain (Calendar, Gmail, Database, Planner) remains an **agent** with its own **toolset**.
> 
> A centralized orchestrator manages communication, memory, and HITL.
> 
> Add **natural-language entity resolution**, **bulk-safe CRUD**, and **recurrence handling**.
> 
> All upgrades must **reuse existing code**, preserving current functionality and integrations.
> 

---

✅ **Final Instruction for Cursor:**

> Scan the current codebase and perform this refactor as a structural and functional upgrade — not a rewrite. Maintain existing logic and database connections, but reorganize it into this LangGraph-based, HITL-ready multi-agent framework.
>