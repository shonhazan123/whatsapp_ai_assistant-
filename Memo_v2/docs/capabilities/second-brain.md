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
- Used for: factual data points (e.g., "electricity bill is 500", "WiFi password is 1234").
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
   - Runs `SecondBrainVaultService.findConflicts()` (hybrid: vector ≥ 0.85 AND keyword match)
   - If strong match → disambiguation HITL with two options:
     - "Update existing (override)" → `conflictDecision: 'override'`, `conflictTargetId: <id>`
     - "Keep both (insert new)" → `conflictDecision: 'insert'`
   - If no strong match → passthrough (insert)

2. **Entity lookup** for `updateMemory`, `deleteMemory`, `getMemoryById` (when no `memoryId`):
   - Runs `hybridSearch()` → candidates → disambiguation if needed

### HITL behavior (disambiguation)

- `note` type: NEVER triggers HITL
- `contact`: HITL only if vector similarity ≥ 0.85 AND keyword overlap (`content_tsv`).
- `kv`: HITL if vector similarity ≥ 0.85 AND (keyword overlap OR, when `metadata.subject` is present, subject overlap so value-only updates trigger disambiguation).
- For delete: `allowMultiple: true`
- For conflict: `allowMultiple: false` (pick override or insert)

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

## Hybrid retrieval details

### Search query (general search)
- Vector similarity ≥ 0.5 (lower threshold for broad search)
- Ranking: `0.7 * vector_similarity + 0.3 * keyword_score`
- Filters: `user_id`, optional `type`

### Conflict detection (contact/kv store)
- **contact**: Vector similarity ≥ 0.85 and keyword overlap (`content_tsv @@ plainto_tsquery('simple', content)`). Both required.
- **kv**: When `metadata.subject` is provided: vector-only search (≥ 0.85) then filter by subject overlap (normalized equality or one contains the other), so same-subject value changes (e.g. "3 תספורות" → "ארבע תספורות") trigger HITL. When subject is not provided: same as contact (vector + keyword).
