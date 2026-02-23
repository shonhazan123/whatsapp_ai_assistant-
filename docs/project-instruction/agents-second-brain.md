## Second-Brain Capability (Semantic Memory Vault)

### High-Level Role

The second-brain capability is a **standalone semantic long-term memory vault**. It stores, retrieves, and manages three types of personal knowledge: **notes**, **contacts**, and **key-value facts**.

It is **fully isolated** from working memory, fact memory, agent reasoning memory, and ConversationWindow.

---

### Memory Types

#### 1. Note
- **Used for**: Ideas, brain dumps, meeting summaries, observations, general context.
- **Behavior**: Immediately embedded and inserted. No similarity check. No validation. Append-only.
- **HITL**: Never triggered for notes.

#### 2. Contact
- **Used for**: Business cards, person/company contacts (name + phone/email/role).
- **Behavior**: Extracts structured fields (name, phone, email, description). Runs hybrid retrieval. If strong match found → HITL asks user to update existing or keep both.
- **Override**: DELETE existing + INSERT new (no version history).

#### 3. KV (Key-Value)
- **Used for**: Factual data points like "electricity bill is 500", "WiFi password is 1234".
- **Behavior**: Extracts subject + value. Runs hybrid retrieval. If strong match → HITL.
- **Override**: DELETE existing + INSERT new (no version history).

---

### What the Second-Brain CAN Do

- **Store memories** (note/contact/kv) with automatic type classification
- **Search memories** using hybrid retrieval (vector similarity + keyword matching)
- **Update/delete memories** with entity resolution and disambiguation
- **List all memories** with optional type filter
- **Conflict detection**: For contacts and kv, detects duplicates via hybrid retrieval and asks user before overriding

---

### What the Second-Brain CANNOT / MUST NOT Do

- **No scheduling or reminders** — dates/times/future actions belong to calendar or database
- **No email or calendar operations** — cannot touch Google APIs
- **No silent overwrites** — any override requires explicit HITL confirmation
- **No hallucinated memories** — cannot invent memories never stored by the user
- **No version history** — override is delete + insert, no tracking of previous values

---

### Execution Flow (Memo_v2 Architecture)

1. **PlannerNode** routes to `capability: "second-brain"` based on trigger patterns
2. **SecondBrainResolver** uses LLM to:
   - Determine operation (storeMemory / searchMemory / etc.)
   - Classify memory type (note / contact / kv)
   - Extract structured fields per type
3. **EntityResolutionNode** via `SecondBrainEntityResolver`:
   - For `storeMemory` with contact/kv → runs hybrid conflict detection
   - If strong match found → HITL disambiguation (override vs keep both)
   - For update/delete → entity lookup via hybrid search
4. **ExecutorNode** via `SecondBrainServiceAdapter`:
   - Calls `SecondBrainVaultService` methods
   - Insert, override (delete+insert), search, delete, list
5. **ResponseFormatterNode** + **ResponseWriterNode**:
   - Formats results with `SecondBrainResponseContext`

---

### Hybrid Retrieval

The core retrieval mechanism combines:
- **Vector similarity** (pgvector cosine distance on 1536-dim embeddings)
- **Keyword matching** (PostgreSQL full-text search via tsvector/tsquery)
- **Metadata filtering** (user_id, memory type)

**For general search**: similarity ≥ 0.5, ranked by 70% vector + 30% keyword score.

**For conflict detection** (contact/kv only): similarity ≥ 0.85 AND keyword overlap must be present. Both conditions required to trigger HITL.

---

### JSON Data Structure

All memory inserts follow this structure:

```json
{
  "type": "note | contact | kv",
  "content": "Full text content",
  "summary": "1-sentence summary",
  "tags": ["keyword1", "keyword2"],
  "metadata": { ... }
}
```

Type-specific metadata:
- **note**: `{ "source": "text", "entities": ["extracted names/topics"] }`
- **contact**: `{ "name": "...", "phone": "...", "email": "...", "description": "..." }`
- **kv**: `{ "subject": "...", "value": "..." }`

---

### HITL Behavior

When conflict is detected for contact/kv:
- Bot presents existing entry and asks user
- Two options: "Update existing (override)" or "Keep both (insert new)"
- Only structured types (contact, kv) trigger HITL
- Note type NEVER triggers HITL

---

### When to Prefer Second-Brain Over Other Capabilities

- User wants to **remember/save** general information, contacts, or facts
- User provides structured data (name+phone, subject=value)
- User asks **"what did I save about..."** or **"what's my wifi password?"**
- Content is **narrative, informational, or reflective** (not about scheduling/email/tasks)

If the request involves dates/times for future actions → calendar or database, not second-brain.
