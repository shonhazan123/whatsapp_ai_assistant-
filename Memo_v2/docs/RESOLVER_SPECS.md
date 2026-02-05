# Memo V2 — Resolver Specifications

> Detailed specifications for each Resolver node
>
> **Updated**: Based on V1 system prompts from `src/config/system-prompts.ts`

---

## Overview

Resolvers convert **PlanStep** objects (semantic actions) into **tool call arguments** (concrete API calls).

Each Resolver:

- Has a **fixed, cacheable system prompt** (based on V1 proven patterns)
- Receives a **schema slice** (not the full schema)
- Uses **QueryResolver** for entity lookup (text-based, never IDs from user)
- Outputs either `execute` or `clarify`
- **Never talks to the user directly**
- **Never knows about other capabilities**
- **Supports Hebrew and English** (mirrors user's language)

---

## Key V1 Rules Incorporated

### Database/Task Resolvers

- Database agent handles **REMINDERS only** (not general tasks)
- **NUDGE vs DAILY**: "כל X דקות" → nudge, "כל יום ב-X" → daily
- **"In X minutes"** (עוד X דקות / remind me in X minutes): resolver outputs `dueDate` = current time + X (ISO with timezone) and `reminder: "0 minutes"` so the task has a due date.
- **reminderRecurrence**: `{ type, time, days, interval, dayOfMonth, until }`
- **Completion = Deletion** for reminder tasks (V1 behavior)
- Lists require explicit "list"/"רשימה" keyword

### Calendar Resolvers

- Calendar handles **ALL time-based tasks/events** (even without "calendar" keyword)
- **Event reminders** (`reminderMinutesBefore`) ≠ standalone reminders
- **All-day multi-day events**: `allDay: true`, date format `YYYY-MM-DD`
- **searchCriteria + updateFields** pattern for updates (never use eventId from user)
- **Forward-looking** for day-of-week references
- **Recurring**: Weekly uses day NAMES, Monthly uses numeric STRING (e.g., `["10"]`)

---

## Resolver Registry

| Resolver               | Capability   | Actions                                                                               | LLM? |
| ---------------------- | ------------ | ------------------------------------------------------------------------------------- | ---- |
| CalendarFindResolver   | calendar     | get, getEvents, checkConflicts, getRecurringInstances, analyze_schedule               | ✅   |
| CalendarMutateResolver | calendar     | create, createMultiple, createRecurring, createMultipleRecurring, update, delete, ... | ✅   |
| DatabaseTaskResolver   | database     | create, createMultiple, get, getAll, update, updateMultiple, delete, deleteAll, ...   | ✅   |
| DatabaseListResolver   | database     | create, get, getAll, update, delete, addItem, toggleItem, deleteItem                  | ✅   |
| GmailResolver          | gmail        | listEmails, getEmailById, sendPreview, sendConfirm, reply, forward, archive, delete   | ✅   |
| SecondBrainResolver    | second-brain | storeMemory, searchMemory, getMemoryById, updateMemory, deleteMemory                  | ✅   |
| GeneralResolver        | general      | respond (conversational, no tools)                                                    | ✅   |
| MetaResolver           | meta         | describe_capabilities, help (template-based, no LLM)                                  | ❌   |

---

## CalendarFindResolver

### Purpose

Convert calendar search/read PlanSteps into `calendarOperations` arguments.

### Actions Handled

- `find_event` → `{ operation: 'get', ... }`
- `list_events` → `{ operation: 'getEvents', timeMin, timeMax }`
- `check_conflicts` → `{ operation: 'checkConflicts', timeMin, timeMax }`
- `get_recurring` → `{ operation: 'getRecurringInstances', eventId }`

### Schema Slice

```typescript
const calendarFindSchema = {
	name: "calendarOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: ["get", "getEvents", "checkConflicts", "getRecurringInstances"],
			},
			eventId: { type: "string" },
			summary: { type: "string" },
			timeMin: { type: "string" },
			timeMax: { type: "string" },
		},
		required: ["operation"],
	},
};
```

### Resolution Logic

```typescript
async function resolve(
	step: PlanStep,
	state: MemoState
): Promise<ResolverResult> {
	const { action, constraints } = step;

	switch (action) {
		case "find_event":
			// Use QueryResolver if no eventId
			if (!constraints.eventId && constraints.summary) {
				const resolved = await queryResolver.resolveOneOrAsk(
					constraints.summary,
					state.user.phone,
					"event"
				);

				if (resolved.disambiguation) {
					return {
						stepId: step.id,
						type: "clarify",
						question: formatDisambiguation(
							"event",
							resolved.disambiguation.candidates
						),
						options: resolved.disambiguation.candidates.map(
							(_, i) => `${i + 1}`
						),
					};
				}

				constraints.eventId = resolved.entity?.id;
			}

			return {
				stepId: step.id,
				type: "execute",
				functionName: "calendarOperations",
				args: { operation: "get", eventId: constraints.eventId },
			};

		case "list_events":
			// Parse time range from constraints
			const timeRange = parseTimeRange(constraints, state.now);

			return {
				stepId: step.id,
				type: "execute",
				functionName: "calendarOperations",
				args: {
					operation: "getEvents",
					timeMin: timeRange.start,
					timeMax: timeRange.end,
					excludeSummaries: constraints.excludeSummaries,
					excludeDays: constraints.excludeDays,
				},
			};

		// ... other cases
	}
}
```

---

## CalendarMutateResolver

### Purpose

Convert calendar write operations into `calendarOperations` arguments.

### Actions Handled

- `create_event` → `{ operation: 'create', summary, start, end, ... }`
- `create_recurring` → `{ operation: 'createRecurring', summary, startTime, endTime, days, ... }`
- `update_event` → `{ operation: 'update', eventId, updateFields, ... }`
- `delete_event` → `{ operation: 'delete', eventId }` or `{ operation: 'deleteBySummary', summary }`
- `end_recurring` → `{ operation: 'truncateRecurring', eventId, until }`

### Schema Slice

```typescript
const calendarMutateSchema = {
	name: "calendarOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: [
					"create",
					"createMultiple",
					"createRecurring",
					"createMultipleRecurring",
					"update",
					"delete",
					"deleteBySummary",
					"truncateRecurring",
				],
			},
			eventId: { type: "string" },
			summary: { type: "string" },
			start: { type: "string" },
			end: { type: "string" },
			allDay: { type: "boolean" },
			attendees: { type: "array", items: { type: "string" } },
			description: { type: "string" },
			location: { type: "string" },
			searchCriteria: {
				type: "object",
				properties: {
					summary: { type: "string" },
					timeMin: { type: "string" },
					timeMax: { type: "string" },
					dayOfWeek: { type: "string" },
					startTime: { type: "string" },
					endTime: { type: "string" },
				},
			},
			updateFields: {
				type: "object",
				properties: {
					summary: { type: "string" },
					start: { type: "string" },
					end: { type: "string" },
					description: { type: "string" },
					location: { type: "string" },
					attendees: { type: "array", items: { type: "string" } },
				},
			},
			isRecurring: { type: "boolean" },
			startTime: { type: "string" },
			endTime: { type: "string" },
			days: { type: "array", items: { type: "string" } },
			until: { type: "string" },
			reminderMinutesBefore: { type: ["number", "null"] },
			excludeSummaries: { type: "array", items: { type: "string" } },
		},
		required: ["operation"],
	},
};
```

### Resolution Logic Highlights

**Update Event**:

```typescript
case 'update_event':
  // Must find event first if no eventId
  if (!constraints.eventId) {
    // Use searchCriteria to find event
    const searchCriteria = {
      summary: constraints.currentSummary || constraints.summary,
      timeMin: constraints.timeMin,
      timeMax: constraints.timeMax,
      dayOfWeek: constraints.dayOfWeek,
      startTime: constraints.startTime
    };

    const found = await findEventByCriteria(searchCriteria);
    if (found.error) {
      return { stepId: step.id, type: 'clarify', question: found.error };
    }
    constraints.eventId = found.eventId;
  }

  return {
    stepId: step.id,
    type: 'execute',
    functionName: 'calendarOperations',
    args: {
      operation: 'update',
      eventId: constraints.eventId,
      searchCriteria: {/* old values */},
      updateFields: changes, // new values from step.changes
      isRecurring: constraints.isRecurring
    }
  };
```

**Delete with Exceptions**:

```typescript
case 'delete_events':
  // Support excludeSummaries for bulk delete
  return {
    stepId: step.id,
    type: 'execute',
    functionName: 'calendarOperations',
    args: {
      operation: 'delete',
      timeMin: constraints.timeMin,
      timeMax: constraints.timeMax,
      excludeSummaries: constraints.excludeSummaries
    }
  };
```

---

## DatabaseTaskResolver

### Purpose

Convert task operations into `taskOperations` arguments.

### Actions Handled

- `create_task` → `{ operation: 'create', text, dueDate, reminder, ... }`
- `create_tasks` → `{ operation: 'createMultiple', tasks: [...] }`
- `find_task` → `{ operation: 'get', taskId }` or `{ operation: 'getAll', filters }`
- `update_task` → `{ operation: 'update', taskId, ... }`
- `delete_task` → `{ operation: 'delete', taskId }`
- `complete_task` → `{ operation: 'complete', taskId }`

### Schema Slice

```typescript
const taskSchema = {
	name: "taskOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: [
					"create",
					"createMultiple",
					"get",
					"getAll",
					"update",
					"updateMultiple",
					"delete",
					"deleteMultiple",
					"deleteAll",
					"updateAll",
					"complete",
					"completeAll",
					"addSubtask",
				],
			},
			taskId: { type: "string" },
			text: { type: "string" },
			category: { type: "string" },
			dueDate: { type: "string" },
			reminder: { type: "string" },
			reminderRecurrence: {
				type: "object",
				properties: {
					type: {
						type: "string",
						enum: ["daily", "weekly", "monthly", "nudge"],
					},
					time: { type: "string" },
					interval: { type: "string" },
					days: { type: "array", items: { type: "number" } },
					dayOfMonth: { type: "number" },
					until: { type: "string" },
				},
			},
			reminderDetails: { type: "object" },
			filters: {
				type: "object",
				description: "Filters for getAll operation",
				properties: {
					completed: { type: "boolean" },
					category: { type: "string" },
					window: {
						type: "string",
						enum: ["today", "tomorrow", "this_week", "overdue", "upcoming"],
					},
					type: {
						type: "string",
						enum: ["recurring", "unplanned", "reminder"],
					},
					dueDateFrom: { type: "string" },
					dueDateTo: { type: "string" },
				},
			},
			where: {
				type: "object",
				description: "Filter for deleteAll/updateAll bulk operations",
				properties: {
					window: {
						type: "string",
						enum: ["today", "this_week", "overdue", "upcoming", "all"],
					},
					type: {
						type: "string",
						enum: ["recurring", "unplanned", "reminder"],
					},
					reminderRecurrence: { type: "string" },
				},
			},
			patch: {
				type: "object",
				description: "Fields to update for updateAll operation",
				properties: {
					dueDate: { type: "string" },
					category: { type: "string" },
					completed: { type: "boolean" },
					reminder: { type: "string" },
					reminderRecurrence: { type: "object" },
				},
			},
			tasks: { type: "array" },
			taskIds: { type: "array", items: { type: "string" } },
			updates: { type: "array" },
		},
		required: ["operation"],
	},
};
```

### Reminder vs Calendar Logic (Policy)

The Resolver applies policy rules to distinguish reminders from calendar events:

```typescript
function applyReminderPolicy(step: PlanStep, changes: Record<string, any>) {
	// Rule 1: If has reminder/nudge fields → task with reminder
	if (changes.reminder || changes.reminderRecurrence) {
		return "database"; // Task with reminder
	}

	// Rule 2: If has attendees or location → calendar event
	if (changes.attendees || changes.location) {
		return "calendar";
	}

	// Rule 3: "Remind me" phrasing → task with reminder (default 30 min)
	if (step.constraints.isReminder) {
		changes.reminder = changes.reminder || "30 minutes";
		return "database";
	}

	// Rule 4: Default based on user preference (if set)
	return step.capability;
}
```

---

## DatabaseListResolver

### Purpose

Convert list/note operations into `listOperations` arguments.

### Actions Handled

- `create_list` → `{ operation: 'create', listName, isChecklist, items }`
- `find_list` → `{ operation: 'get', listId }` or `{ operation: 'getAll', filters }`
- `update_list` → `{ operation: 'update', listId, ... }`
- `delete_list` → `{ operation: 'delete', listId }`
- `add_item` → `{ operation: 'addItem', listId, itemText }`
- `toggle_item` → `{ operation: 'toggleItem', listId, itemIndex }`
- `delete_item` → `{ operation: 'deleteItem', listId, itemIndex }`

### Schema Slice

```typescript
const listSchema = {
	name: "listOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: [
					"create",
					"createMultiple",
					"get",
					"getAll",
					"update",
					"updateMultiple",
					"delete",
					"deleteMultiple",
					"addItem",
					"toggleItem",
					"deleteItem",
				],
			},
			listId: { type: "string" },
			listName: { type: "string" },
			isChecklist: { type: "boolean" },
			content: { type: "string" },
			items: { type: "array", items: { type: "string" } },
			itemText: { type: "string" },
			itemIndex: { type: "number" },
			filters: {
				type: "object",
				properties: {
					listName: { type: "string" },
					isChecklist: { type: "boolean" },
					content: { type: "string" },
				},
			},
		},
		required: ["operation"],
	},
};
```

---

## GmailResolver

### Purpose

Convert email operations into Gmail API arguments.

### Actions Handled

- `search_emails` → `{ operation: 'search', query, maxResults }`
- `read_email` → `{ operation: 'read', emailId }`
- `compose_email` → `{ operation: 'compose', to, subject, body }`
- `send_email` → `{ operation: 'send', to, subject, body }`
- `reply_email` → `{ operation: 'reply', emailId, body }`
- `forward_email` → `{ operation: 'forward', emailId, to }`
- `label_email` → `{ operation: 'label', emailId, labels }`
- `archive_email` → `{ operation: 'archive', emailId }`
- `delete_email` → `{ operation: 'delete', emailId }`

### Schema Slice

```typescript
const gmailSchema = {
	name: "gmailOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: [
					"search",
					"read",
					"compose",
					"send",
					"reply",
					"forward",
					"label",
					"archive",
					"delete",
					"markRead",
					"markUnread",
					"star",
					"unstar",
					"createDraft",
					"sendDraft",
					"deleteDraft",
					"listDrafts",
				],
			},
			emailId: { type: "string" },
			threadId: { type: "string" },
			query: { type: "string" },
			maxResults: { type: "number" },
			to: { type: "array", items: { type: "string" } },
			cc: { type: "array", items: { type: "string" } },
			bcc: { type: "array", items: { type: "string" } },
			subject: { type: "string" },
			body: { type: "string" },
			labels: { type: "array", items: { type: "string" } },
		},
		required: ["operation"],
	},
};
```

---

## SecondBrainResolver

### Purpose

Convert knowledge/memory operations into second-brain API arguments.

### Actions Handled

- `store_thought` → `{ operation: 'store', content, tags }`
- `search_memory` → `{ operation: 'search', query, limit }`
- `update_memory` → `{ operation: 'update', memoryId, content }`
- `delete_memory` → `{ operation: 'delete', memoryId }`
- `summarize_project` → `{ operation: 'summarize', projectId }`

### Schema Slice

```typescript
const secondBrainSchema = {
	name: "memoryOperations",
	parameters: {
		type: "object",
		properties: {
			operation: {
				type: "string",
				enum: [
					"store",
					"search",
					"update",
					"delete",
					"summarize",
					"getContext",
				],
			},
			content: { type: "string" },
			query: { type: "string" },
			memoryId: { type: "string" },
			projectId: { type: "string" },
			tags: { type: "array", items: { type: "string" } },
			limit: { type: "number" },
		},
		required: ["operation"],
	},
};
```

### Routing Rules (from V1)

```typescript
// Content that should go to second-brain:
// - Descriptive feedback about events/tasks
// - Opinions, reflections, ideas
// - "I think...", "I feel...", "My thoughts on..."
// - Context about people, projects, goals

// Content that should NOT go to second-brain:
// - Action requests (create, update, delete)
// - Explicit task creation ("add task...")
// - Calendar operations
// - Email operations
```

---

## GeneralResolver

### Purpose

Handle conversational queries that don't require tool calls.

### Actions Handled

- `respond` → Pure LLM response, no tools

### Implementation

```typescript
async function resolve(
	step: PlanStep,
	state: MemoState
): Promise<ResolverResult> {
	// No tools needed - generate response directly
	const response = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		messages: [
			{ role: "system", content: getGeneralSystemPrompt() },
			...state.recent_messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			{
				role: "user",
				content: state.input.enhancedMessage || state.input.message,
			},
		],
	});

	// Return as "execute" with the response as data
	return {
		stepId: step.id,
		type: "execute",
		functionName: "__conversation__", // Special marker
		args: { response: response.choices[0].message.content },
	};
}
```

---

## MetaResolver

### Purpose

Handle questions about Memo's capabilities using predefined text.

### Actions Handled

- `describe_capabilities` → Template response

### Implementation

```typescript
async function resolve(
	step: PlanStep,
	state: MemoState
): Promise<ResolverResult> {
	const topic = step.constraints.topic || "general";

	// Use predefined capability descriptions
	const description =
		CAPABILITY_DESCRIPTIONS[topic] || CAPABILITY_DESCRIPTIONS.general;

	// Localize if needed
	const localized =
		state.user.language === "he"
			? CAPABILITY_DESCRIPTIONS_HE[topic]
			: description;

	return {
		stepId: step.id,
		type: "execute",
		functionName: "__meta__", // Special marker
		args: { response: localized },
	};
}

const CAPABILITY_DESCRIPTIONS = {
	general: `I can help you with:
- 📅 Calendar: Create, update, and manage Google Calendar events
- ✅ Tasks: Create reminders, to-do lists, and track tasks
- 📧 Email: Draft, send, and search Gmail messages
- 🧠 Memory: Store and recall your thoughts, ideas, and notes
- 💬 General: Answer questions and help you think through problems`,

	calendar: `Calendar features:
- Create one-time or recurring events
- Check for scheduling conflicts
- Update event times, titles, and attendees
- Delete single events or entire series
- View your schedule for any time range`,

	reminders: `Reminder features:
- Set one-time reminders with due dates
- Create recurring reminders (daily, weekly, monthly)
- Set "nudge" reminders that repeat every X minutes until done
- Mark reminders as complete
- View all pending reminders`,

	// ... more topics
};
```

---

## Resolver Interface

```typescript
interface Resolver {
	/** Unique name */
	name: string;

	/** Capability this resolver handles */
	capability: CapabilityName;

	/** Actions this resolver can handle */
	actions: string[];

	/**
	 * Convert a PlanStep to tool arguments or clarification request
	 */
	resolve(step: PlanStep, state: MemoState): Promise<ResolverResult>;

	/**
	 * Get the schema slice for this resolver
	 * Used by LLM when generating arguments
	 */
	getSchema(): FunctionDefinition;

	/**
	 * Get the system prompt for this resolver
	 * Should be static and cacheable
	 */
	getSystemPrompt(): string;
}
```

---

## QueryResolver Integration

All Resolvers that handle entity operations use the existing `QueryResolver` from V1:

```typescript
import { QueryResolver } from "../utils/QueryResolver";

class CalendarMutateResolver implements Resolver {
	private queryResolver = new QueryResolver();

	async resolve(step: PlanStep, state: MemoState): Promise<ResolverResult> {
		// For update/delete without explicit eventId
		if (needsEntityResolution(step)) {
			const result = await this.queryResolver.resolveWithDisambiguationHandling(
				{ text: step.constraints.summary },
				state.user.phone,
				"event"
			);

			if (result.disambiguation) {
				// Store in state for HITL
				return {
					stepId: step.id,
					type: "clarify",
					question: this.queryResolver.formatDisambiguation(
						"event",
						result.disambiguation.candidates,
						state.user.language
					),
					options: result.disambiguation.candidates.map((_, i) => `${i + 1}`),
				};
			}

			if (!result.id) {
				return {
					stepId: step.id,
					type: "clarify",
					question:
						state.user.language === "he"
							? "לא מצאתי אירוע תואם. האם תוכל לפרט יותר?"
							: "I couldn't find a matching event. Can you provide more details?",
				};
			}

			// Got the ID, continue with execution
			step.constraints.eventId = result.id;
		}

		// ... continue to build tool args
	}
}
```

---

## Prompt Caching Strategy

Resolver prompts should be designed for OpenAI prompt caching:

1. **Static system prompt** (cacheable)
   - Capability description
   - Available actions
   - Schema documentation
   - Example outputs
2. **Dynamic user content** (not cached)
   - Current state context
   - User message
   - Recent messages

```typescript
// Example: CalendarMutateResolver prompt structure
const SYSTEM_PROMPT = `You are a calendar operation resolver.

Your job is to convert a semantic action into concrete tool arguments.

Available operations:
- create: Create a new event
- update: Modify an existing event
- delete: Remove an event
- createRecurring: Create a recurring event

Schema:
${JSON.stringify(calendarMutateSchema, null, 2)}

Rules:
1. Always output valid JSON matching the schema
2. For updates, use searchCriteria for OLD values and updateFields for NEW values
3. Always include timezone in ISO timestamps
4. For recurring events, detect weekly (day names) vs monthly (day numbers)

Output format:
{
  "operation": "...",
  "args": { ... }
}`;

// This prompt will be cached by OpenAI after first use
```

---

_See BLUEPRINT.md for how Resolvers fit into the overall flow._
