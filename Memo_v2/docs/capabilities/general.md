# General capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Single informative capability. Answer questions about the **user** (name, account, capabilities), about **what the assistant did** (last/recent actions), **acknowledgments** (thank you, okay), **and** about the **agent** (identity, capabilities, help, status, plan/pricing, website). One resolver, one context, one prompt. Not for general knowledge or open-ended advice.
- **Boundaries**:
  - Answer only from provided context (user profile, latest actions, recent conversation, agent info, plan tiers). Refuse politely when the question is outside program/user state.
  - No external side effects. Must not expose internal implementation details. Never guess — if data is missing, say so.
  - Executor returns resolver args as data (no adapter).

## Canonical sources of truth

| Source | What it provides |
|--------|------------------|
| `Memo_v2/src/config/meta-info.ts` | Agent name, description, website URL, help links |
| `Memo_v2/src/config/plan-tiers.ts` | Subscription tier pricing and included features |
| `MemoState.user` | Name, plan tier, googleConnected, capabilities, language, timezone |
| State (latestActions, recentMessages) | What the assistant did, recent conversation |

## ResolverSchema entry (planner routing contract)

- `GENERAL_SCHEMA` (`capability: "general"`) — only schema for this domain; includes former meta action hints and trigger patterns.

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract

### Resolver

- `GeneralResolver`: `Memo_v2/src/graph/resolvers/GeneralResolver.ts`

### Actions

Resolver supports all of: `respond`, `greet`, `acknowledge`, `ask_about_recent_actions`, `ask_about_user`, `ask_about_what_i_did`, `clarify`, `unknown`, `greeting response`, `process request`, `describe_capabilities`, `what_can_you_do`, `help`, `status`, `website`, `about_agent`, `plan_info`, `account_status`.

### Context

One unified `buildUserMessage`: current time, clarification (if any), latest actions, user block, **agent information** (meta-info), **subscription plans** (plan-tiers), user account summary, recent conversation, user message and action hint.

### Output

Resolver returns `type: 'execute'` with args:
- `action`
- `response` (string)
- `language` (`'he' | 'en'`)

## Entity resolution contract

- No entity resolution is performed for general capability steps.

## Execution contract

- `ExecutorNode` treats `capability === 'general'` as “no external call needed” and returns `{ success: true, data: args }`.
- `GeneralExecutor`: `Memo_v2/src/graph/executors/GeneralExecutor.ts`

Source: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

## Response formatting/writer behavior

- General responses flow through `ResponseFormatterNode` / `ResponseWriterNode`; writer uses `data.response` directly (no additional LLM call).
- Tone/UX rules: `src/config/response-formatter-prompt.ts`.
