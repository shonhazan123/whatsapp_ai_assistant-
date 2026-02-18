# Second-brain capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Store and retrieve personal knowledge (“second brain”) using a vector DB-backed service.
- **Boundaries**:
  - Execution is performed via `SecondBrainServiceAdapter` (no direct DB calls in nodes).
  - Update/delete operations require identifying a specific memory entry (entity resolution).

## ResolverSchema entry (planner routing contract)

- `SECONDBRAIN_SCHEMA` (`capability: "second-brain"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract (semantic args)

### Resolver

- `SecondBrainResolver`: `Memo_v2/src/graph/resolvers/SecondBrainResolver.ts`

### Operations

`args.operation ∈ ['storeMemory', 'searchMemory', 'updateMemory', 'deleteMemory', 'getAllMemory', 'getMemoryById']`

Common fields:
- Store: `text`, optional `metadata`
- Search: `query`, optional `limit`
- Update/delete targeting:
  - `memoryId` (optional if known)
  - search hints: `searchText` / `query` / `text` / `content` depending on operation

## Entity resolution contract (semantic → IDs)

### Entity resolver

- `SecondBrainEntityResolver`: `Memo_v2/src/services/resolution/SecondBrainEntityResolver.ts`

### When resolution happens

Resolution applies to operations that need a specific memory target:

`operation ∈ ['updateMemory', 'deleteMemory', 'getMemoryById']`

It resolves a semantic query into:
- `memoryId` (single)
- or `memoryIds` (when multiple selection is allowed, typically delete)

### HITL behavior (disambiguation)

If multiple candidates match:
- Resolver returns `type: 'disambiguation'`
- `allowMultiple` is true for delete, false for update
- HITL asks the user to choose one (or “all/both” when allowed)

## Execution contract (adapters)

### Executor dispatch

- `ExecutorNode` (`capability: 'second-brain'`) calls `SecondBrainServiceAdapter(userPhone).execute(args)`.

### Adapter

- `Memo_v2/src/services/adapters/SecondBrainServiceAdapter.ts`

## Response formatting/writer behavior

- Uses generic formatter + writer behavior; any capability-specific phrasing rules live in `src/config/response-formatter-prompt.ts`.

