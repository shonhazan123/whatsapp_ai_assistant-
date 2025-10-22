# 🚀 Refactor Next Steps - Implementation Guide

## 📊 Current Status: 60% Complete

### ✅ What's Been Built (Solid Foundation)

All the **core infrastructure** is in place:
- ✅ Utilities (time, fuzzy matching, text processing)
- ✅ Type system & schemas (Zod validation)
- ✅ Toolsets (Database, Calendar, Gmail, Shared)
- ✅ NLP (IntentParser, Decomposer)
- ✅ Orchestrator Components (Memory, QueryResolver, HITL)

###  What Needs Completion

The remaining work focuses on **wiring everything together**:

1. **FocusGraph.ts** - The main LangGraph orchestrator
2. **Agent Nodes** - Convert existing agents to Node pattern
3. **Webhook Adapter** - Connect WhatsApp to the graph
4. **App Entry Point** - Initialize and run the system
5. **Cleanup** - Remove deprecated files

---

## 🏗️ Implementation Plan

### Phase 1: Create FocusGraph Orchestrator (Priority: HIGH)

**File**: `src/core/orchestrator/FocusGraph.ts`

This is the heart of the new architecture. It should:

```typescript
import { StateGraph } from "@langchain/langgraph";
import { MemoryManager } from './MemoryManager';
import { HITLNode } from './HITLNode';
import { QueryResolverNode } from './QueryResolverNode';
import { IntentParser } from '../nlp/IntentParser';
// Import agent nodes when created

export class FocusGraph {
  private graph: StateGraph;
  private memoryManager: MemoryManager;
  private hitlNode: HITLNode;
  private queryResolver: QueryResolverNode;
  private intentParser: IntentParser;
  
  constructor() {
    // Initialize components
    // Build graph with nodes and edges
    // Define state transitions
  }
  
  async run(userPhone: string, messageText: string): Promise<string> {
    // 1. Check for pending HITL
    // 2. Get conversation history
    // 3. Parse intent
    // 4. Create initial state
    // 5. Execute graph
    // 6. Save to memory
    // 7. Return response
  }
}
```

**Key Responsibilities**:
- Manage graph state flow
- Route to appropriate agent nodes
- Handle HITL interceptions
- Coordinate memory persistence

---

### Phase 2: Convert Agents to Nodes (Priority: HIGH)

**Pattern to Follow**:

```typescript
// OLD Pattern (BaseAgent with executeWithAI)
class CalendarAgent extends BaseAgent {
  async processRequest(message: string, userPhone: string): Promise<string> {
    return await this.executeWithAI(message, userPhone, this.getSystemPrompt(), this.getFunctions());
  }
}

// NEW Pattern (LangGraph Node)
class CalendarAgentNode {
  private toolset: CalendarToolset;
  
  constructor(toolset: CalendarToolset) {
    this.toolset = toolset;
  }
  
  async execute(state: AgentState): Promise<Partial<AgentState>> {
    // 1. Extract operation from state
    // 2. Use toolset to execute
    // 3. Format response
    // 4. Return state updates
  }
}
```

**Files to Create**:
- `src/core/agents/MainAgentNode.ts`
- `src/core/agents/DatabaseAgentNode.ts`
- `src/core/agents/CalendarAgentNode.ts`
- `src/core/agents/GmailAgentNode.ts`
- `src/core/agents/PlannerAgentNode.ts`

**Key Changes**:
- Nodes receive **state** (not raw message)
- Nodes return **state updates** (not string response)
- LLM reasoning happens in **MainAgentNode only**
- Other nodes use **toolsets directly**

---

### Phase 3: Create Webhook Adapter (Priority: HIGH)

**File**: `src/adapters/whatsapp/Webhook.ts`

```typescript
export class WhatsAppAdapter {
  private focusGraph: FocusGraph;
  
  async handleIncomingMessage(message: WhatsAppMessage): Promise<void> {
    // 1. Extract user phone & text
    // 2. Handle audio transcription if needed
    // 3. Call focusGraph.run()
    // 4. Send response back via WhatsApp
  }
}
```

This replaces the current `webhook.ts` routing logic.

---

### Phase 4: Update Entry Point (Priority: MEDIUM)

**File**: `src/app/index.ts`

```typescript
import express from 'express';
import { FocusGraph } from '../core/orchestrator/FocusGraph';
import { WhatsAppAdapter } from '../adapters/whatsapp/Webhook';

const app = express();
const focusGraph = new FocusGraph();
const whatsappAdapter = new WhatsAppAdapter(focusGraph);

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  await whatsappAdapter.handleIncomingMessage(req.body);
});

app.listen(3000);
```

---

### Phase 5: Cleanup (Priority: LOW)

**Files to Delete**:
- `src/graph/types.ts` (replaced by `src/types/schema.ts`)
- `src/graph/state.ts` (replaced by FocusGraph)
- `src/graph/nodes/` (replaced by orchestrator)
- `src/hitl/` (replaced by `HITLNode.ts`)
- `src/index-v2.ts` (replaced by `app/index.ts`)
- `src/orchestration/MultiAgentCoordinator.ts` (replaced by FocusGraph)

**Files to Keep** (still used):
- All `src/services/` - reused by toolsets
- All `src/config/` - still needed
- `src/routes/webhook.ts` - can be adapted or replaced

---

## 🎯 Critical Design Decisions

### 1. State Flow

```
Initial State → IntentParser → QueryResolver → [Agent Node] → HITL (if needed) → Response
```

State carries:
- User context (phone, message)
- Intent & entities
- Candidates (if multiple matches)
- Selected item (after resolution)
- Result & response

### 2. Agent Responsibility Split

| Agent | Responsibility | Uses LLM? | Uses Toolset? |
|-------|---------------|-----------|---------------|
| MainAgent | Orchestration, general conversation | ✅ Yes | ❌ No |
| DatabaseAgent | Execute DB operations from resolved state | ❌ No | ✅ Yes |
| CalendarAgent | Execute calendar operations | ❌ No | ✅ Yes |
| GmailAgent | Execute email operations | ❌ No | ✅ Yes |
| PlannerAgent | Decompose & sequence multi-step tasks | ✅ Yes | ❌ No |

### 3. When to Use Each Component

| Component | When to Use |
|-----------|-------------|
| **IntentParser** | Every message (determines routing) |
| **QueryResolver** | Update/delete/search operations (finds candidates) |
| **HITLNode** | Multiple candidates OR destructive action |
| **Toolset** | Actual CRUD execution |
| **MemoryManager** | Every conversation (save/retrieve) |

---

## 📝 Implementation Checklist

- [ ] Implement `FocusGraph.ts` with state graph
- [ ] Convert `MainAgent` to `MainAgentNode`
- [ ] Convert `DatabaseAgent` to `DatabaseAgentNode`
- [ ] Convert `CalendarAgent` to `CalendarAgentNode`
- [ ] Convert `GmailAgent` to `GmailAgentNode`
- [ ] Create `PlannerAgentNode` (new)
- [ ] Create `WhatsAppAdapter`
- [ ] Create `src/app/index.ts` entry point
- [ ] Test intent detection flow
- [ ] Test QueryResolver with fuzzy matching
- [ ] Test HITL clarification flow
- [ ] Test end-to-end message processing
- [ ] Delete deprecated files
- [ ] Update documentation

---

## 🧪 Testing Strategy

### Unit Tests
- Time parsing (Hebrew & English)
- Fuzzy matching accuracy
- Intent detection
- Entity extraction

### Integration Tests
- Full message → response flow
- HITL clarification scenarios
- Multi-candidate resolution
- Recurring event creation

### E2E Tests
- WhatsApp message handling
- Database operations
- Calendar sync
- Email sending

---

## 💡 Key Insights from Refactor

1. **Separation of Concerns**: LLM reasoning (MainAgent) is now separate from execution (Toolsets)

2. **Natural Language Resolution**: QueryResolver handles "update the meeting tomorrow" → finds specific event

3. **Human Approval**: HITL built into the flow, not an afterthought

4. **State-Driven**: State carries all context, agents don't need to maintain state

5. **Reuse Everything**: All existing services, DB schema, integrations preserved

---

## 🚦 Ready to Continue?

The foundation is solid. The remaining work is primarily:
1. **Wiring** - Connect components in FocusGraph
2. **Adaptation** - Convert agents to node pattern
3. **Integration** - Hook up WhatsApp adapter

**Estimated Time**: 2-3 hours of focused implementation

All the hard parts (fuzzy matching, time parsing, HITL logic, toolsets) are done!

