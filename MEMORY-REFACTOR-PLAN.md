# 🧠 Memory System Refactor Plan

## **📊 Current Memory Flow Analysis**

### **Current System Components:**

1. **ConversationStateManager** - Tracks entities, intents, topics, HITL state
2. **ContextBuilder** - Builds rich context from entities + history
3. **ConversationEnhancer** - Resolves pronouns using LLM
4. **Database Memory Service** - Saves/loads conversation history from Supabase
5. **MainAgent** - Orchestrates context passing to other agents

### **Current Flow:**

```
WhatsApp Message → MainAgent → ConversationStateManager.loadState() →
ConversationEnhancer.enhanceMessage() → getConversationHistory() →
Token trimming → Route to agent → saveMessage() → saveState()
```

### **Problems Identified:**

- ❌ **Complex entity tracking** with timeouts and cleanup
- ❌ **Database overhead** for every conversation
- ❌ **Inconsistent context passing** between agents
- ❌ **Manual pronoun resolution** that often fails
- ❌ **Multiple memory systems** (ConversationStateManager + Database)

---

## **🎯 Target Architecture**

Replace the current memory logic with a local, lightweight, ChatGPT-style conversation window, with these rules:

### **Core Rules**

- Store the recent conversation only in memory, not in Supabase
- Keep a rolling window of the last N exchanges (by token count, e.g. ~8,000 tokens or 10–15 turns)
- On every incoming WhatsApp message:
  - Retrieve that local conversation window (user ↔ assistant exchanges)
  - Concatenate it with the system prompt and current message
  - Pass this full concatenated context to the MainAgent for reasoning
- The MainAgent passes this same conversation context to all domain agents it activates (CalendarAgent, DatabaseAgent, GmailAgent, PlannerAgent)
- Every agent has access to the full dialogue history in its prompt input
- HITL (human confirmation) and QueryResolver still function as before — they can see and reference the conversation context too
- When token count exceeds limit, drop the oldest messages
- Optionally, you may later add a summarization layer (every 20 messages) to condense old history, but do not use the database for memory storage anymore

---

## **🎯 Detailed Multi-Phase Refactor Plan**

### **Phase 1: Analyze Current Flow**

**Goal:** Identify all components that handle memory, entity, and context passing

**Components to Remove/Update:**

- `ConversationStateManager` - Remove entirely
- `ContextBuilder` - Remove entirely
- `ConversationEnhancer` - Remove entirely
- `src/services/memory.ts` - Remove database conversation storage
- `MainAgent.processRequest()` - Simplify context handling
- All agent routing methods - Update to pass conversation context

**Acceptance Criteria:**

- ✅ List of all components that must be removed or updated
- ✅ Understanding of current context flow
- ✅ Identification of database dependencies

---

### **Phase 2: Design New Local Memory Manager**

**Goal:** Create a lightweight singleton that stores messages in memory

**New Component:** `src/core/memory/ConversationWindow.ts`

```typescript
interface ConversationMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

class ConversationWindow {
	private memory = new Map<string, ConversationMessage[]>();
	private readonly MAX_TOKENS = 8000;
	private readonly SYSTEM_TOKENS = 500;

	addMessage(userPhone: string, role: string, content: string): void;
	getContext(userPhone: string): ConversationMessage[];
	trimToTokenLimit(userPhone: string): void;
	clear(userPhone: string): void;
}
```

**Acceptance Criteria:**

- ✅ Simple API: `addMessage()`, `getContext()`, `trimToTokenLimit()`
- ✅ In-memory storage only (no database)
- ✅ Token-based trimming
- ✅ Singleton pattern

---

### **Phase 3: Integrate with MainAgent**

**Goal:** Replace all calls to ConversationStateManager/ContextBuilder

**Changes to MainAgent:**

```typescript
// OLD:
await this.conversationState.loadState(userPhone);
const enhanced = await this.conversationEnhancer.enhanceMessage(
	message,
	userPhone,
	this.conversationState
);
let history = await getConversationHistory(userPhone);

// NEW:
const conversationWindow = ConversationWindow.getInstance();
conversationWindow.addMessage(userPhone, "user", message);
const context = conversationWindow.getContext(userPhone);
```

**Acceptance Criteria:**

- ✅ MainAgent builds full prompt = (system + last messages + new input)
- ✅ No more ConversationStateManager calls
- ✅ No more ConversationEnhancer calls
- ✅ No more database conversation history calls

---

### **Phase 4: Share Context with All Agents**

**Goal:** When MainAgent calls other agents, pass conversationContext as argument

**Changes to Agent Routing:**

```typescript
// OLD:
return this.agentManager
	.getDatabaseAgent()
	.processRequest(enhanced.enhanced, userPhone);

// NEW:
return this.agentManager
	.getDatabaseAgent()
	.processRequest(message, userPhone, context);
```

**Changes to All Agents:**

```typescript
// Add context parameter to all agents
async processRequest(message: string, userPhone: string, context?: ConversationMessage[]): Promise<string>
```

**Acceptance Criteria:**

- ✅ All agents receive the same context string
- ✅ Context includes full conversation history
- ✅ No more enhanced message passing

---

### **Phase 5: Implement Token Trimming**

**Goal:** Add simple token-count check and remove oldest exchanges if limit exceeded

**Implementation:**

```typescript
private trimToTokenLimit(userPhone: string): void {
  const messages = this.memory.get(userPhone) || [];
  let totalTokens = this.estimateTokens(messages);

  while (totalTokens > this.MAX_TOKENS - this.SYSTEM_TOKENS && messages.length > 0) {
    messages.shift(); // Remove oldest message
    totalTokens = this.estimateTokens(messages);
  }
}
```

**Acceptance Criteria:**

- ✅ Keeps memory under 8k tokens
- ✅ Removes oldest messages first
- ✅ Preserves recent context

---

### **Phase 6: Clean Up Old Modules**

**Goal:** Safely remove ConversationStateManager, ContextBuilder, and pronoun/entity resolution code

**Files to Remove:**

- `src/core/memory/ConversationStateManager.ts`
- `src/core/memory/ContextBuilder.ts`
- `src/core/nlp/ConversationEnhancer.ts`
- `src/core/nlp/PronounResolver.ts`
- `src/core/nlp/TopicExtractor.ts`

**Files to Update:**

- Remove imports and references
- Update MainAgent constructor
- Remove database conversation storage

**Acceptance Criteria:**

- ✅ No broken references
- ✅ All old memory modules removed
- ✅ Clean imports

---

### **Phase 7: Verify HITL & QueryResolver**

**Goal:** Ensure both continue to work and receive context

**Changes:**

- Update HITLNode to receive conversation context
- Update QueryResolver to use conversation context
- Ensure clarification flow unchanged

**Acceptance Criteria:**

- ✅ HITL clarification flow unchanged
- ✅ QueryResolver can access conversation history
- ✅ Multi-candidate resolution works

---

### **Phase 8: Testing**

**Goal:** Confirm context continuity, pronoun understanding, and multi-agent memory sharing

**Test Cases:**

1. **Context Continuity:** "Create a task" → "Update it" → "Delete it"
2. **Pronoun Understanding:** "Add meeting tomorrow" → "Change the time" → "Cancel it"
3. **Multi-Agent Memory:** DatabaseAgent → CalendarAgent → GmailAgent (shared context)
4. **Token Trimming:** Long conversation → Old messages removed
5. **HITL Flow:** Multiple candidates → User selection → Context preserved

**Acceptance Criteria:**

- ✅ End-to-end conversation stays coherent
- ✅ Pronouns resolve correctly
- ✅ Context shared across all agents
- ✅ No database overhead for memory

---

## **🚀 Expected Final Behavior**

After refactor:

- ✅ **Simple memory:** Just a sliding window of recent messages
- ✅ **Fast context:** No database reads for conversation history
- ✅ **Consistent sharing:** All agents get the same context
- ✅ **Natural understanding:** LLM handles pronouns automatically
- ✅ **Easy debugging:** Clear conversation flow
- ✅ **Scalable:** No database bloat from conversation storage

---

## **📋 Implementation Guidelines**

Keep the conversation window in memory (e.g., Map keyed by user phone number).

```typescript
const memory = new Map<string, MessageHistory[]>(); // userPhone -> recent messages
```

Each message added as `{ role: "user" | "assistant", content: string }`

On new WhatsApp message:

1. Load history: `ConversationWindow.get(userPhone)`
2. Trim to token limit
3. Add new message
4. Pass combined messages → MainAgent → downstream agents

No DB reads/writes for memory anymore.

Still save structured data (tasks, contacts, events) to Supabase normally.

---

## **🧰 Deliverables per Phase**

- A short explanation of what changed
- Code diffs or pseudo examples
- One minimal test case to confirm function
