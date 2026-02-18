# Meta capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Answer questions about Memo (agent identity, capabilities, help, links) **and** about the user's account (plan tier, pricing/features, Google connection, enabled capabilities).
- **Boundaries**:
  - No external side effects (no DB writes, no API calls).
  - Must not expose internal implementation details (file paths, env var names, code internals).
  - Must never guess — if data is missing from the canonical config, say so.

## Canonical sources of truth

| Source | What it provides |
|--------|-----------------|
| `Memo_v2/src/config/meta-info.ts` | Agent name, description, website URL, help links |
| `Memo_v2/src/config/plan-tiers.ts` | Subscription tier pricing and included features |
| `MemoState.user` | Current plan tier, googleConnected, capabilities, language, timezone |
| `MemoState.authContext` (optional) | Additional connection details if needed |

## ResolverSchema entry (planner routing contract)

- `META_SCHEMA` (`capability: "meta"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Graph routing

Meta flows through the **normal pipeline** (same as all other capabilities):

```text
planner → capability_check → hitl_gate → resolver_router → entity_resolution → executor → join → response_formatter → response_writer
```

The planner always emits exactly **one** meta step when `intentType === 'meta'`.

## Resolver output contract

### Resolver

- `MetaResolver`: `Memo_v2/src/graph/resolvers/GeneralResolver.ts` (**LLM-based resolver**)

### Actions

`step.action ∈ ['describe_capabilities', 'what_can_you_do', 'help', 'status', 'website', 'about_agent', 'plan_info', 'account_status']`

### How it works

MetaResolver makes **one LLM call** with a system prompt + a user message containing:
- Agent meta-info (from `meta-info.ts`)
- Plan tier definitions (from `plan-tiers.ts`)
- User state (from `MemoState.user`)
- The user's original question

The LLM produces the **final user-facing message** (already formatted for WhatsApp).

### Output

Resolver returns `type: 'execute'` with args:
- `response` (string) — the final WhatsApp-formatted message
- `language` (`'he' | 'en'`)
- `isMetaFinal: true`

## Entity resolution contract

- No entity resolution is performed for meta steps.

## Execution contract

- `ExecutorNode` treats `capability ∈ ['general', 'meta']` as "no external call needed" and returns `{ success: true, data: args }`.

## Response formatting/writer behavior

- `ResponseFormatterNode`: packages meta output with minimal handling (no date/task formatting).
- `ResponseWriterNode`: detects `agent === 'meta'` and uses `data.response` **directly** — **no additional LLM call**.

## LLM model

- Configurable via `LLM_RESOLVER_META_MODEL` env var (defaults to `gpt-4o-mini`).
