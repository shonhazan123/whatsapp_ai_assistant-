# LLM-Native Multi-Task Design

## Design Decision Summary

**Multi-task detection is handled entirely by the LLM (Database Agent), not by regex or string parsing in code.**

## Key Points

### ❌ What We Are NOT Doing

- No regex patterns to detect multiple tasks
- No keyword-based splitting ("and", ",", "then", etc.)
- No TaskSplitter utility
- No rule-based sentence parsing

### ✅ What We ARE Doing

- LLM semantically understands user intent
- LLM outputs structured JSON with `operation: "createMultiple"` when appropriate
- System prompt guides LLM with clear examples and rules
- Backend already supports this via `TaskFunction.createMultiple → TaskService.createMultiple`

## Examples

### User: "Remind me to take the dog out at 5 and have a haircut at 10"

**LLM Output:**

```json
{
	"operation": "createMultiple",
	"entity": "tasks",
	"tasks": [
		{
			"text": "Take the dog out",
			"dueDate": "2025-01-15T17:00:00Z"
		},
		{
			"text": "Have a haircut",
			"dueDate": "2025-01-15T10:00:00Z"
		}
	]
}
```

### User: "Tomorrow buy milk, call mom, and finish the report"

**LLM Output:**

```json
{
	"operation": "createMultiple",
	"entity": "tasks",
	"tasks": [
		{
			"text": "Buy milk",
			"dueDate": "2025-01-16T10:00:00Z"
		},
		{
			"text": "Call mom",
			"dueDate": "2025-01-16T10:00:00Z"
		},
		{
			"text": "Finish the report",
			"dueDate": "2025-01-16T10:00:00Z"
		}
	]
}
```

### User: "At 8 yoga, at 9 groceries, at 10 meeting"

**LLM Output:**

```json
{
	"operation": "createMultiple",
	"entity": "tasks",
	"tasks": [
		{
			"text": "Yoga",
			"dueDate": "2025-01-15T08:00:00Z"
		},
		{
			"text": "Groceries",
			"dueDate": "2025-01-15T09:00:00Z"
		},
		{
			"text": "Meeting",
			"dueDate": "2025-01-15T10:00:00Z"
		}
	]
}
```

## System Prompt Changes

### New Section: "TASK CREATION RULES"

```
## TASK CREATION RULES:

### Single vs. Multiple Task Detection:
The LLM must semantically detect whether the user is requesting one or multiple tasks. No regex or keyword parsing is used.

1. **Single Task** - Use `operation: "create"`:
   - User mentions one action: "Remind me to buy groceries"
   - Include one "task" object with text, dueDate, category

2. **Multiple Tasks** - Use `operation: "createMultiple"`:
   - User mentions multiple actions or times in one message
   - Include all tasks in a "tasks" array

### Detection Examples:
- "Remind me to take the dog out at 5 and have a haircut at 10"
  → Two tasks with different times

- "Tomorrow buy milk, call mom, and finish the report"
  → Three tasks with shared dueDate (tomorrow)

- "At 8 yoga, at 9 groceries, at 10 meeting"
  → Three tasks with different times

### Required Task Fields:
Each task must include:
- **text**: Clear task description
- **dueDate**: ISO timestamp if time is mentioned (YYYY-MM-DDTHH:mm:ssZ)
- **category**: Optional, if context implies one
```

## Implementation

### Files to Modify

- `src/config/system-prompts.ts` - Add "TASK CREATION RULES" section

### Files NOT to Modify

- No new utilities needed
- No changes to TaskFunction or TaskService
- Backend already supports createMultiple

## Why LLM-Native?

1. **Semantic Understanding**: LLMs understand context, not just keywords
2. **Maintainability**: No regex patterns to update as phrasing evolves
3. **Flexibility**: Handles natural language variations automatically
4. **Zero Code Changes**: Backend already supports this pattern

## Testing

Manual testing should verify:

- Single task messages use `operation: "create"`
- Multi-task messages use `operation: "createMultiple"`
- Times are correctly parsed and assigned
- All tasks in the array have valid structure
