# General capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Handle conversational responses that do not require tool execution (greetings, clarifications, general chat).
- **Boundaries**:
  - No external side effects.
  - Executor simply returns the resolver args as data (no adapter).

## ResolverSchema entry (planner routing contract)

- `GENERAL_SCHEMA` (`capability: "general"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract

### Resolver

- `GeneralResolver`: `Memo_v2/src/graph/resolvers/GeneralResolver.ts`

### Actions/args

Resolver supports `step.action ∈ ['respond', 'greet', 'clarify', 'acknowledge', 'unknown']`.

Resolver returns `type: 'execute'` with args that include:
- `action`
- `response` (string)
- `language` (`'he' | 'en'`)

## Entity resolution contract

- No entity resolution is performed for general capability steps.

## Execution contract

- `ExecutorNode` treats `capability ∈ ['general','meta']` as “no external call needed” and returns `{ success: true, data: args }`.

Source: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

## Response formatting/writer behavior

- General responses flow through the same `ResponseFormatterNode` / `ResponseWriterNode` pipeline.
- Writer tone/UX rules are governed by `src/config/response-formatter-prompt.ts`.

