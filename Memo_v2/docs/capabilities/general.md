# General capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Informative capability only. Answer questions about the **user** (name, account, capabilities), about **what the assistant did** (last/recent actions, created missions/tasks/events), and **acknowledgments** (thank you, okay). Not for general knowledge or open-ended advice.
- **Boundaries**:
  - Answer only from provided context (LatestActions, user profile, recent messages). Refuse politely when the question is outside program/user state.
  - No external side effects.
  - Executor simply returns the resolver args as data (no adapter).

## Context

- General resolver is provided with **all LatestActions**, **user** (name, capabilities, language, timezone, plan, connected services), and **recent message context** so it can answer "what's my name?", "did you create X?", "what are the recent things you created?" and acknowledgments.

## ResolverSchema entry (planner routing contract)

- `GENERAL_SCHEMA` (`capability: "general"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract

### Resolver

- `GeneralResolver`: `Memo_v2/src/graph/resolvers/GeneralResolver.ts`

### Actions/args

Resolver supports `step.action ∈ ['respond', 'greet', 'acknowledge', 'ask_about_recent_actions', 'ask_about_user', 'ask_about_what_i_did', 'clarify', 'unknown', 'greeting response', 'process request']`.

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

