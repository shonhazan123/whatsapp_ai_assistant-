# Capability Contracts (Memo_v2)

Each file in this folder is a **contract** for a capability, describing how it works end-to-end in the current architecture:

Planner step → resolver args → entity resolution → `executorArgs` → adapter execution → formatter/writer behavior.

If a contract doc contradicts code, **code wins** and the doc must be updated.

## Required sections (per capability file)

- **Purpose + boundaries**
- **ResolverSchema entries** (names + actionHints/examples references)
- **Resolver output contract** (actions + args shape)
- **Entity resolution contract** (which actions need IDs, HITL disambiguation rules, `executorArgs` shape)
- **Executor/adapter contract** (adapter file + execute dispatch, special behavior)
- **Response formatting/writer behavior** (what shows up in user response, failure rules)
- **Examples** (1–2 realistic end-to-end examples)

## Canonical references

- `Memo_v2/src/graph/resolvers/ResolverSchema.ts`
- `Memo_v2/docs/RESOLVER_SPECS.md`
- `Memo_v2/docs/RESOLVER_ROUTER_FLOW.md`
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- `Memo_v2/docs/PLANNER_AND_HITL_FLOW.md`
- `Memo_v2/docs/STATE_SCHEMA.md`

