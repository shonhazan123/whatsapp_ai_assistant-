# Request serialization (per user)

The webhook layer enforces **one request at a time per user**. This prevents the graph from being invoked concurrently for the same user when they send multiple messages before the agent has responded.

## Behavior

- **Same user, concurrent messages:** If the user sends a second message while the first is still being processed, the second request does **not** invoke the graph. The user immediately receives the busy message: *"אני יכולה להתמודד עם בקשה אחת כל פעם , רק שניה 😅"*. When the first request completes (success or error), the lock is released and the next message from that user can be processed.
- **Different users:** Requests from different users are independent; no cross-user blocking.

## Implementation

- **Lock:** `Memo_v2/src/services/concurrency/UserRequestLock.ts` — `runExclusive(userPhone, fn)`:
  - If the user has no in-flight request: marks the user as busy, runs `fn()`, and clears the user in `finally` (so the lock is always released on success or throw).
  - If the user is already busy: returns `{ status: 'rejected', reason: 'busy' }` without running `fn`.
- **Usage:** `Memo_v2/src/routes/webhook.ts` wraps the text path (graph invocation), audio path (transcribe + graph), and image path (download + analyze + send) in `runExclusive`. When the result is `rejected`, the webhook sends the busy message and ends performance tracking; the graph is not invoked.

## Related

- Repo-root flow doc: `docs/project-instruction/orchestrator-and-flows.md` — section "Per-user request serialization".
