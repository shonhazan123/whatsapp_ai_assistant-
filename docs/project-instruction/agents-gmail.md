## Gmail Agent (`gmailOperations`)

### High-Level Role

The Gmail agent is the **exclusive interface to the user’s Gmail account**. It reads, searches, and manipulates email, and can compose/send/reply/forward messages using `gmailOperations`.

It is responsible for **email workflows only**. It does not manage calendar, tasks, or generic reminders.

---

### What the Gmail Agent CAN Do

- **Read & search mail**
  - Search inbox (and other labels) by:
    - Sender, recipient (`from`, `to`).
    - Subject.
    - Labels (e.g., “INBOX”, “Starred”).
    - Time ranges (e.g., “last week”, “today”).
  - List threads/messages and fetch full bodies.
- **Compose & send**
  - Create **new messages** with `to`/`cc`/`bcc`, `subject`, `body`.
  - Include links or structured text from other agents (calendar events, tasks, etc.).
- **Reply & forward**
  - Reply to existing threads/messages, maintaining quoting/context.
  - Forward messages to new recipients.
- **Manage mailbox**
  - Apply/remove labels.
  - Archive, delete, move messages between labels/folders.
  - Mark as read/unread.
- **Attachment handling (when implemented)**
  - Summarize attachments or include them in outgoing mails by referencing underlying services.

---

### What the Gmail Agent CANNOT / MUST NOT Do

- **No calendar event creation** – if a user asks to “schedule a meeting”, that’s the calendar agent.
- **No generic reminder/list management** – tasks and lists belong to the database agent.
- **No storing long-term knowledge** – unstructured memory is handled by the second-brain agent.
- **No fabrication of email addresses or message IDs** – addresses must come from user, contact DB, or existing messages; IDs must be actual Gmail IDs.
- **No promises without API calls** – it must not say “email sent” unless `GmailService` confirms success.

---

### Operations & Execution Flow

#### Execution Path

1. Intent classifier decides Gmail is needed (or orchestrator chooses Gmail for part of a plan).
2. `GmailAgent` calls `executeWithAI` with:
   - `systemPrompt = SystemPrompts.getGmailAgentPrompt()`.
   - `functions = [gmailOperations]` from `GmailFunctions`.
3. LLM chooses `gmailOperations` + JSON arguments.
4. `GmailFunctions.execute` maps operation to a **`GmailService`** method.
5. Gmail API (OAuth) is called, a uniform `IResponse` is returned.
6. Second LLM call turns raw result into user-facing WhatsApp text.

#### Typical `operation` Types (conceptual)

Exact names live in `GmailFunctions.ts`, but conceptually:

- **`search` / `list`**
  - Parameters: `query`, optional `from`, `to`, `subject`, `labels`, `timeRange`.
  - Used for: “show me all emails from John”, “search ‘invoice’ last month”.
- **`getMessage` / `getThread`**
  - Fetch a specific email or thread by ID.
- **`send`**
  - Compose + send new email.
  - Parameters: `to`/`cc`/`bcc`, `subject`, `body`, optional attachments/links.
- **`reply`**
  - Reply to an existing message/thread by ID; includes prior context if desired.
- **`forward`**
  - Forward an existing message/thread to new recipients.
- **`label` / `archive` / `delete` / `markRead` / `markUnread`**
  - Mailbox management operations; can apply to single or multiple messages by IDs/queries.

> When updating or adding operations, always update both `GmailFunctions` and the Gmail section in `SystemPrompts` so the LLM knows how to call them.

---

### Parameters & Behavior

- **Message identification**
  - Prefer using Gmail `messageId` or `threadId` when possible.
  - For natural-language references (“the last email from John”), use search first, then identify which message/thread to operate on.

- **Composing messages**
  - Gmail agent should:
    - Use user language for body content.
    - Respect tone (formal/informal) based on user phrasing or explicit instructions.
    - Include relevant data from other agents (calendar time, task list) only when instructed.

- **Label & state changes**
  - Label operations should be idempotent – applying an already-applied label is fine.
  - Delete/archive operations should be considered **destructive** and, when ambiguous, preceded by clarification (“do you want to delete ALL X?”).

---

### Error Handling & Safeguards

- Gmail requires:
  - **Google connection** in `RequestContext` (`googleConnected`).
  - Plan capabilities that enable Gmail features.
- On failure:
  - `GmailService` returns `{ success: false, error: '...' }`.
  - Agent must not claim the email was sent or deleted; instead, it should produce a friendly error.
- Validation:
  - No sending to obviously malformed addresses.
  - No attachment references that don’t exist in context.

---

### Example Flows

- **“Show me all emails from Dana last week”**
  - Agent → `gmailOperations` `search` with `from: "Dana"`, `timeRange: lastWeek`.
  - Returns a list of subjects/snippets and offers “reply to #1, open #2”, etc.

- **“Reply to the last email from John and say thanks”**
  - Step 1: search (or rely on recent context) to locate last message from John.
  - Step 2: `reply` with `threadId` or `messageId` and body “thanks …”.

- **“Delete all promotional emails today”**
  - Step 1: search with query/label “promotions” + time range = today.
  - Step 2: `delete` by message IDs; may ask for confirmation if the set is large.

---

### When NOT to Use Gmail Agent

- Scheduling meetings or blocking time → calendar agent.
- Storing a note about an email without follow-up → second-brain agent.
- Managing tasks/“to-dos” that happen to be mentioned in an email → database agent.


