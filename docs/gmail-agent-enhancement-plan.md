## Gmail Agent Enhancement Plan

### Overview

Goal: deliver a Gmail agent that can (1) retrieve latest emails using natural-language filters, (2) list multiple recent emails with progressive disclosure, (3) read full content when the user clarifies, and (4) compose, preview, and send/reply within existing threads with explicit user confirmation. This plan breaks the work into four phases to minimise risk and keep testing focused.

---

## Phase 1 — Service Layer Foundations

**Objective:** Upgrade `GmailService` so higher layers can request rich email data and safely send replies in the correct threads.

**Scope & Tasks**
- Extend request/response models in `GmailService.ts` (filters: `from`, `subjectContains`, `query`, `maxResults`, `labelIds`, `includeBody`, `includeThread`, `threadId`).
- Implement helper to compose Gmail search queries (`buildQuery({from, subjectContains, textContains, labelIds})`).
- Add `getLatestEmail`, `getLatestByFilter`, `listEmails` utilities (with sorting, pagination, decoding full payloads, returning plain-text + HTML variants, header metadata, `internalDate`).
- Enhance payload decoding (handle multipart, convert base64url, extract both `text/plain` and `text/html`; capture attachments metadata for future use).
- Provide thread helpers: `getThreadMessages(threadId, limit)`, return ordered messages with authorship.
- Update `sendEmail` & `replyToEmail` to support draft previews, `threadId`, `inReplyTo`, `references`, and to expose confirmation-specific output (recipients, subject, body).
- Add resilient logging + error classification (not-found, auth, quota) for downstream user messaging.

**Deliverables**
- Updated service types and helpers with unit tests/mocked Gmail responses.
- Documented service contract (inline JSDoc + short README snippet).

**Dependencies**
- Existing Gmail API auth configuration; confirm OAuth scopes include read/write.

**Testing Notes**
- Write Jest tests with fixtures for multipart messages.
- Create integration test harness using recorded Gmail API responses if live access unavailable.

---

## Phase 2 — Function Layer & Agent Workflow

**Objective:** Expose the new capabilities via `GmailFunction` and orchestrate confirmation flows in `GmailAgent`.

**Scope & Tasks**
- Update `GmailFunction` parameters schema (operations: `getLatest`, `searchLatest`, `listRecent`, `readByIndex`, `send`, `reply`, `replyInThread`, `confirmSend`).
- Import `logger` correctly; introduce shared validation helpers (email format, required fields).
- Implement multi-result responses: when returning lists, include structured summary array plus context tokens for follow-up (e.g., store cached result in memory service).
- Integrate `QueryResolver` for natural-language disambiguation (sender names, subject phrases, thread references).
- Introduce preview/confirmation flow: `send`/`reply` first produce `draft` response with `requiresConfirmation`; new `confirmSend` operation executes after user approval.
- Update `GmailAgent` to manage conversational state (store last email list, awaiting confirmation flag, thread context). Ensure responses mirror user language and include clarity when more info is needed.
- Ensure agent logs every step for observability.

**Deliverables**
- Refactored `GmailFunction` and `GmailAgent`.
- Conversation state utilities or integration with existing memory module (`ConversationWindow`).

**Dependencies**
- Phase 1 service methods ready; memory system accessible.

**Testing Notes**
- Add unit tests for function branching logic and validation.
- Simulate agent conversations (mock OpenAI completions) validating preview-confirm-send lifecycle.

---

## Phase 3 — Prompt & UX Refinement

**Objective:** Align system prompts and user messaging with new capabilities, ensuring LLM consistently triggers correct operations.

**Scope & Tasks**
- Expand `SystemPrompts.getGmailAgentPrompt()` with explicit instructions:
  - Recognise intents “latest email”, “last email from X”, “list last N”, “read email number Y”, “reply in same thread”.
  - Mandate draft confirmation before sending or replying.
  - Describe list-vs-detail responses (subjects first, then body on request).
  - Reinforce language mirroring and thread continuity rules.
- Add examples covering new flows (list + refine, reply confirmation, thread continuation).
- Review other prompts to ensure compatibility (Main agent routing).

**Deliverables**
- Updated prompt text with examples and rules.
- Internal docs describing new user experience patterns.

**Dependencies**
- Function names & responses finalised (Phase 2).

**Testing Notes**
- Run prompt-based regression (manual or automated) to ensure model chooses correct operations.
- Validate bilingual responses (Hebrew/English).

---

## Phase 4 — QA, Tooling & Release Prep

**Objective:** Final verification, regression protection, and documentation.

**Scope & Tasks**
- End-to-end scenarios:
  - “What's my latest email?” → snippet → “read it” → body shown.
  - “What's the last email from Dana?” → detailed response.
  - “What are the last 10 emails?” → list subjects → user selects → content.
  - “Respond to the last email with …” → preview → confirmation → send.
  - “Respond in the thread with AirDNA regarding the refund …” → thread lookup → preview.
  - Negative paths (no matches, auth errors) with graceful feedback.
- Performance/Quota checks, ensure batching limits followed.
- Update README/docs with usage guidance and developer runbook.
- Prepare migration notes (API scopes, environment variables).

**Deliverables**
- Passing test suite; QA sign-off checklist.
- Release notes outlining new Gmail agent functionality.

**Dependencies**
- Prior phases complete; staging Gmail account available for manual QA.

**Testing Notes**
- Prefer automated integration tests where possible; supplement with manual verification for multi-step conversation flows.

---

## Next Steps

1. Kick off **Phase 1 — Service Layer Foundations** (detailed below).  
2. After Phase 1 merges, proceed sequentially through Phases 2–4, ensuring each phase’s deliverables are validated before moving forward.

### Phase 1 Execution Outline

- [ ] Audit existing `GmailService` methods; sketch new interfaces (`EmailSummary`, `EmailDetail`, `ThreadSummary`).  
- [ ] Implement query builder & filter mapping.  
- [ ] Add latest/list methods, payload decoding, thread helpers.  
- [ ] Refactor send/reply for draft preview support.  
- [ ] Write/update tests & documentation.


