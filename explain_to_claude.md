# Full Context: WhatsApp AI Assistant — Architecture, Behavior & Open Problems

This document gives you everything you need to discuss the architecture of this product at the product-design and agent-design level. You are acting as an expert in **agentic product design**, not a code reviewer.

---

## What This Product Is

A **WhatsApp AI assistant** (called "Donna") that lets users manage their life via natural language over WhatsApp. The user sends a text message, Donna understands what they want, performs operations against their Google Calendar, a task/reminder database, Gmail, and a long-term memory store — then replies in natural language (Hebrew or English, based on user preference).

This is a **personal productivity agent**, not a chatbot. The overwhelming majority of interactions are CRUD operations — create, read, update, delete — against well-defined data stores. The agent does not browse the web, does not reason about open-ended topics. Its domain is narrow and bounded.

---

## The Capability Model

Donna has exactly **four domains**, each with a defined set of operations:

### 1. Calendar (Google Calendar)
- Create single event
- Create recurring event (daily/weekly/monthly with end condition)
- Create multiple events in bulk
- Get events (list, find by name/time, check what's today/tomorrow/this week)
- Update event (change time, title, location, attendees)
- Update events in bulk (e.g., "move all my Thursday meetings to Friday")
- Delete single event
- Delete events in bulk (e.g., "clear my schedule on Friday")
- Check conflicts / availability

### 2. Database — Tasks & Reminders
- Create task (text, optional due date, optional priority)
- Create reminder (text + required date + required time — both mandatory)
- List tasks (all, by date, overdue, by priority)
- Complete task / mark done
- Update task (change text, date, priority)
- Delete task / reminder (single or bulk)
- Recurring reminders (nudging behavior — repeat until acknowledged)

### 3. Database — Lists
- Create list (shopping list, packing list, etc.)
- Add item to list
- Remove item from list
- Get/show list
- Toggle item (check/uncheck)
- Delete list

### 4. Gmail (secondary, less used)
- List/search emails
- Send email
- Reply to email
- Mark read/unread

### 5. Second Brain (long-term memory / notes)
- Store a memory/note
- Search/find memories
- Update memory
- Delete memory

---

## How the System Currently Works — The Pipeline

Every incoming WhatsApp message goes through this graph (built with LangGraph, TypeScript):

```
User message (WhatsApp)
        ↓
1. Context Assembly       — Load user profile, timezone, auth tokens, recent conversation (last 10 messages), latest 3 actions taken
        ↓
2. Reply Context          — If user replied to a specific message, extract what they replied to
        ↓
3. Planner (LLM call #1) — The most important node. Reads the user message + all context and produces a structured "plan":
                            {
                              intentType: "operation" | "conversation" | "meta",
                              confidence: 0.0–1.0,
                              riskLevel: "low" | "medium" | "high",
                              needsApproval: boolean,
                              missingFields: string[],   // e.g. ["reminder_time_required", "intent_unclear"]
                              plan: [
                                {
                                  id: "A",
                                  capability: "calendar" | "database" | "gmail" | "second-brain" | "general",
                                  action: string,        // e.g. "create_event", "delete_task", "list_events"
                                  constraints: {},       // extracted args (time, title, etc.)
                                  dependsOn: [],         // for multi-step plans
                                  contextSummary: string // human-readable summary of this step
                                }
                              ]
                            }
        ↓
4. Capability Check       — Deterministic: if the plan requires calendar/gmail but user hasn't connected Google, short-circuit with a setup message
        ↓
5. HITL Gate              — Decides whether to pause and ask the user for clarification BEFORE executing.
                            Triggers based on:
                            - confidence < 0.7
                            - missingFields contains "intent_unclear", "reminder_time_required", etc.
                            - riskLevel == "high" (deletion, bulk ops)
                            - needsApproval == true
                            If triggered: sends question to user, pauses graph (interrupt()), resumes when user replies
        ↓
6. Resolver Router        — Routes each plan step to a specific resolver. Each resolver is a specialist for one capability.
                            Tries to match the plan's action hint to a resolver's known actionHints list.
                            Steps with no dependencies can run in parallel.
        ↓
7. Resolvers (LLM call per step) — Each resolver makes ONE LLM call to translate the planner's structured step into exact API arguments.
                            Example: CalendarMutateResolver takes { action: "create_event", constraints: { time: "tomorrow 3pm", title: "dentist" }}
                            and outputs: { operation: "createEvent", summary: "dentist", start: "2026-04-07T15:00:00+03:00", end: "..." }
        ↓
8. Entity Resolution      — For update/delete: tries to find the exact entity (event ID, task ID) matching the resolver's output.
                            If multiple candidates found → triggers HITL disambiguation ("which one did you mean?")
                            If not found → currently returns silent error (known problem)
        ↓
9. Executor               — Makes the actual API calls (Google Calendar API, database, Gmail API).
                            Idempotent via traceId+stepId ledger to prevent double-execution on retries.
        ↓
10. Response Formatter    — Deterministic: formats dates (today/tomorrow/relative), groups tasks by urgency, builds context objects
        ↓
11. Response Writer (LLM call #2) — Takes the formatted execution result and writes the final WhatsApp message.
                            One call per capability type (calendar writer, database writer, etc.)
        ↓
12. Memory Update         — Appends the exchange to conversation history
        ↓
User receives WhatsApp reply
```

**Total LLM calls per request (happy path):** 3
- Planner (1) + Resolver(s) (1 per step, often just 1) + Response Writer (1)

**With HITL:** adds 0 LLM calls (HITL is deterministic for choice-based questions; adds 1 call for the LLM interpreter if user gives a free-text ambiguous reply)

---

## The HITL System (Human in the Loop)

HITL is the mechanism for pausing the agent and asking the user a question mid-execution. It has two families:

### Planner HITL (before execution)
Triggered by the Planner's output signals:
- `intent_unclear` → "I didn't quite understand, what would you like to do?"
- `confidence < 0.7` → "Just to confirm, you want to [X]?"
- `missing_fields` → "What time should the reminder be set for?"
- `high_risk` → "Are you sure you want to delete all tasks?"

Resume routing:
- If `intent_unclear` → re-run the Planner with the user's clarification
- All other cases → skip replanning, go directly to resolvers

### Entity HITL (during entity resolution)
Triggered when a lookup finds multiple candidates:
- "I found 3 events called 'meeting' — which one?" → user picks 1, 2, or 3
- Deterministic fast-path: numeric choice or "all"/"both"
- Fallback: small LLM call to normalize free-text answer

### HITL Properties
- One pending HITL at a time (no overlapping questions)
- 5-minute TTL — if user doesn't reply in time, request expires and user must restart
- Re-ask up to unlimited times currently (known bug: no loop limit)
- All HITL Q&A is persisted in conversation memory so the Planner always has full context on resume

---

## User Context Available to Every Node

Every node in the graph has access to:
- `user.timezone` — IANA timezone string (e.g., `"Asia/Jerusalem"`)
- `user.language` — `"he"` or `"en"` (Hebrew or English)
- `user.capabilities` — which Google services are connected
- `recentMessages` — last 10 messages including HITL Q&A
- `latestActions` — last 3 operations successfully executed (for referential language: "it", "that", "the same one")
- `now` — current time already converted to the user's timezone

---

## The Known Problems (Current State)

### Problem 1: Timezone Bug (confirmed, both sides)
When a user says "3pm", calendar events and WhatsApp confirmations are both off by 1–2 hours.

**Where:** `ResponseFormatterNode.formatDate()` uses `new Date()` (server local time) instead of the user's timezone for date comparisons. The server runs in UTC; users are typically in UTC+2/+3 (Israel). This is a concrete bug in one function, not an architectural issue.

---

### Problem 2: HITL Fires Too Often
The flat 0.7 confidence threshold triggers clarification for things the agent should just handle — "what do I have tomorrow?", "add a task to buy milk". The Planner is being too cautious.

This partly because the Planner is trying to be certain before acting, rather than acting and showing the user what it did.

---

### Problem 3: Wrong Resolver Selected Silently
The Planner outputs an `action` string (e.g., `"add"`), which the Resolver Router tries to match against each resolver's `actionHints` list. If `"add"` doesn't exactly match any hint, the system silently falls back to the highest-priority resolver for that capability — which is often wrong (task resolver instead of list resolver for "add to shopping list").

**The root cause:** The Planner produces a free-text action hint, and downstream matching is based on string similarity. When they don't align, there's no error — just the wrong behavior.

---

### Problem 4: `not_found` Is Silent
When entity resolution looks up a task or event and finds nothing, it returns a generic error message instead of asking the user to clarify. User experience: "I couldn't find it" with no path forward.

---

### Problem 5: Prompt Bloat Is Unsustainable
The Planner system prompt is a monolithic string that has grown by appending examples and rules over time. There is no structure — it's part persona, part decision tree, part Hebrew language examples, part edge cases. It's hard to audit, hard to update, and the problems keep coming back because the fix is always "add another example."

The Planner is asked to do too much: understand language in two languages, decide which capability, decide which exact operation, estimate confidence, detect missing fields, infer risk level — all in one LLM call. Each one of these jobs adds prompt complexity.

---

### Problem 6: Architecture Mismatch ?
**This is the deepest problem and the reason the owner wants a new architecture discussion.**

The current architecture is **language-first**: the Planner reads raw user text and tries to classify it into operations. This means:
- Every new edge case in user language requires a new example or rule in the prompt
- Confidence scores are proxies for "did I understand this?", which is inherently unreliable
- HITL triggers based on LLM uncertainty, not on data-driven facts

The owner's insight: the agent's operation space is **bounded and known**. There are maybe 30–40 distinct operations across 4 domains. The problem isn't infinite language — it's that the system tries to do language understanding and operation selection and argument extraction all in one undifferentiated LLM call.

---

## The Open Architectural Question

**The owner wants to discuss: is there a fundamentally better architecture for this class of agent?**

One direction explored briefly:

**Query-First CRUD**: Instead of "understand → plan → clarify → execute", do:
1. Extract a structured form (operation + fields) — LLM output is from a fixed enum, not free text
2. Validate required fields deterministically (each operation has a known schema)
3. Lookup first for update/delete — run the API query BEFORE asking any question
4. Confirm based on what was found (0 results, 1 result, N results) — not based on LLM confidence

**Core shift:** HITL becomes data-driven ("I found 3 events, which one?") rather than confidence-driven ("I'm not sure what you meant"). The clarification logic is no longer inside the LLM — it's in code, based on actual lookup results.

This would eliminate:
- Confidence thresholds
- Keyword-based routing
- The planner-as-traffic-cop pattern
- Growing system prompts that try to cover every phrasing

But it introduces questions around:
- How do you handle genuinely ambiguous or multi-step requests? (e.g., "remind me every day to check my calendar first thing in the morning and also add a recurring event")
- How do you keep 2 LLM calls total (cost constraint)?
- How do you handle conversation continuity and referential language ("move it to Friday")?
- Where does the LLM's reasoning actually help vs. where should code decide?

---

## Technical Constraints Worth Knowing

- Built on **LangGraph** (TypeScript) — graph-based agent framework with checkpoint/resume support for HITL
- **OpenAI gpt-4o-mini** for all LLM calls — chosen for speed and cost
- WhatsApp Cloud API for messaging — responds 200 immediately, processes async
- Per-user request serialization (one in-flight request per user at a time)
- Conversation persisted in Supabase (PostgreSQL)
- Google APIs for Calendar and Gmail
- Users communicate in **Hebrew or English**, often switching mid-conversation

---

## What a Good Solution Looks Like (Owner's Priorities)

1. **Reliability first** — if an extra LLM call makes it more reliable, that's worth the cost
2. **HITL only when data demands it** — not based on LLM uncertainty
3. **CRUD operations (single + bulk + recurring) with 100% correctness**
4. **Prompts that don't need to grow** — the architecture should handle new edge cases through code/schema, not through more examples
5. **Fast** — users are on WhatsApp, they expect near-instant responses
6. **Maintainable** — the owner needs to be able to update behavior without touching 1000-line prompt strings

---

## What to Ignore

- The existing code structure is **not sacred** — a full architectural rethink is on the table
- Don't suggest "add more examples to the system prompt" or "add keyword matching" — that's the current approach and it doesn't scale
- Don't optimize for cost at the expense of reliability — cost is secondary
- The owner is the product designer and business owner, not a senior engineer — recommendations should be at the product/architecture level, not at the code level
