# Disambiguation Implementation Summary

## 🎯 Goal

Implement a **shared, reusable** disambiguation solution that works across all entities (tasks, contacts, lists) to handle cases where multiple items match a user's query.

## 📋 Problem

Previously, each function (TaskFunction, ContactFunction, ListFunction) had **20+ lines of duplicate code** for:

- Resolving IDs from natural language
- Handling disambiguation
- Formatting candidate lists
- Extracting UUIDs from stored context

**Example**: User says "רשימת קניות" (Shopping List), but there are 2 lists with that name.

## ✅ Solution: Three-Layer Approach

### 1. **ConversationWindow** (Storage Layer)

**File**: `src/core/memory/ConversationWindow.ts`

**New Features**:

```typescript
// Store disambiguation context
storeDisambiguationContext(userId, candidates, entityType)

// Retrieve context
getLastDisambiguationContext(userId) → { candidates, expiresAt, entityType }
```

**How it works**:

- Stores candidate list (UUIDs + display text) as metadata in conversation history
- Context expires after 5 minutes
- Seamlessly integrates with existing conversation memory

---

### 2. **QueryResolver** (Logic Layer)

**File**: `src/core/orchestrator/QueryResolver.ts`

**New Method**:

```typescript
async resolveWithDisambiguationHandling(
  params: any,
  userId: string,
  domain: EntityDomain
): Promise<{ id: string | null; disambiguation?: string }>
```

**What it does**:

1. **Checks for stored context**: If user selected "2" from previous disambiguation, extract UUID
2. **Validates existing ID**: If `params.taskId`/`params.contactId`/`params.listId` exists, use it
3. **Performs resolution**: Call `resolveOneOrAsk()` to find entities
4. **Stores context if needed**: If disambiguation required, save candidates for next interaction
5. **Returns structured result**: `{ id: UUID }` or `{ disambiguation: "formatted text" }`

**Domain Support**:

- `'task'` → searches by `text` or `taskId`
- `'contact'` → searches by `name`, `email`, `phone`, or `contactId`
- `'list'` → searches by `title`, `listName`, or `listId`

---

### 3. **DatabaseFunctions** (Usage Layer)

**Before** (20+ lines per function):

```typescript
const resolveTaskId = async () => {
	if (params.taskId) return { id: params.taskId };
	if (!params.text) return { id: null };
	const resolver = new QueryResolver();
	const result = await resolver.resolveOneOrAsk(params.text, userId, "task");
	if (result.disambiguation) {
		return {
			id: null,
			disambiguation: resolver.formatDisambiguation(
				"task",
				result.disambiguation.candidates
			),
		};
	}
	return { id: result.entity?.id || null };
};
```

**After** (2 lines):

```typescript
const resolveTaskId = async () => {
	const resolver = new QueryResolver();
	return await resolver.resolveWithDisambiguationHandling(
		params,
		userId,
		"task"
	);
};
```

---

## 🔄 Complete Flow Example

### Scenario: User wants to delete "רשימת קניות" (Shopping List)

**Step 1: User's First Message**

```
User: "תמחק את רשימת קניות"
```

**Step 2: System Detects Multiple Matches**

```typescript
// QueryResolver.resolveWithDisambiguationHandling()
const candidates = [
  { id: "uuid-1", list_name: "רשימת קניות", items: [15 items] },
  { id: "uuid-2", list_name: "רשימת קניות", items: [] }
];
```

**Step 3: Context Stored**

```typescript
ConversationWindow.storeDisambiguationContext(
	userId,
	[
		{ id: "uuid-1", displayText: "רשימת קניות (15 פריטים)" },
		{ id: "uuid-2", displayText: "רשימת קניות (ללא פריטים)" },
	],
	"list"
);
```

**Step 4: User Sees Options**

```
התגלו מספר רשימות בשם זה:
1. רשימת קניות (15 פריטים)
2. רשימת קניות (ללא פריטים)

אנא בחר את המספר הנכון.
```

**Step 5: User Responds**

```
User: "2"
```

**Step 6: System Extracts UUID**

```typescript
// QueryResolver.resolveWithDisambiguationHandling()
const context = ConversationWindow.getLastDisambiguationContext(userId);
const selectedIndex = 2; // From user's message
const selectedCandidate = context.candidates[2 - 1]; // "uuid-2"
```

**Step 7: Delete Executed**

```typescript
// ListFunction
listService.delete({ userPhone: userId, id: "uuid-2" });
```

---

## 📊 Benefits

1. **DRY (Don't Repeat Yourself)**: ~60 lines of duplicate code eliminated
2. **Consistent**: Same logic for all entities
3. **Maintainable**: Single source of truth for disambiguation
4. **Extensible**: Easy to add new entity types
5. **Reliable**: UUID extraction with validation

## 🧪 Testing

To test disambiguation:

1. Create 2 lists with the same name
2. Try to delete one by name
3. Verify you see numbered options
4. Select a number (e.g., "2")
5. Verify the correct list is deleted

---

## 📁 Files Modified

1. ✅ `src/core/memory/ConversationWindow.ts` - Added context storage
2. ✅ `src/core/orchestrator/QueryResolver.ts` - Added shared handler
3. ✅ `src/agents/functions/DatabaseFunctions.ts` - Refactored 3 functions
4. ✅ `HYBRID-SQL-COMPILER-PROGRESS.md` - Updated with Phase 6

## 🎉 Result

**Before**: 60+ lines of repeated code across 3 functions  
**After**: 2 lines per function, all using shared handler

The system now handles disambiguation elegantly for **all entities** with minimal code duplication.
