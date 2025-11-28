# Phase 2: RAG-Based Second Brain Implementation

## Executive Summary

This plan outlines the implementation of a RAG (Retrieval-Augmented Generation) based "Second Brain" system for storing, retrieving, and managing unstructured user memories. The system will use **pgvector** for vector storage, **OpenAI embeddings** for semantic search, and a new **SecondBrainAgent** to handle all unstructured thoughts, ideas, notes, and reflections that don't fit into structured reminders, lists, or calendar events.

**Goal**: Enable users to store and retrieve unstructured memories using semantic search, while maintaining clear boundaries with existing agents (DatabaseAgent for reminders/lists, CalendarAgent for time-based events).

---

## 1. Architecture Overview

### 1.1 System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    MainAgent / IntentClassifier              │
│  Routes: unstructured thoughts → SecondBrainAgent          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    SecondBrainAgent                          │
│  - System prompt for memory management                       │
│  - Function registration (SecondBrainFunction)               │
│  - Natural language → function calls                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              SecondBrainService                              │
│  - embedText() → OpenAI embeddings                          │
│  - insertMemory() → pgvector insert                         │
│  - searchMemory() → pgvector similarity search              │
│  - updateMemory() / deleteMemory()                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase PostgreSQL + pgvector                  │
│  - second_brain_memory table                                 │
│  - VECTOR(1536) embeddings                                  │
│  - Per-user isolation (user_id FK)                          │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

- **Vector Storage**: pgvector extension (Supabase native support)
- **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensions) or `text-embedding-ada-002` (1536 dimensions)
- **Database**: Supabase PostgreSQL (existing connection pool)
- **Similarity Search**: pgvector `<->` operator (cosine distance) or `<=>` (L2 distance)
- **Service Layer**: TypeScript service class following existing patterns (TaskService, ListService, etc.)

### 1.3 Agent Boundaries

**SecondBrainAgent Handles:**

- ✅ Unstructured thoughts ("I'm thinking about starting a fitness plan")
- ✅ Ideas ("Idea: build an AI boat autopilot")
- ✅ Notes ("Note to self: research AirDNA alternatives")
- ✅ Reflections ("I feel stressed lately and want to track why")
- ✅ Observations ("I noticed that when I wake up early I work better")
- ✅ Brain dumps (long-form unstructured text)
- ✅ Hebrew/English mixed content

**SecondBrainAgent Does NOT Handle:**

- ❌ Reminders → DatabaseAgent
- ❌ Lists → DatabaseAgent
- ❌ Time-based tasks/events → CalendarAgent
- ❌ Email operations → GmailAgent
- ❌ Contact management → DatabaseAgent

---

## 2. Database Schema & Migration

### 2.1 New Table: `second_brain_memory`

**File**: `scripts/migrations/create-second-brain-memory-table.sql`

```sql
-- ============================================
-- Enable pgvector extension (if not already enabled)
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- Second Brain Memory Table
-- ============================================
CREATE TABLE IF NOT EXISTS second_brain_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes for Performance
-- ============================================
-- Vector similarity search index (HNSW for fast approximate search)
CREATE INDEX IF NOT EXISTS second_brain_memory_embedding_idx
ON second_brain_memory
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- User ID index for filtering
CREATE INDEX IF NOT EXISTS second_brain_memory_user_id_idx
ON second_brain_memory(user_id);

-- Composite index for user + time queries
CREATE INDEX IF NOT EXISTS second_brain_memory_user_created_idx
ON second_brain_memory(user_id, created_at DESC);

-- ============================================
-- Row Level Security (RLS) - Optional but Recommended
-- ============================================
-- Enable RLS
ALTER TABLE second_brain_memory ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own memories
CREATE POLICY "Users can only access their own memories"
ON second_brain_memory
FOR ALL
USING (auth.uid() = user_id);

-- Note: If using service role (not Supabase Auth), RLS may not apply.
-- In that case, ensure all queries filter by user_id in application code.
```

### 2.2 Migration Script

**File**: `scripts/migrations/002-add-second-brain-memory.sql`

```sql
-- Migration: Add Second Brain Memory Table
-- Run this in Supabase SQL Editor or via migration script

-- Step 1: Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Create table (see schema above)
-- ... (full CREATE TABLE statement)

-- Step 3: Create indexes
-- ... (full index statements)

-- Step 4: Verify
SELECT
    table_name,
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'second_brain_memory';
```

### 2.3 Embedding Model Selection

**Recommended**: `text-embedding-3-small` (1536 dimensions)

- Cost-effective
- Good performance
- 1536 dimensions (standard for pgvector)

**Alternative**: `text-embedding-ada-002` (1536 dimensions)

- Older model, still supported
- Slightly lower cost
- Good baseline performance

**Vector Dimension**: 1536 (must match VECTOR(1536) in schema)

---

## 3. Service Layer: SecondBrainService

### 3.1 File Structure

**File**: `src/services/memory/SecondBrainService.ts`

### 3.2 Service Interface

```typescript
export interface MemoryRecord {
	id: string;
	user_id: string;
	text: string;
	embedding: number[]; // 1536-dimensional vector
	metadata: {
		tags?: string[];
		category?: string;
		language?: "hebrew" | "english" | "other";
		[key: string]: any;
	};
	created_at: Date;
	updated_at: Date;
}

export interface SearchResult extends MemoryRecord {
	similarity: number; // Cosine similarity score (0-1)
}

export class SecondBrainService {
	// Embed text using OpenAI
	async embedText(text: string): Promise<number[]>;

	// Insert new memory
	async insertMemory(
		userId: string,
		text: string,
		embedding: number[],
		metadata?: Record<string, any>
	): Promise<MemoryRecord>;

	// Search memories by semantic similarity
	async searchMemory(
		userId: string,
		queryText: string,
		limit?: number,
		minSimilarity?: number
	): Promise<SearchResult[]>;

	// Get memory by ID
	async getMemoryById(
		memoryId: string,
		userId: string
	): Promise<MemoryRecord | null>;

	// Update existing memory
	async updateMemory(
		memoryId: string,
		userId: string,
		newText: string,
		newEmbedding?: number[]
	): Promise<MemoryRecord>;

	// Delete memory
	async deleteMemory(memoryId: string, userId: string): Promise<boolean>;

	// Get all memories for user (paginated)
	async getAllMemory(
		userId: string,
		limit?: number,
		offset?: number
	): Promise<MemoryRecord[]>;

	// Get memory count for user
	async getMemoryCount(userId: string): Promise<number>;
}
```

### 3.3 Implementation Details

#### 3.3.1 Embedding Creation

**Method**: `embedText(text: string): Promise<number[]>`

- Use OpenAI `embeddings.create()` API
- Model: `text-embedding-3-small` (or `text-embedding-ada-002`)
- Input: raw text string
- Output: 1536-dimensional array
- Error handling: Retry logic, rate limiting

**Integration with OpenAIService**:

- Option A: Add `createEmbedding()` method to existing `OpenAIService`
- Option B: Call OpenAI API directly in `SecondBrainService`
- **Recommendation**: Option A (extend OpenAIService for consistency)

#### 3.3.2 Vector Insertion

**Method**: `insertMemory(...)`

```sql
INSERT INTO second_brain_memory (user_id, text, embedding, metadata)
VALUES ($1, $2, $3::vector, $4::jsonb)
RETURNING *;
```

- Convert JavaScript array to pgvector format: `[0.1, 0.2, ...]` → `'[0.1,0.2,...]'::vector`
- Use parameterized queries (prevent SQL injection)
- Return full record including generated UUID

#### 3.3.3 Vector Similarity Search

**Method**: `searchMemory(userId, queryText, limit, minSimilarity)`

```sql
SELECT
  id,
  user_id,
  text,
  embedding,
  metadata,
  created_at,
  updated_at,
  1 - (embedding <=> $queryVector::vector) AS similarity
FROM second_brain_memory
WHERE user_id = $userId
  AND (1 - (embedding <=> $queryVector::vector)) >= $minSimilarity
ORDER BY embedding <=> $queryVector::vector
LIMIT $limit;
```

**Notes**:

- `<=>` operator: Cosine distance (pgvector)
- `1 - distance` = similarity score (0-1, higher = more similar)
- Filter by `user_id` FIRST (privacy isolation)
- `minSimilarity` threshold (e.g., 0.7) to filter low-quality matches
- Use HNSW index for fast approximate search

#### 3.3.4 Update & Delete

**Update**:

- Re-embed new text if text changed
- Update both `text` and `embedding` columns
- Update `updated_at` timestamp

**Delete**:

- Soft delete (optional): Add `deleted_at` column
- Hard delete: `DELETE FROM second_brain_memory WHERE id = $1 AND user_id = $2`
- Always verify `user_id` to prevent cross-user deletion

### 3.4 Dependencies

**New npm packages** (if needed):

- `pgvector` types (optional, for TypeScript types)
- No additional packages required (pgvector is PostgreSQL extension, not npm package)

**Existing dependencies**:

- `pg` (already installed)
- `openai` (already installed)
- `src/config/database.ts` (existing pool connection)

---

## 4. Agent Implementation: SecondBrainAgent

### 4.1 File Structure

**File**: `src/agents/v2/SecondBrainAgent.ts`

### 4.2 Agent Class Structure

```typescript
export class SecondBrainAgent extends BaseAgent {
  private secondBrainService: SecondBrainService;

  constructor(
    openaiService: OpenAIService,
    functionHandler: IFunctionHandler,
    loggerInstance?: any
  ) {
    super(openaiService, functionHandler, loggerInstance);
    this.secondBrainService = new SecondBrainService(loggerInstance);
    this.registerFunctions();
  }

  async processRequest(
    message: string,
    userPhone: string,
    optionsOrContext?: {...} | any[]
  ): Promise<string> {
    // Use BaseAgent.executeWithAI()
  }

  getSystemPrompt(): string {
    return SystemPrompts.getSecondBrainAgentPrompt();
  }

  getFunctions(): FunctionDefinition[] {
    return this.functionHandler.getRegisteredFunctions();
  }

  private registerFunctions(): void {
    const secondBrainFunction = new SecondBrainFunction(
      this.secondBrainService,
      this.logger
    );
    this.functionHandler.registerFunction(secondBrainFunction);
  }
}
```

### 4.3 Function Registration

**File**: `src/agents/functions/SecondBrainFunction.ts`

**Function Name**: `secondBrainOperations`

**Operations**:

- `storeMemory` - Store new memory
- `searchMemory` - Search by semantic similarity
- `updateMemory` - Update existing memory
- `deleteMemory` - Delete memory
- `getAllMemory` - List all memories (paginated)
- `getMemoryById` - Get specific memory

**Function Schema**:

```typescript
{
  operation: 'storeMemory' | 'searchMemory' | 'updateMemory' | 'deleteMemory' | 'getAllMemory' | 'getMemoryById',
  text?: string,           // For storeMemory, updateMemory
  query?: string,          // For searchMemory
  memoryId?: string,       // For updateMemory, deleteMemory, getMemoryById
  limit?: number,          // For searchMemory, getAllMemory
  minSimilarity?: number,  // For searchMemory (default: 0.7)
  offset?: number,         // For getAllMemory (pagination)
  metadata?: Record<string, any>  // Optional tags/categories
}
```

---

## 5. System Prompts

### 5.1 SecondBrainAgent Prompt

**File**: `src/config/system-prompts.ts`  
**Method**: `getSecondBrainAgentPrompt(): string`

**Key Sections**:

1. **Role Definition**:

   - "You are the personal second-brain memory agent"
   - "Store unstructured thoughts, reflections, notes, ideas"
   - "Retrieve relevant memories on request"
   - "Summarize or combine them if needed"

2. **Boundaries**:

   - "Do NOT handle reminders → Route to DatabaseAgent"
   - "Do NOT handle lists → Route to DatabaseAgent"
   - "Do NOT handle time-based tasks → Route to CalendarAgent"
   - "Do NOT handle email → Route to GmailAgent"

3. **Operations**:

   - Store: "Remember that...", "I'm thinking...", "Note to self..."
   - Search: "What did I write about...", "Find my notes on...", "Show me memories about..."
   - Update: "Update that memory about...", "Change my note on..."
   - Delete: "Delete my memory about...", "Remove that note..."

4. **Language Handling**:

   - Always respond in the same language as user input
   - Hebrew ↔ English support
   - Detect language from input

5. **Examples**:
   - Hebrew: "אני חושב על רעיון חדש" → storeMemory
   - English: "I'm thinking about starting a fitness plan" → storeMemory
   - "What did I write about fitness?" → searchMemory
   - "Delete my note about Airbnb" → searchMemory → deleteMemory

### 5.2 Intent Classifier Prompt Updates

**File**: `src/config/system-prompts.ts`  
**Method**: `getIntentClassifierPrompt(): string`

**New Routing Rule**:

```
7. **UNSTRUCTURED THOUGHTS/IDEAS/NOTES** → second-brain
   - User expresses thoughts, ideas, notes, reflections
   - No explicit reminder/list/calendar/email intent
   - Examples:
     - "I'm thinking about starting a fitness plan" → second-brain
     - "Idea: build an AI boat autopilot" → second-brain
     - "Note to self: research AirDNA alternatives" → second-brain
     - "I feel stressed lately and want to track why" → second-brain
     - "אני חייב לזכור רעיון לפיצ'ר באפליקציה" → second-brain
   - Route to: second-brain
   - **CRITICAL**: Only route here if NOT:
     - Reminder phrasing → database
     - List operations → database
     - Time expressions → calendar
     - Email operations → gmail
```

**Updated Agent Capabilities**:

```
- second-brain: store/retrieve/update/delete unstructured memories; semantic search; summarize memories; **HANDLE ALL UNSTRUCTURED THOUGHTS/IDEAS/NOTES** (no reminders, lists, time-based tasks, or email).
```

**Updated Examples**:

```
- "I'm thinking about starting a fitness plan" → primaryIntent: "second-brain", requiresPlan: false, involvedAgents: ["second-brain"]
- "What did I write about fitness?" → primaryIntent: "second-brain", requiresPlan: false, involvedAgents: ["second-brain"]
- "Idea: build an AI boat autopilot" → primaryIntent: "second-brain", requiresPlan: false, involvedAgents: ["second-brain"]
```

### 5.3 MainAgent Prompt Updates (Optional)

**File**: `src/config/system-prompts.ts`  
**Method**: `getMainAgentPrompt(): string`

**Changes**:

- Add mention of SecondBrainAgent in agent list
- Update routing examples if needed
- Keep existing logic intact

---

## 6. Routing Logic Updates

### 6.1 Intent Detection Flow

**File**: `src/services/ai/OpenAIService.ts`  
**Method**: `detectIntent(message, context): Promise<IntentDecision>`

**Changes**:

- Add `AgentName.SECOND_BRAIN` to valid intents
- Update `normalizeIntentDecision()` to handle "second-brain" intent
- No code changes needed (handled by prompt updates)

### 6.2 MultiAgentCoordinator Updates

**File**: `src/orchestration/MultiAgentCoordinator.ts`

**Changes**:

- Add `SecondBrainAgent` to agent registry
- Add routing case for `AgentName.SECOND_BRAIN`
- Initialize `SecondBrainAgent` in constructor

**Code Pattern**:

```typescript
private agents: Map<AgentName, IAgent> = new Map();

constructor(...) {
  // ... existing agents
  this.agents.set(AgentName.SECOND_BRAIN, new SecondBrainAgent(...));
}
```

### 6.3 AgentName Enum Update

**File**: `src/core/interfaces/IAgent.ts` (or wherever AgentName is defined)

**Changes**:

```typescript
export enum AgentName {
	CALENDAR = "calendar",
	GMAIL = "gmail",
	DATABASE = "database",
	MULTI_TASK = "multi-task",
	SECOND_BRAIN = "second-brain", // NEW
}
```

---

## 7. Privacy & Isolation

### 7.1 Per-User Isolation Rules

**CRITICAL**: All queries MUST be scoped to `user_id`

**Enforcement**:

1. **Service Layer**: Every method accepts `userId` parameter
2. **SQL Queries**: Always include `WHERE user_id = $userId`
3. **Function Handler**: Extract `userId` from `RequestContext`
4. **No Global Search**: Never query without `user_id` filter

**Example**:

```sql
-- ✅ CORRECT
SELECT * FROM second_brain_memory
WHERE user_id = $1
ORDER BY embedding <=> $2::vector;

-- ❌ WRONG (no user filter)
SELECT * FROM second_brain_memory
ORDER BY embedding <=> $1::vector;
```

### 7.2 Cross-User Prevention

- **No shared memories**: Each user's memories are completely isolated
- **No cross-user similarity**: Never compare embeddings across users
- **No global context**: No shared knowledge base
- **RLS Policy**: Use Supabase RLS if available, otherwise enforce in application code

### 7.3 Data Access Patterns

- **Read**: Filter by `user_id` + optional search/date filters
- **Write**: Always set `user_id` from authenticated user
- **Update/Delete**: Verify `user_id` matches before allowing operation

---

## 8. Deletion, Editing, Update Logic

### 8.1 Delete Memory Flow

**User Request**: "Delete my note about Airbnb"

**Agent Behavior**:

1. Parse intent: `deleteMemory` operation
2. If memory ID not provided:
   - Call `searchMemory(query: "Airbnb", limit: 5)`
   - If multiple results: Show list, ask user to select
   - If single result: Proceed with deletion
3. Call `deleteMemory(memoryId, userId)`
4. Confirm: "נמחק." / "Deleted."

**Function Call**:

```json
{
	"operation": "deleteMemory",
	"memoryId": "uuid-here"
}
```

### 8.2 Update Memory Flow

**User Request**: "Update that idea I wrote yesterday"

**Agent Behavior**:

1. Parse intent: `updateMemory` operation
2. If memory ID not provided:
   - Search recent memories (last 24 hours)
   - If multiple: Ask for disambiguation
   - If single: Proceed
3. Extract new text from user message
4. Re-embed new text
5. Call `updateMemory(memoryId, newText, newEmbedding)`
6. Confirm: "עודכן." / "Updated."

**Function Call**:

```json
{
	"operation": "updateMemory",
	"memoryId": "uuid-here",
	"text": "Updated idea text here"
}
```

### 8.3 View All Memories Flow

**User Request**: "Show me my saved ideas"

**Agent Behavior**:

1. Parse intent: `getAllMemory` operation
2. Call `getAllMemory(userId, limit: 20, offset: 0)`
3. Format response:
   - List memories with dates
   - Group by date if many
   - Show pagination if needed
4. Language: Match user input language

**Function Call**:

```json
{
	"operation": "getAllMemory",
	"limit": 20,
	"offset": 0
}
```

---

## 9. UX Behavior Rules

### 9.1 Storage Confirmation

**When storing memory**:

- **Hebrew**: "נשמר." / "נשמר בהצלחה."
- **English**: "Saved." / "Memory saved."
- **Optional**: Show preview of stored text

### 9.2 Search Results Format

**When retrieving memories**:

- Show 1-5 top matches
- Include similarity score (optional, for debugging)
- Format:

  ```
  📝 Found 3 memories:

  1. [Date] Memory text here...
  2. [Date] Another memory...
  3. [Date] Third memory...
  ```

### 9.3 Summarization

**When user asks for summary**:

- Retrieve relevant memories (via search)
- Use LLM to generate summary
- Language: Match user input
- Format: Bullet points or paragraph

### 9.4 Disambiguation

**When multiple matches found**:

- List options with numbers
- Ask: "Which one? (1, 2, 3...)" / "איזה? (1, 2, 3...)"
- Wait for user selection
- Proceed with selected option

### 9.5 Language Matching

**CRITICAL**: Always respond in the same language as user input

- Hebrew input → Hebrew response
- English input → English response
- Mixed → Dominant language or user preference

---

## 10. Files to Create

### 10.1 New Files

1. **Service Layer**:

   - `src/services/memory/SecondBrainService.ts`

2. **Agent**:

   - `src/agents/v2/SecondBrainAgent.ts`

3. **Functions**:

   - `src/agents/functions/SecondBrainFunction.ts`

4. **Migrations**:

   - `scripts/migrations/002-add-second-brain-memory.sql`

5. **Types** (if needed):
   - `src/types/memory.ts` (optional, for TypeScript interfaces)

### 10.2 Test Files (Future)

- `src/services/memory/__tests__/SecondBrainService.test.ts`
- `src/agents/v2/__tests__/SecondBrainAgent.test.ts`

---

## 11. Files to Modify

### 11.1 Core Files

1. **System Prompts**:

   - `src/config/system-prompts.ts`
     - Add `getSecondBrainAgentPrompt()`
     - Update `getIntentClassifierPrompt()`
     - Optionally update `getMainAgentPrompt()`

2. **Agent Registration**:

   - `src/orchestration/MultiAgentCoordinator.ts`
     - Add `SecondBrainAgent` initialization
     - Add routing case

3. **Agent Name Enum**:

   - `src/core/interfaces/IAgent.ts` (or wherever `AgentName` is defined)
     - Add `SECOND_BRAIN = 'second-brain'`

4. **OpenAI Service** (if extending):
   - `src/services/ai/OpenAIService.ts`
     - Add `createEmbedding(text: string): Promise<number[]>` method

### 11.2 Database Files

1. **Migration Scripts**:

   - `scripts/migrations/002-add-second-brain-memory.sql` (new)
   - Update migration index if using numbered migrations

2. **Database Config** (no changes needed):
   - `src/config/database.ts` (existing pool works)

---

## 12. Implementation Steps

### Step 1: Database Setup

- [ ] Enable pgvector extension in Supabase
- [ ] Create `second_brain_memory` table
- [ ] Create indexes (HNSW, user_id, composite)
- [ ] Test table creation and basic insert

### Step 2: Service Layer

- [ ] Create `SecondBrainService.ts`
- [ ] Implement `embedText()` (integrate with OpenAI)
- [ ] Implement `insertMemory()`
- [ ] Implement `searchMemory()` (pgvector similarity)
- [ ] Implement `updateMemory()`, `deleteMemory()`, `getAllMemory()`
- [ ] Add error handling and logging
- [ ] Test service methods with sample data

### Step 3: Function Layer

- [ ] Create `SecondBrainFunction.ts`
- [ ] Define function schema (operations, parameters)
- [ ] Implement function execution logic
- [ ] Register with FunctionHandler
- [ ] Test function calls

### Step 4: Agent Layer

- [ ] Create `SecondBrainAgent.ts`
- [ ] Extend `BaseAgent`
- [ ] Register `SecondBrainFunction`
- [ ] Test agent initialization

### Step 5: System Prompts

- [ ] Create `getSecondBrainAgentPrompt()`
- [ ] Update `getIntentClassifierPrompt()` with routing rules
- [ ] Optionally update `getMainAgentPrompt()`
- [ ] Test prompt clarity and boundaries

### Step 6: Routing Integration

- [ ] Add `SECOND_BRAIN` to `AgentName` enum
- [ ] Update `MultiAgentCoordinator` to register `SecondBrainAgent`
- [ ] Update `OpenAIService.detectIntent()` normalization (if needed)
- [ ] Test intent detection with sample messages

### Step 7: Testing

- [ ] Test storage: "I'm thinking about X"
- [ ] Test search: "What did I write about X?"
- [ ] Test update: "Update that memory about X"
- [ ] Test delete: "Delete my note about X"
- [ ] Test language handling (Hebrew/English)
- [ ] Test privacy (verify user_id isolation)
- [ ] Test edge cases (empty search, no results, etc.)

### Step 8: Documentation

- [ ] Update README with SecondBrainAgent usage
- [ ] Document API endpoints (if exposed)
- [ ] Document migration steps
- [ ] Document embedding model selection

---

## 13. Test Plan

### 13.1 Unit Tests

**SecondBrainService**:

- Test `embedText()` with sample text
- Test `insertMemory()` with valid data
- Test `searchMemory()` with query and verify results
- Test `updateMemory()` and `deleteMemory()`
- Test user isolation (verify user_id filtering)

**SecondBrainFunction**:

- Test function schema validation
- Test operation routing (storeMemory, searchMemory, etc.)
- Test error handling

**SecondBrainAgent**:

- Test agent initialization
- Test function registration
- Test system prompt retrieval

### 13.2 Integration Tests

**End-to-End Flows**:

1. Store memory → Search memory → Verify retrieval
2. Store memory → Update memory → Verify update
3. Store memory → Delete memory → Verify deletion
4. Multiple users → Verify isolation
5. Hebrew input → Verify Hebrew response
6. English input → Verify English response

### 13.3 Performance Tests

- Vector search performance (HNSW index)
- Embedding generation latency
- Bulk insert performance
- Search with large dataset (1000+ memories per user)

### 13.4 Privacy Tests

- Verify user_id filtering in all queries
- Test cross-user access prevention
- Verify RLS policies (if enabled)

---

## 14. Error Handling

### 14.1 Embedding Generation Errors

- **OpenAI API failure**: Retry with exponential backoff
- **Rate limiting**: Queue requests, return user-friendly message
- **Invalid text**: Validate input, return error message

### 14.2 Database Errors

- **pgvector not enabled**: Clear error message, migration instructions
- **Vector dimension mismatch**: Validate embedding length
- **Connection errors**: Retry logic, fallback message

### 14.3 Search Errors

- **No results**: Friendly message: "No memories found matching your query"
- **Low similarity**: Optionally show results anyway, or filter silently
- **Empty query**: Ask user to provide search terms

---

## 15. Future Enhancements (Out of Scope for Phase 2)

- **Memory Categories/Tags**: Use metadata field for organization
- **Memory Expiration**: Auto-delete old memories (optional)
- **Memory Export**: Export all memories as JSON/text
- **Memory Import**: Bulk import from file
- **Memory Sharing**: Share memories between users (requires new table)
- **Memory Analytics**: Show memory count, most common topics
- **Chunking**: Split long memories into chunks for better search
- **Hybrid Search**: Combine semantic + keyword search

---

## 16. Dependencies & Prerequisites

### 16.1 Required

- ✅ Supabase PostgreSQL (existing)
- ✅ pgvector extension (to be enabled)
- ✅ OpenAI API key (existing)
- ✅ Node.js + TypeScript (existing)
- ✅ `pg` package (existing)
- ✅ `openai` package (existing)

### 16.2 Optional

- `@types/pgvector` (if TypeScript types available)
- Migration tool (if not using raw SQL)

### 16.3 No New Dependencies Needed

- pgvector is a PostgreSQL extension (not npm package)
- All vector operations use SQL (`<=>`, `vector` type)
- Embeddings via OpenAI API (existing package)

---

## 17. Migration Checklist

### Pre-Migration

- [ ] Backup existing database
- [ ] Verify Supabase connection
- [ ] Check pgvector extension availability
- [ ] Review existing table structure

### Migration Execution

- [ ] Run `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] Run table creation SQL
- [ ] Create indexes
- [ ] Verify table structure
- [ ] Test basic insert/select

### Post-Migration

- [ ] Verify RLS policies (if enabled)
- [ ] Test user isolation
- [ ] Monitor performance
- [ ] Document migration completion

---

## 18. Success Criteria

### Functional

- ✅ Users can store unstructured memories
- ✅ Users can search memories by semantic similarity
- ✅ Users can update/delete memories
- ✅ Memories are isolated per user
- ✅ Hebrew and English supported
- ✅ Routing correctly identifies unstructured thoughts

### Performance

- ✅ Search returns results in < 500ms (with HNSW index)
- ✅ Embedding generation < 1s
- ✅ Supports 1000+ memories per user

### Quality

- ✅ No cross-user data leakage
- ✅ Error messages are user-friendly
- ✅ Language matching works correctly
- ✅ System prompts clearly define boundaries

---

## 19. Rollback Plan

If issues arise:

1. **Disable Agent**: Remove `SecondBrainAgent` from `MultiAgentCoordinator`
2. **Keep Table**: Leave table intact (no data loss)
3. **Update Routing**: Route unstructured thoughts back to DatabaseAgent (temporary)
4. **Fix Issues**: Debug and fix in separate branch
5. **Re-enable**: Re-add agent after fixes

---

## 20. Conclusion

This plan provides a complete implementation guide for Phase 2: RAG-Based Second Brain. The system will enable users to store and retrieve unstructured memories using semantic search, while maintaining clear boundaries with existing agents.

**Key Principles**:

- Use existing libraries (pgvector, OpenAI embeddings)
- Maintain per-user privacy isolation
- Follow existing code patterns (BaseAgent, FunctionHandler, Service layer)
- Support Hebrew and English
- Clear agent boundaries (no overlap with DatabaseAgent, CalendarAgent, GmailAgent)

**Next Steps**: Review plan, approve, then proceed with implementation following the step-by-step guide in Section 12.
