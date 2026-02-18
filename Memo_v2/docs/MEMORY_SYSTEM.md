# Memo V2 — Memory System Documentation

> **Status**: Current Implementation Summary  
> **Last Updated**: January 2026  
> **Purpose**: Comprehensive documentation of the memory system architecture, flow, and capabilities

---

## Table of Contents

1. [Overview](#1-overview)
2. [Memory Types](#2-memory-types)
3. [Memory Lifecycle](#3-memory-lifecycle)
4. [Implementation Details](#4-implementation-details)
5. [Current Capabilities](#5-current-capabilities)
6. [Limitations & Future Enhancements](#6-limitations--future-enhancements)

---

## 1. Overview

The Memo V2 memory system provides multi-layered context management for maintaining conversation continuity, user preferences, and long-term knowledge. The system is **self-contained within Memo_v2** and does not depend on V1's memory system.

**Image and audio**: All image-context and audio handling live in Memo V2. The webhook only downloads media (image/audio) and delegates to Memo V2 (`processImageMessage`, `processAudioMessage`). Image analysis, transcription, and conversation memory for those turns are stored only in Memo V2 (no V1 memory).

### Key Principles

- **Self-contained**: All memory logic lives in `Memo_v2/src/services/memory/`
- **Short-term memory**: Fast, in-memory storage for immediate conversation context
- **Long-term memory**: Persistent storage for facts, preferences, and summaries
- **Token efficiency**: Automatic limits to prevent context overflow
- **State persistence**: LangGraph checkpointer enables pause/resume for HITL flows
- **Clean API**: MemoryService provides encapsulated memory operations

### Architecture

```
Memo_v2/src/services/memory/
├── ConversationWindow.ts    # In-memory conversation storage (singleton)
├── MemoryService.ts         # Encapsulated API for memory operations
└── index.ts                 # Exports
```

---

## 2. Memory Types

The system implements several distinct memory types, each serving a specific purpose:

### 2.1 Short-Term Memory (Recent Messages)

**Storage**:
- Primary: `MemoryService` (in-memory singleton in `Memo_v2/src/services/memory/`)
- Copied into: `MemoState.recentMessages` each invocation (for Planner/Resolvers context)

**Lifetime**:
- `MemoryService` persists in-process (until server restart)
- LangGraph checkpointer persistence is used mainly for **pending HITL interrupts**; after a successful run, checkpoints are deleted (`checkpointer.deleteThread(threadId)`).
**Limits**:

- Maximum 10 messages (user + assistant pairs)
- Maximum 500 tokens total
- Automatic trimming when limits exceeded

**Purpose**: Provides immediate conversation context for:

- Reference resolution ("it", "that", "זה")
- Reply-to detection
- Conversation continuity
- Context for LLM nodes (Planner, Resolvers)

**Data Structure**:

```typescript
interface ConversationMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string; // ISO format
	whatsappMessageId?: string;
	replyToMessageId?: string;
	metadata?: {
		disambiguationContext?: DisambiguationContext;
		imageContext?: ImageContext;
	};
}
```

### 2.2 Long-Term Memory Summary

**Storage**: Optional Supabase (`conversation_memory` table)  
**Lifetime**: Persistent  
**Status**: Currently **not implemented** (placeholder exists)

**Purpose**: Store summarized conversation history beyond the 10-message window

**Current Implementation**:

- `ContextAssemblyNode.getLongTermMemorySummary()` returns `undefined`
- Placeholder exists for future integration with SecondBrainService
- Would query `second_brain_memory` table for user summaries

### 2.3 Disambiguation (Entity Resolution HITL)

**Storage**:
- `MemoState.disambiguation` holds the candidates + question
- LangGraph checkpointer holds the paused graph state while waiting for user reply

**Lifetime / cleanup**:
- Controlled by the interrupt timeout in `invokeMemoGraph()` (currently **1 minute**).
- If the user replies after the timeout, the thread checkpoints are cleaned up and the message is treated as a **fresh invocation**.

**Purpose**: When entity lookup is ambiguous (e.g., multiple tasks match), pause and ask the user to choose.

**Data shape (current runtime)**: see `Memo_v2/src/types/index.ts` `DisambiguationContext`.

Key fields:
- `type`: `"calendar" | "database" | "gmail" | "second-brain" | "error"`
- `candidates[]`: `{ id, displayText, ... }`
- `question`, `allowMultiple`
- `resolverStepId`: which plan step needs resolution
- `originalArgs`: resolver args before ID resolution
- `userSelection`: filled on resume
- `resolved`: used to guard resume flows

### 2.4 Image Context

**Storage**: `MemoState.input.imageContext` (also stored in MemoryService message metadata)  
**Lifetime**: Treated as “recent” if extracted within ~5 minutes (see `ReplyContextNode.findRecentImageContext()`)
**Purpose**: Maintains context from recently analyzed images

**Data Structure**:

```typescript
interface ImageContext {
	imageId: string;
	analysisResult: ImageAnalysisResult;
	imageType: "structured" | "random";
	extractedAt: number;
}
```

**Usage**:

- Attached to user messages when image is analyzed
- Available in `state.input.imageContext` for resolvers
- Automatically included in enhanced message when present

### 2.5 `state.refs` (running references)

`MemoState.refs` exists as a place to store running references for multi-step flows, but in the current implementation it is **not actively populated by nodes**.

If/when we re-introduce step-to-step “refs” behavior, this doc must be updated to reflect the exact writer nodes and shapes.

### 2.6 Second Brain (Persistent Knowledge)

**Storage**: Vector Database (embeddings)  
**Lifetime**: Persistent  
**Purpose**: Long-term storage of facts, notes, and personal knowledge

**Operations**:

- `storeMemory`: Save new facts/notes
- `searchMemory`: Semantic search for stored information
- `updateMemory`: Update existing memories
- `deleteMemory`: Remove memories
- `getAllMemory`: List all stored memories

**Integration**:

- Handled by SecondBrainResolver and SecondBrainExecutor
- Uses vector similarity search for retrieval
- Separate from conversation memory (different purpose)

---

## 3. Memory Lifecycle

### 3.1 Request Start (ContextAssemblyNode)

**Location**: `Memo_v2/src/graph/nodes/ContextAssemblyNode.ts`

**Process**:

1. **Load User Profile**: Fetch user data (timezone, language, plan tier, capabilities)
2. **Add Current User Message**:
   - Calls `memoryService.addUserMessage(phone, message, options)`
   - Ensures message is in memory before any other processing
3. **Load Recent Messages**:
   - Calls `memoryService.getRecentMessages(phone, 10)`
   - Returns messages in MemoState format (ISO timestamps)
4. **Load Long-Term Summary**:
   - Currently returns `undefined` (not implemented)
   - Future: Query SecondBrainService for user summaries
5. **Build Time Context**: Generate formatted time string with user's timezone
6. **Detect Language**: Analyze message for Hebrew/English/other

**Code Flow**:

```typescript
// ContextAssemblyNode.process()
const user = await this.getUserProfile(phone);

// Add current user message to memory FIRST
this.addUserMessageToMemory(input);

// Then get recent messages (includes current message)
const recentMessages = this.getRecentMessages(phone);
const longTermSummary = await this.getLongTermMemorySummary(phone);
const now = this.buildTimeContext(user.timezone);

return createInitialState({
  user,
  input: { message, ... },
  now,
  recentMessages,      // ← Loaded from MemoryService
  longTermSummary,     // ← Currently undefined
});
```

### 3.2 During Graph Execution

**Memory Usage by Node**:

1. **PlannerNode**:
   - Reads `state.recentMessages` (last 10) for context
   - Includes `state.longTermSummary` if available
   - Uses recent messages to resolve references ("it", "that")

2. **Resolvers**:
   - Access `state.recentMessages` (up to 10) for immediate context
   - Use conversation history to understand follow-up requests

3. **EntityResolutionNode**:
   - Uses `state.recentMessages` for fuzzy matching context
   - Stores disambiguation candidates in `state.disambiguation`

4. **ReplyContextNode**:
   - Checks `state.input.replyToMessageId`
   - Retrieves replied-to message from `state.recentMessages`
   - Handles numbered list references
   - Attaches image context from recent messages

### 3.3 Request End (MemoryUpdateNode)

**Location**: `Memo_v2/src/graph/nodes/MemoryUpdateNode.ts`

**Process**:

1. **Add User Message**:
   - Creates `ConversationMessage` with user input
   - Includes `enhancedMessage` if available (from ReplyContextNode)
   - Attaches metadata (disambiguation context, image context)
   - Timestamp: `now - 1000` (slightly before assistant response)

2. **Add Assistant Response**:
   - Adds `state.finalResponse` to `state.recentMessages` for in-graph context
   - Persisting the assistant message (with WhatsApp message ID) is done by the webhook when sending the message

3. **Merge with Existing**:
   - Combines `state.recentMessages` with new messages
   - Maintains chronological order

4. **Enforce Limits**:
   - **Message Count**: Trims to last 10 messages
   - **Token Count**: Trims to 500 tokens (estimated)
   - Removes oldest messages first if limits exceeded

5. **Validate Memory**:
   - Uses `memoryService.hasUserMessage()` to verify user message is stored
   - Adds as fallback if not present (shouldn't happen normally)

6. **Update Long-Term Summary** (Future):
   - Checks if summary should be updated
   - Triggers when message count approaches limit or significant operations occur
   - Currently not implemented (TODO)

**Code Flow**:

```typescript
// MemoryUpdateNode.process()
const newMessages: ConversationMessage[] = [];

// Add user message
if (userMessage) {
	newMessages.push({
		role: "user",
		content: enhancedMessage || userMessage,
		timestamp: new Date(now - 1000).toISOString(),
		metadata: { disambiguationContext, imageContext },
	});
}

// Add assistant response
if (assistantResponse) {
	newMessages.push({
		role: "assistant",
		content: assistantResponse,
		timestamp: new Date(now).toISOString(),
	});
}

// Merge and enforce limits
const allMessages = [...state.recentMessages, ...newMessages];
const trimmedMessages = enforceMemoryLimits(
	allMessages,
	MAX_RECENT_MESSAGES, // 10
	MAX_TOKENS_ESTIMATE, // 500
);

// Validate user message in memory (fallback)
this.validateUserMessageInMemory(state, userMessage, enhancedMessage);

return { recentMessages: trimmedMessages };
```

### 3.4 Memory Limits Enforcement

**Location**: `Memo_v2/src/graph/nodes/MemoryUpdateNode.ts`

**Algorithm**:

1. **Message Count Limit**:
   - If messages > 10, keep only last 10
   - Uses `slice(-10)` for efficient trimming

2. **Token Count Limit**:
   - Estimates tokens: `Math.ceil(text.length / 4)` (4 chars per token)
   - If total tokens > 500, removes oldest messages until under limit
   - Always keeps at least 1 message (prevents empty state)

**Implementation**:

```typescript
function enforceMemoryLimits(
	messages: ConversationMessage[],
	maxMessages: number,
	maxTokens: number,
): ConversationMessage[] {
	let result = [...messages];

	// Limit by message count first
	if (result.length > maxMessages) {
		result = result.slice(-maxMessages);
	}

	// Then limit by tokens
	while (calculateTotalTokens(result) > maxTokens && result.length > 1) {
		result = result.slice(1); // Remove oldest
	}

	return result;
}
```

---

## 4. Implementation Details

### 4.1 MemoryService API

**Location**: `Memo_v2/src/services/memory/MemoryService.ts`

**Core Methods**:

```typescript
class MemoryService {
	// Message Operations
	addUserMessage(phone, message, options): void;
	addAssistantMessage(phone, message, whatsappMessageId?): void;
	getRecentMessages(phone, limit?): ConversationMessage[];
	hasUserMessage(phone, content, whatsappMessageId?): boolean;
	getLastUserMessage(phone): ConversationMessage | null;
	getRepliedToMessage(phone, replyToMessageId): ConversationMessage | null;

	// Disambiguation Operations
	getDisambiguationContext(phone): DisambiguationContext | null;
	setDisambiguationContext(phone, context): void;
	clearDisambiguationContext(phone): void;

	// Image Context
	getLastImageContext(phone): ImageContext | null;

	// Recent Tasks
	pushRecentTasks(phone, tasks, options?): void;
	getRecentTasks(phone): RecentTaskSnapshot[];
	clearRecentTasks(phone): void;

	// Conversation Management
	clearConversation(phone): void;
	getStats(phone): ConversationStats;
	cleanup(): void;
}
```

**Usage Example**:

```typescript
import { getMemoryService } from "../../services/memory/index.js";

const memoryService = getMemoryService();

// Add user message
memoryService.addUserMessage(phone, message, {
	whatsappMessageId: "...",
	replyToMessageId: "...",
});

// Get recent messages
const messages = memoryService.getRecentMessages(phone, 10);

// Check if message exists
const hasMessage = memoryService.hasUserMessage(phone, message, messageId);
```

### 4.2 State Definition

**Location**: `Memo_v2/src/graph/state/MemoState.ts`

**Memory-Related Fields**:

```typescript
export const MemoStateAnnotation = Annotation.Root({
	// Recent messages with reducer
	recentMessages: Annotation<ConversationMessage[]>({
		default: () => [],
		reducer: (existing, incoming) => {
			if (!incoming || incoming.length === 0) return existing;
			const combined = [...existing, ...incoming];
			return combined.slice(-10); // Keep last 10
		},
	}),

	// Long-term summary
	longTermSummary: Annotation<string | undefined>({
		default: () => undefined,
		reducer: (_, update) => update,
	}),

	// Disambiguation context
	disambiguation: Annotation<DisambiguationContext | undefined>({
		default: () => undefined,
		reducer: (_, update) => update,
	}),

	// ... other fields
});
```

### 4.3 ConversationWindow (Internal Storage)

**Location**: `Memo_v2/src/services/memory/ConversationWindow.ts`

**Key Features**:

- Singleton pattern for global access
- In-memory Map storage (per user phone)
- Automatic token limit enforcement
- Message importance scoring for smart pruning
- Disambiguation context with expiry

**Configuration**:

```typescript
class ConversationWindow {
  MAX_TOTAL_MESSAGES = 10;        // User + assistant messages
  MAX_TOTAL_TOKENS = 500;         // Estimated token limit
  MAX_RECENT_TASKS = 4;           // Tasks per user
  MAX_SYSTEM_MESSAGES = 3;        // System messages limit
  CHARS_PER_TOKEN = 3.5;          // Token estimation ratio
  CONVERSATION_MAX_AGE_MS = 12h;  // Auto-cleanup age
  DISAMBIGUATION_EXPIRY_MS = 5m;  // Disambiguation context expiry
}
```

### 4.4 Checkpointer (State Persistence)

**Location**: `Memo_v2/src/graph/index.ts`

**Current Implementation**:

- **Development**: `MemorySaver` (in-memory, resets on restart)
- **Production**: Future `SupabaseCheckpointer` (persistent)

**Purpose**:

- Enables HITL pause/resume functionality
- Persists state between `interrupt()` and `resume()` calls
- Uses `thread_id = userPhone` for per-user state

**Usage**:

```typescript
const checkpointer = new MemorySaver();

const graph = new StateGraph<MemoState>({...})
  .compile({ checkpointer });

// Invoke with thread_id
await graph.invoke(input, {
  configurable: { thread_id: userPhone }
});
```

---

## 5. Current Capabilities

### 5.1 What Works Now

✅ **Self-Contained Memory System**

- All memory logic in `Memo_v2/src/services/memory/`
- No dependency on V1's ConversationWindow
- Clean API via MemoryService

✅ **Short-Term Memory (Recent Messages)**

- Stores last 10 messages in ConversationWindow
- Enforces 10 message / 500 token limits
- Updates after each interaction
- Available to all nodes via `state.recentMessages`

✅ **Disambiguation Context**

- Stores entity candidates when multiple matches found
- Pauses execution via LangGraph `interrupt()` when (and only when) true disambiguation is required
- **Interrupt-timeout is currently 1 minute** (graph-level timeout in `invokeMemoGraph()`)
- MemoryService also stores a disambiguation metadata snapshot with a **5-minute expiry** (ConversationWindow constant) for follow-up/reply context

✅ **Image Context**

- Maintains context from recently analyzed images
- Treated as “recent” if extracted within ~5 minutes (see `ReplyContextNode.findRecentImageContext()`)
- Automatically attached to enhanced messages

✅ **Recent Tasks**

- MemoryService supports storing “recent tasks” snapshots, but in the current implementation this is **not** populated by the execution pipeline (so do not rely on it for resolution).

✅ **Second Brain (Knowledge Storage)**

- Full CRUD operations (store, search, update, delete)
- Semantic search via vector embeddings
- Separate from conversation memory

### 5.2 Memory Usage in Flow

**ContextAssemblyNode**:

- ✅ Loads user profile
- ✅ Adds current user message to memory
- ✅ Loads recent messages (10 max)
- ⚠️ Long-term summary placeholder (returns undefined)
- ✅ Builds time context
- ✅ Detects language

**PlannerNode**:

- ✅ Uses recent messages for reference resolution
- ✅ Includes long-term summary if available (currently never available)
- ✅ Uses conversation context to understand "it", "that", "זה"

**Resolvers**:

- ✅ Access `state.recentMessages` (up to 10 messages) for immediate context
- ✅ Use conversation history for follow-up requests

**EntityResolutionNode**:

- ✅ Uses resolver args + domain entity resolvers to resolve IDs
- ✅ When ambiguous, writes `state.disambiguation` and requests HITL via `interrupt()`

**ReplyContextNode**:

- ✅ Retrieves replied-to message from recent messages
- ✅ Handles numbered list references
- ✅ Attaches image context

**HITLGateNode** (when interrupting):

- ✅ Adds disambiguation/clarification questions to memory before interrupt
- ✅ Ensures HITL messages are in conversation history

**MemoryUpdateNode**:

- ✅ Adds user message to recent messages
- ✅ Adds assistant response to memory (ConversationWindow)
- ✅ Enforces message count limit (10)
- ✅ Enforces token limit (500)
- ✅ Validates user message in memory
- ⚠️ Long-term summary update not implemented

---

## 6. Limitations & Future Enhancements

### 6.1 Current Limitations

❌ **Long-Term Memory Summary**

- **Status**: Not implemented
- **Location**: `ContextAssemblyNode.getLongTermSummary()` returns `undefined`
- **Impact**: No persistent conversation summaries beyond 10 messages
- **Future**: Integrate with SecondBrainService to query `second_brain_memory` table

❌ **Automatic Summarization**

- **Status**: Not implemented
- **Location**: `MemoryUpdateNode.shouldUpdateLongTermSummary()` has logic but no implementation
- **Impact**: Old messages are simply discarded, no summarization
- **Future**: LLM-based summarization when approaching message limit

❌ **Persistent Checkpointer**

- **Status**: Using MemorySaver (in-memory only)
- **Impact**: State lost on server restart, HITL flows can't resume after restart
- **Future**: Implement SupabaseCheckpointer for production

❌ **Conversation Memory Table**

- **Status**: V1 has `conversation_memory` table, V2 doesn't use it
- **Impact**: No persistent conversation history in database
- **Future**: Decide whether to keep or remove (see BLUEPRINT.md open questions)

### 6.2 Future Enhancements

🔮 **Long-Term Summary Generation**

```typescript
// Future implementation in MemoryUpdateNode
if (shouldUpdateSummary) {
	const summary = await this.generateSummary(trimmedMessages);
	// Store in SecondBrainService or conversation_memory table
	await secondBrainService.storeMemory(userId, summary, {
		category: "conversation_summary",
		timestamp: Date.now(),
	});
}
```

🔮 **Smart Message Pruning**

- Prioritize important messages (with disambiguation, significant operations)
- Keep system messages longer
- Summarize old messages instead of discarding

🔮 **Context Window Optimization**

- Dynamic token limits based on user plan tier
- Adaptive message count based on conversation complexity
- Intelligent message selection (keep most relevant)

🔮 **Cross-Session Memory**

- Link related conversations
- Maintain user preferences across sessions
- Build user profile from conversation history

### 6.3 Integration Points

**SecondBrainService Integration**:

- Currently used for knowledge storage (facts, notes)
- Could be extended for conversation summaries
- Vector search could find related past conversations

**Supabase Integration**:

- `conversation_memory` table exists but unused in V2
- Could store persistent conversation history
- Could store long-term summaries

**Checkpointer Migration**:

- Need to implement `SupabaseCheckpointer`
- Requires `langgraph_checkpoints` table
- Enables true pause/resume across server restarts

---

## 7. Memory Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    MEMORY FLOW SUMMARY                      │
└─────────────────────────────────────────────────────────────┘

REQUEST START
     │
     ▼
┌──────────────────────────────────────┐
│  ContextAssemblyNode                 │
│  ├─ Add user msg to MemoryService   │ ✅ Working
│  ├─ Load recentMessages             │ ✅ Working
│  ├─ Load longTermSummary             │ ❌ Returns undefined
│  └─ Build time context                │ ✅ Working
└──────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────┐
│  Graph Execution                     │
│  ├─ PlannerNode uses recentMessages │ ✅ Working
│  ├─ Resolvers use recentMessages    │ ✅ Working
│  ├─ EntityResolution uses refs.tasks│ ✅ Working
│  └─ ReplyContext uses recentMessages│ ✅ Working
└──────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────┐
│  HITLGateNode (if interrupt needed)  │
│  └─ Add interrupt msg to memory     │ ✅ Working (before interrupt)
└──────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────┐
│  MemoryUpdateNode                    │
│  ├─ Add user message                 │ ✅ Working
│  ├─ Add assistant response to mem   │ ✅ Working (via MemoryService)
│  ├─ Enforce 10 message limit         │ ✅ Working
│  ├─ Enforce 500 token limit          │ ✅ Working
│  ├─ Validate user msg in memory     │ ✅ Working
│  └─ Update long-term summary          │ ❌ Not implemented
└──────────────────────────────────────┘
     │
     ▼
REQUEST END
     │
     ▼
┌──────────────────────────────────────┐
│  State Persisted                     │
│  ├─ Recent messages (10 max)        │ ✅ In state + ConversationWindow
│  ├─ Disambiguation                  │ ✅ In state + checkpointer (while interrupted)
│  ├─ Image context                   │ ✅ In state (recent ~5 minutes)
│  └─ Long-term summary               │ ❌ Not stored
└──────────────────────────────────────┘
```

---

## 8. Constants & Configuration

**Memory Limits** (defined in `MemoryUpdateNode.ts`):

```typescript
const MAX_RECENT_MESSAGES = 10;
const MAX_TOKENS_ESTIMATE = 500;
const CHARS_PER_TOKEN = 4; // Rough approximation
```

**ConversationWindow Configuration** (defined in `Memo_v2/src/services/memory/ConversationWindow.ts`):

```typescript
MAX_TOTAL_MESSAGES = 10;
MAX_TOTAL_TOKENS = 500;
MAX_RECENT_TASKS = 4;
MAX_SYSTEM_MESSAGES = 3;
CHARS_PER_TOKEN = 3.5;
CONVERSATION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
DISAMBIGUATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
```

**Important**: `DISAMBIGUATION_EXPIRY_MS` applies to **MemoryService metadata** stored in `ConversationWindow` (for potential follow-up handling). It is **not** the LangGraph interrupt timeout.

**LangGraph interrupt timeout** (defined in `Memo_v2/src/graph/index.ts`):

```typescript
const INTERRUPT_TIMEOUT_MS = 1 * 60 * 1000; // 1 minute
```

---

## 9. Testing & Validation

**Memory Update Tests**:

- Location: `Memo_v2/tests/nodes/pipeline.test.ts`
- Tests: Message addition, limit enforcement, token calculation

**State Reducer Tests**:

- Location: `Memo_v2/tests/basic.test.ts`
- Tests: State initialization, reducer behavior

---

## 10. Related Documentation

- **BLUEPRINT.md**: Overall architecture, memory section (7. Memory Architecture)
- **STATE_SCHEMA.md**: Complete type definitions for MemoState
- **SYSTEM_DIAGRAM.md**: Visual memory architecture diagrams
- **RESOLVER_SPECS.md**: How resolvers use memory context

---

## Summary

The Memo V2 memory system is **self-contained** and provides a solid foundation for conversation context management with:

✅ **Working Features**:

- Self-contained memory service (`Memo_v2/src/services/memory/`)
- Short-term memory (10 messages, 500 tokens)
- MemoryService API for all memory operations
- Disambiguation context
- Image context
- Recent tasks (stored in `ConversationWindow` / MemoryService)
- Second Brain knowledge storage

⚠️ **Placeholders** (not implemented):

- Long-term memory summary
- Automatic summarization
- Persistent checkpointer (production)

The system is designed to be extended as needed, with clear integration points for future enhancements.

---

_For implementation details, see the source files referenced throughout this document._
