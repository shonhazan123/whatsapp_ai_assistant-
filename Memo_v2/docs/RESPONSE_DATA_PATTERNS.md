# Response Data Patterns

> Documentation for the data structures returned by ServiceAdapters and how ResponseFormatterNode handles them.
>
> **Purpose**: Ensure developers understand the expected response formats when adding new operations.

---

## Overview

The `ResponseFormatterNode` receives data from various ServiceAdapters through executors. Each adapter may return data in different formats depending on the operation:

- **Wrapped in object**: `{ events: [...], count: N }`
- **Single item**: `{ id, summary, start, ... }`
- **Array directly**: `[{ id, ... }, { id, ... }]`
- **Bulk operation result**: `{ deleted: N, events: [...], errors: [...] }`

The `extractItemsArray()` and `extractMetadata()` utilities in `ResponseFormatterNode` normalize these into a consistent format for context extraction.

---

## Data Flow

```
ServiceAdapter → Executor → ResponseFormatterNode
                              ├── extractItemsArray() → items[]
                              └── extractMetadata() → { deleted, errors, ... }
                                        ↓
                              Context Extractors
                                        ↓
                              ResponseContext
```

---

## Calendar Operations

### getEvents

**Raw Response:**
```typescript
{
  events: [
    { id, summary, start, end, attendees, description, location, recurringEventId },
    // ... more events
  ],
  count: 4
}
```

**After extractItemsArray:**
```typescript
[
  { id, summary, start, end, attendees, description, location, recurringEventId },
  // ... more events
]
```

### create

**Raw Response:**
```typescript
{
  id: "abc123",
  summary: "Meeting",
  start: "2026-01-20T10:00:00+02:00",
  end: "2026-01-20T11:00:00+02:00",
  htmlLink: "https://calendar.google.com/..."
}
```

**After extractItemsArray:**
```typescript
[{ id: "abc123", summary: "Meeting", start: "...", end: "...", htmlLink: "..." }]
```

### createRecurring

**Raw Response:**
```typescript
{
  id: "abc123",
  summary: "Weekly Meeting",
  days: ["Monday", "Wednesday"],
  startTime: "09:00",
  endTime: "10:00",
  recurrence: "weekly"
}
```

**After extractItemsArray:**
```typescript
[{ id: "abc123", summary: "Weekly Meeting", days: [...], startTime: "...", endTime: "...", recurrence: "weekly" }]
```

### update

**Raw Response:**
```typescript
{
  id: "abc123",
  summary: "Updated Meeting",
  start: "2026-01-20T14:00:00+02:00",
  end: "2026-01-20T15:00:00+02:00",
  isRecurringSeries: true  // If updating entire series
}
```

**Metadata extracted:**
```typescript
{ isRecurringSeries: true }
```

### delete

**Raw Response:**
```typescript
{
  summary: "Deleted Event",
  start: "2026-01-20T10:00:00+02:00",
  isRecurringSeries: true  // If deleting entire series
}
```

### deleteByWindow

**Raw Response:**
```typescript
{
  deleted: 3,
  eventIds: ["id1", "id2", "id3"],
  summaries: ["Event 1", "Event 2", "Event 3"],
  events: [
    { id: "id1", summary: "Event 1", start: "...", end: "..." },
    // ... more
  ],
  errors: [{ eventId: "id4", error: "Not found" }]
}
```

**Metadata extracted:**
```typescript
{ deleted: 3, errors: [...], summaries: [...] }
```

### updateByWindow

**Raw Response:**
```typescript
{
  updated: 2,
  events: [
    { id: "id1", summary: "Event 1", start: "...", end: "..." },
    // ... more
  ],
  errors: []
}
```

**Metadata extracted:**
```typescript
{ updated: 2, errors: [] }
```

---

## Database Operations (Tasks)

### getAll

**Raw Response:**
```typescript
{
  tasks: [
    { id, text, category, due_date, reminder_recurrence, completed, created_at },
    // ... more tasks
  ]
}
// OR directly as array:
[
  { id, text, category, due_date, reminder_recurrence, completed, created_at },
  // ... more tasks
]
```

**After extractItemsArray:**
```typescript
[{ id, text, category, due_date, ... }, ...]
```

### create

**Raw Response:**
```typescript
{
  id: "task123",
  text: "Buy groceries",
  category: "shopping",
  due_date: "2026-01-21T10:00:00+02:00",
  completed: false,
  created_at: "2026-01-20T08:00:00+02:00"
}
```

**After extractItemsArray:**
```typescript
[{ id: "task123", text: "Buy groceries", ... }]
```

### createMultiple

**Raw Response:**
```typescript
{
  created: [
    { id: "task1", text: "Task 1", ... },
    { id: "task2", text: "Task 2", ... }
  ],
  errors: []
}
```

**After extractItemsArray:**
```typescript
[{ id: "task1", text: "Task 1", ... }, { id: "task2", text: "Task 2", ... }]
```

### deleteMultiple

**Raw Response:**
```typescript
{
  deleted: 2,
  tasks: [
    { id: "task1", text: "Task 1" },
    { id: "task2", text: "Task 2" }
  ],
  notFound: ["Task 3"],
  errors: []
}
```

**Metadata extracted:**
```typescript
{ deleted: 2, notFound: ["Task 3"], errors: [] }
```

### update / complete / delete

**Raw Response:**
```typescript
{
  id: "task123",
  text: "Updated task",
  completed: true,
  // ... other fields
}
```

---

## Database Operations (Lists)

### getAll (lists)

**Raw Response:**
```typescript
{
  lists: [
    { id, name, is_checklist, items, created_at },
    // ... more lists
  ]
}
// OR directly as array
```

### create (list)

**Raw Response:**
```typescript
{
  id: "list123",
  name: "Shopping List",
  is_checklist: true,
  items: []
}
```

---

## Gmail Operations

### listEmails

**Raw Response:**
```typescript
{
  emails: [
    { messageId, threadId, from, to, subject, body, date },
    // ... more emails
  ]
}
// OR:
{
  messages: [...]
}
```

### sendPreview

**Raw Response:**
```typescript
{
  messageId: "msg123",
  to: ["recipient@example.com"],
  subject: "Hello",
  body: "...",
  preview: true
}
```

### sendConfirm / reply

**Raw Response:**
```typescript
{
  messageId: "msg123",
  threadId: "thread456",
  to: ["recipient@example.com"],
  subject: "Re: Hello"
}
```

---

## Second Brain Operations

### searchMemory

**Raw Response:**
```typescript
[
  { id: "mem1", text: "Memory content", similarity: 0.85, metadata: {...} },
  { id: "mem2", text: "Another memory", similarity: 0.72, metadata: {...} }
]
// OR:
{
  results: [...]
}
```

### storeMemory

**Raw Response:**
```typescript
{
  id: "mem123",
  text: "Stored content",
  metadata: { tags: ["work"], source: "user" }
}
```

---

## Adding New Operations

When adding a new operation to any capability, ensure:

1. **Response follows known patterns**: Either return data wrapped in a known key (`events`, `tasks`, `emails`, etc.) or as a single item with identifying fields (`id`, `summary`, `text`, `messageId`).

2. **Bulk operations include metadata**: If the operation affects multiple items, include `deleted`, `updated`, or `count` fields at the top level.

3. **Errors are captured**: For bulk operations, include an `errors` array with items like `{ id: "...", error: "..." }`.

4. **Update extractItemsArray if needed**: If your response uses a new wrapper key, add it to the switch statement in `ResponseFormatterNode.extractItemsArray()`.

5. **Update extractMetadata if needed**: If your response includes new metadata fields that should be preserved, add them to `ResponseFormatterNode.extractMetadata()`.

---

## Utility Methods Reference

### extractItemsArray(data, capability)

Extracts an array of items from various response structures:

```typescript
private extractItemsArray(data: any, capability: string): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;

  switch (capability) {
    case 'calendar':
      if (data.events) return Array.isArray(data.events) ? data.events : [data.events];
      break;
    case 'database':
      if (data.tasks) return Array.isArray(data.tasks) ? data.tasks : [data.tasks];
      if (data.lists) return Array.isArray(data.lists) ? data.lists : [data.lists];
      if (data.created) return Array.isArray(data.created) ? data.created : [data.created];
      break;
    case 'gmail':
      if (data.emails) return Array.isArray(data.emails) ? data.emails : [data.emails];
      if (data.messages) return Array.isArray(data.messages) ? data.messages : [data.messages];
      break;
    case 'second-brain':
      if (data.results) return Array.isArray(data.results) ? data.results : [data.results];
      if (data.memories) return Array.isArray(data.memories) ? data.memories : [data.memories];
      break;
  }

  // Single item with known identifier fields - wrap in array
  if (data.id || data.summary || data.text || data.messageId) {
    return [data];
  }

  return [];
}
```

### extractMetadata(data)

Extracts metadata from bulk operation responses:

```typescript
private extractMetadata(data: any): Record<string, any> {
  if (!data || Array.isArray(data)) return {};

  const meta: Record<string, any> = {};

  if (typeof data.deleted === 'number') meta.deleted = data.deleted;
  if (typeof data.updated === 'number') meta.updated = data.updated;
  if (typeof data.count === 'number') meta.count = data.count;
  if (data.errors) meta.errors = data.errors;
  if (data.notFound) meta.notFound = data.notFound;
  if (data.isRecurringSeries !== undefined) meta.isRecurringSeries = data.isRecurringSeries;
  if (data.summaries) meta.summaries = data.summaries;

  return meta;
}
```

---

_See also: [RESOLVER_SPECS.md](./RESOLVER_SPECS.md) for resolver output formats._
