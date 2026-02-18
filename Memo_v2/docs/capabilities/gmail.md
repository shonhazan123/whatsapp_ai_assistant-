# Gmail capability contract (Memo_v2)

## Purpose + boundaries

- **Purpose**: Read and send/answer emails using the connected Google account.
- **Boundaries**:
  - Requires Gmail connection (`authContext` + `CapabilityCheckNode`).
  - Execution is performed via `GmailServiceAdapter` (V1 GmailService wrapper).

## ResolverSchema entry (planner routing contract)

- `GMAIL_SCHEMA` (`capability: "gmail"`)

Source: `Memo_v2/src/graph/resolvers/ResolverSchema.ts`

## Resolver output contract (semantic args)

### Resolver

- `GmailResolver`: `Memo_v2/src/graph/resolvers/GmailResolver.ts`

### Operations (current)

`args.operation ∈ ['listEmails', 'getLatestEmail', 'getEmailById', 'sendPreview', 'sendConfirm', 'replyPreview', 'replyConfirm', 'markAsRead', 'markAsUnread']`

Common fields:
- Read/list: `filters` (from/to/subjectContains/textContains/labelIds/maxResults/includeBody)
- Targeting: `messageId` (optional if known), `selectionIndex` (optional)
- Send/reply: `to[]`, `cc[]`, `bcc[]`, `subject`, `body`

## Entity resolution contract (semantic → IDs)

### Entity resolver

- `GmailEntityResolver`: `Memo_v2/src/services/resolution/GmailEntityResolver.ts`

### When resolution happens

Resolution applies to operations that require a concrete `messageId`:

`operation ∈ ['getEmailById', 'replyPreview', 'replyConfirm', 'markAsRead', 'markAsUnread']`

Resolution strategies:
- Use `args.messageId` directly if already present
- Use `args.selectionIndex` (when the user refers to a numbered email from a prior list)
- Otherwise, search/fuzzy-match by hints in filters and ask HITL if ambiguous

### What gets produced

`EntityResolutionNode` writes `state.executorArgs.get(stepId)` with:
- `messageId`

### HITL behavior (disambiguation)

If multiple candidates match, `GmailEntityResolver` returns `type: 'disambiguation'` and HITL asks the user to pick one.

## Execution contract (adapters)

### Executor dispatch

- `ExecutorNode` (`capability: 'gmail'`) constructs `GmailServiceAdapter(authContext)` and calls `execute(args)`.

Source: `Memo_v2/src/graph/nodes/ExecutorNode.ts`

### Adapter

- `GmailServiceAdapter`: `Memo_v2/src/services/adapters/GmailServiceAdapter.ts`

Adapter operation support (must match resolver):
- `listEmails`, `getLatestEmail`, `getEmailById`
- `sendPreview`, `sendConfirm`
- `replyPreview`, `replyConfirm`
- `markAsRead`, `markAsUnread`

## Response formatting/writer behavior

- `ResponseFormatterNode` consumes execution results and formats email lists/details into user-friendly context.
- `ResponseWriterNode` produces the final message.

Canonical references:
- `Memo_v2/docs/RESPONSE_DATA_PATTERNS.md`
- `src/config/response-formatter-prompt.ts`

