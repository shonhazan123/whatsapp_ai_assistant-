## Second-Brain Agent (Unstructured Memory)

### High-Level Role

The second-brain agent is the **long-term, unstructured memory system**. It stores, retrieves, and summarizes arbitrary notes, thoughts, observations, and narrative feedback from the user.

Under the hood, it uses `SecondBrainService`, which itself uses `OpenAIService.createEmbedding` for vector search.

---

### What the Second-Brain Agent CAN Do

- **Store notes/memories**
  - Any free-text content: ideas, meeting notes, bug reports, life events, project logs.
  - Can add metadata (tags, timestamps, inferred topic) as the implementation evolves.

- **Retrieve notes by semantic similarity**
  - Given a query (“what did I say about my mortgage broker?”), it:
    - Embeds the query using OpenAI embeddings.
    - Performs vector search over stored notes.
    - Returns best matches.

- **Summarize or restate memory**
  - Summarize one or multiple stored notes into shorter digests.
  - Restate in different style or language if explicitly requested.

- **Update or delete notes**
  - Modify existing entries when the user asks to correct or refine something they already stored.
  - Delete entries if user asks to forget specific items.

---

### What the Second-Brain Agent CANNOT / MUST NOT Do

- **No scheduling or reminders** – anything involving dates/times and future actions belongs to calendar or database agents.
- **No email or calendar operations** – cannot send email, create events, or touch Google APIs.
- **No authoritative data store** – it is not a source of record for financial/critical data; treat it as user-owned notes, not verified truth.
- **No hallucinated facts** – cannot invent “memories” that were never stored or implied by the user.

---

### Execution Flow

1. Intent classifier routes descriptive/narrative content to second-brain:
   - E.g., “here are some bugs I noticed…”, “what we discussed last week…”.
2. `SecondBrainAgent` calls `executeWithAI` with:
   - `systemPrompt = SystemPrompts.getSecondBrainAgentPrompt()` (or equivalent).
   - `functions = [secondBrainOperations]` (via `SecondBrainFunction`).
3. LLM chooses an operation such as:
   - `storeMemory`, `searchMemory`, `updateMemory`, `deleteMemory`, etc. (exact names in `SecondBrainFunction.ts`).
4. `SecondBrainFunction` invokes `SecondBrainService`, which:
   - For **store**:
     - Optionally embeds the text and saves it with vector + metadata.
   - For **search**:
     - Embeds the query, does vector search, returns ranked notes.
5. Agent performs a final LLM call if needed to:
   - Summarize the top results.
   - Combine multiple notes into a cohesive answer.

---

### Data & LLM Behavior

- **Storage model**
  - Each memory is a record with:
    - Raw text.
    - Embedding vector.
    - Timestamps.
    - Optional tags/metadata.

- **Retrieval model**
  - Vector similarity (cosine or similar) over embeddings.
  - May also apply simple keyword filters on top of vector ranking.

- **Language handling**
  - Always reply in **the same language** the user used (Heb/En).
  - When summarizing, preserve important names, numbers, and actionable points.

---

### Example Flows

- **“I had a meeting with the bank today, we discussed refinancing options.”**
  - Second-brain agent stores a note about this event for later recall.

- **“What did I say about my mortgage refi?”**
  - Embeds the query, finds the bank meeting note, and summarizes the core content.

- **“Update what I wrote about the refi: the interest rate is now 4.2%”**
  - Locates prior note(s) and appends/edits with the new detail.

- **“Forget everything about that contractor I told you about”**
  - Searches for notes referencing that contractor and deletes them.

---

### When to Prefer Second-Brain Over Other Agents

- User is **describing** something (past/future) and just wants it remembered or analyzed:
  - “Let me tell you what’s going on with my landlord…”
  - “Here’s feedback about the app that I want you to remember.”
- User asks conceptual, cross-time questions:
  - “What have I told you so far about my side project?”

If the request is **narrative, informational, or reflective**, and not about email/calendar/tasks, second-brain is often the right choice.


