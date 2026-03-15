# Second-brain capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Standalone semantic long-term memory vault for users.
- **Memory types**: `note`, `contact`, `kv` (key-value).
- **Fully isolated** from: working memory, fact memory, agent reasoning memory, ConversationWindow.
- **Boundaries**:
  - Execution is performed via `SecondBrainServiceAdapter` → `SecondBrainVaultService` (no direct DB calls in nodes).
  - No silent overwrites. Override = explicit DELETE + INSERT (triggered by HITL only).
  - Only `contact` and `kv` types trigger conflict detection. `note` is always append-only.

## Memory types

### note
- Used for: ideas, brain dumps, meeting summaries, general context.
- Behavior: embed + insert immediately. No similarity check. No validation. Append-only.
- HITL: NEVER.

### contact
- Used for: person/business contacts (name + phone/email/role).
- Behavior: extract structured fields → run hybrid retrieval → if strong match, HITL.
- Required metadata: `name` (always), `phone`, `email`, `description` (optional).
- Override: DELETE existing + INSERT new. No version history.

### kv (key-value)
- Used for: factual data points (e.g., "electricity bill is 500", "WiFi password is 1234", "I owe Liron for 3 haircuts").
- Classification covers: "X is/costs/equals Y" patterns, debts/obligations ("I owe X for Y"), counters/quantities.
- Behavior: extract `subject` + `value` → conflict check by vector similarity and subject overlap (when subject present), so same-subject value updates trigger HITL; if strong match → disambiguation.
- Required metadata: `subject`, `value`.
- Override: DELETE existing + INSERT new. No version history.

## Database table

Table: `second_brain_memories` (created by `scripts/migrations/003-second-brain-hybrid.sql`)

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, auto-generated |
| user_id | UUID | FK → users(id), NOT NULL |
| type | TEXT | CHECK (note \| contact \| kv) |
| content | TEXT | Full text content |
| summary | TEXT | 1-sentence summary |
| tags | TEXT[] | Keyword tags |
| metadata | JSONB | Type-specific fields |
| created_at | TIMESTAMPTZ | Auto |
| embedding | VECTOR(1536) | OpenAI text-embedding-3-small |
| content_tsv | tsvector | Generated from content, GIN indexed |

## ResolverSchema entry (planner routing contract)

- `SECONDBRAIN_SCHEMA` (`capability: "second-brain"`)
- Trigger patterns include note/contact/kv signals (Hebrew + English)
- Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract (semantic args)

### Resolver

- `SecondBrainResolver`: `Memo_v2/src/graph/resolvers/SecondBrainResolver.ts`
- Uses comprehensive LLM system prompt that classifies memory type and extracts structured fields.

### Operations

`args.operation ∈ ['storeMemory', 'searchMemory', 'updateMemory', 'deleteMemory', 'getAllMemory', 'getMemoryById']`

### storeMemory args shape
```json
{
  "operation": "storeMemory",
  "memory": {
    "type": "note | contact | kv",
    "content": "...",
    "summary": "...",
    "tags": ["..."],
    "metadata": { ... }
  },
  "_needsConflictCheck": true  // Set by resolver for contact/kv
}
```

### searchMemory args shape
```json
{
  "operation": "searchMemory",
  "query": "...",
  "type": "note | contact | kv | null",
  "limit": 5
}
```

## Entity resolution contract (semantic → IDs / conflict detection)

### Entity resolver

- `SecondBrainEntityResolver`: `Memo_v2/src/services/resolution/SecondBrainEntityResolver.ts`

### When resolution happens

1. **Conflict detection** for `storeMemory` when `_needsConflictCheck` is true (contact/kv only):
   - Runs `SecondBrainVaultService.findConflicts()` with `opts.subject` for kv type (enables subject-based matching).
   - If strong match → disambiguation HITL with `disambiguationKind: 'conflict_override'` and two options:
     - "Update existing (override)" → `conflictDecision: 'override'`, `conflictTargetId: <id>`
     - "Keep both (insert new)" → `conflictDecision: 'insert'`
   - The resolver supplies a custom `question` (context-aware conflict description) that HITLGateNode uses directly instead of its generic template.
   - If no strong match → passthrough (insert)

2. **Entity lookup** for `updateMemory`, `deleteMemory`, `getMemoryById` (when no `memoryId`):
   - Runs `hybridSearch()` with `args.memory?.type || args.type` → candidates → disambiguation if needed

### HITL behavior (disambiguation)

- `note` type: NEVER triggers HITL
- `contact`: HITL only if vector similarity ≥ 0.85 AND keyword overlap (`content_tsv`).
- `kv`: HITL if vector similarity ≥ 0.85 AND (keyword overlap OR, when `metadata.subject` is present, subject overlap so value-only updates trigger disambiguation). Entity resolver passes `{ subject: memory.metadata.subject }` to `findConflicts()` for kv type.
- For delete: `allowMultiple: true`
- For conflict: `allowMultiple: false`, `disambiguationKind: 'conflict_override'` (pick override or insert)
- "both"/"שניהם" in conflict context → treated as "keep both" (insert new), not multi-select

### HITL resume flow (shared with all capabilities)

Conflict disambiguation uses the same two-layer resume logic as all other entity disambiguation:
1. **Layer 1 (deterministic)**: `validateSingleChoice()` catches numeric ("1"/"2"), exact label match, "all"/"שניהם"
2. **Layer 2 (LLM fallback)**: `callDisambiguationInterpreter()` normalizes free-text like "תעדכן" (update) or "שמור את שניהם" (keep both) into a selection number or null
3. **Switch intent**: If LLM returns null (user changed topic), reply goes back to planner as a fresh request

## Execution contract (adapters)

### Executor dispatch

- `ExecutorNode` (`capability: 'second-brain'`) calls `SecondBrainServiceAdapter(userPhone).execute(args)`.

### Adapter

- `Memo_v2/src/services/adapters/SecondBrainServiceAdapter.ts`
- Calls `SecondBrainVaultService` methods:
  - `storeMemory`: `vault.insert()` or `vault.override()` based on `conflictDecision`
  - `searchMemory`: `vault.hybridSearch()`
  - `deleteMemory`: `vault.deleteById()`
  - `updateMemory`: `vault.override()`
  - `getAllMemory`: `vault.list()`
  - `getMemoryById`: `vault.getById()`

### Vault service

- `Memo_v2/src/services/second-brain/SecondBrainVaultService.ts`
- Hybrid retrieval: pgvector cosine similarity + PostgreSQL full-text search (tsvector)
- Override = DELETE existing + INSERT new (no version history)

## Response formatting/writer behavior

- Uses generic formatter + writer behavior.
- `SecondBrainResponseContext` includes: `isStored`, `isSearch`, `isOverride`, `memoryType`, `isEmpty`.
- Per-item `_itemContext` includes: `isNew`, `isOverride`, `memoryType`, `hasMetadata`.
- **Search memory**: The response writer receives the user's question (`userMessage`) and retrieved memories (full content from the adapter). It must **answer the user's question** in natural, human tone using only the retrieved data — e.g. "Eden gave 500 shekels at the wedding" — and must **not** dump the raw memory list. If the memories do not contain enough to answer, the writer says so briefly in the user's language. Retrieval continues to return full saved data; only the formatted response is answer-from-data.
- **List memories / store memory**: Unchanged — concise list with date + preview for list; short confirmation (e.g. "Saved!") for store.

## Hybrid retrieval details

### Search query (general search)
- Vector similarity ≥ 0.5 (lower threshold for broad search)
- Ranking: `0.7 * vector_similarity + 0.3 * keyword_score`
- Filters: `user_id` only. **No type filter** — search always looks across all memory types (note, contact, kv) to maximize recall. The resolver's type hint is not used as a search filter.

### Conflict detection (contact/kv store)
- **contact**: Vector similarity ≥ 0.85 and keyword overlap (`content_tsv @@ plainto_tsquery('simple', content)`). Both required.
- **kv**: Entity resolver passes `{ subject: memory.metadata.subject }` to `findConflicts()`. When subject is present: `findConflictsKvBySubject()` does vector-only search (≥ 0.85) then filters by subject overlap (normalized equality or one contains the other), so same-subject value changes (e.g. "3 תספורות" → "ארבע תספורות", "1 haircut" → "2 haircuts") trigger HITL. When subject is not present: same as contact (vector + keyword).

### hybridSearch SQL parameter handling
- `queryText` parameter index is computed dynamically (`$5` when no type filter, `$6` when type filter is present) to avoid PostgreSQL parameter type inference errors.
