# Memo V2 — LangGraph Architecture Blueprint

> **Status**: Draft v1.1  
> **Last Updated**: January 2026  
> **Purpose**: Complete technical specification for migration from V1 to LangGraph-based V2

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [WhatsApp & Webhook Reuse (V1)](#3-whatsapp--webhook-reuse-v1)
4. [LLM Configuration Management](#4-llm-configuration-management)
5. [LangGraph Node Design](#5-langgraph-node-design)
6. [State Schema](#6-state-schema)
7. [Memory Architecture](#7-memory-architecture)
8. [Resolver Strategy](#8-resolver-strategy)
9. [Cron & Scheduled Jobs (V1 Reuse)](#9-cron--scheduled-jobs-v1-reuse)
10. [Response Pipeline](#10-response-pipeline)
11. [Module Structure](#11-module-structure)
12. [Interfaces & Contracts](#12-interfaces--contracts)
13. [Migration Plan](#13-migration-plan)
14. [Dependencies](#14-dependencies)
15. [Open Questions](#15-open-questions)

---

## 1. Executive Summary

### What is Memo V2?

Memo is a WhatsApp-based AI personal secretary that:

- Organizes thoughts, tasks, calendar, emails, and ideas
- Acts proactively (nudges, planning help, follow-ups)
- Handles ambiguity safely with Human-in-the-Loop (HITL)
- Scales without "prompt spaghetti"

### Why LangGraph?

LangGraph provides:

- **Explicit state** — No logic hidden in prompts
- **Deterministic branching** — HITL, ambiguity, risk gates
- **Pause/Resume** — Human replies, cron jobs
- **Parallel execution** — Calendar + DB + Gmail safely
- **Auditability** — Debuggability + cost control

### Core Principles (Non-Negotiable)

1. **Single assistant identity** — Users talk to Memo, internal capabilities never speak
2. **LLMs reason, code executes** — LLMs decide intent; code performs side effects
3. **Explicit state over prompt magic** — No hidden logic in prompts
4. **HITL is first-class** — Ambiguity pauses execution and resumes cleanly

---

## 2. System Overview

### 2.1 Capabilities

| Capability     | Description                                 | Existing V1 Mapping                        |
| -------------- | ------------------------------------------- | ------------------------------------------ |
| `calendar`     | Google Calendar CRUD, recurring, conflicts  | `CalendarAgent` + `CalendarFunctions`      |
| `database`     | Reminders, tasks, lists, nudges             | `DatabaseAgent` + `DatabaseFunctions`      |
| `gmail`        | Draft, reply, send, search                  | `GmailAgent` + `GmailFunctions`            |
| `second-brain` | RAG-based notes, ideas, reflections         | `SecondBrainAgent` + `SecondBrainFunction` |
| `general`      | Questions, advice, brainstorming (no tools) | `MainAgent` general responses              |
| `meta`         | "What can you do?" — predefined responses   | New (currently in prompts)                 |

### 2.2 Trigger Types

```
┌─────────────────────────────────────────────────────────────┐
│                      TRIGGER TYPES                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  USER-TRIGGERED                    SYSTEM-TRIGGERED         │
│  ├─ Text message                   ├─ Morning brief (cron)  │
│  ├─ Voice → text                   ├─ Nudge reminders       │
│  └─ Image → analysis               └─ Overdue notifications │
│                                                             │
│  → Full LangGraph flow             → Lightweight sub-flow   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 High-Level Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER-TRIGGERED FLOW                              │
└──────────────────────────────────────────────────────────────────────────┘

WhatsApp Message
       │
       ▼
┌──────────────────┐
│ ContextAssembly  │  ← User profile, timezone, short-term memory
│     Node         │    long-term memory summary, runtime now
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  ReplyContext    │  ← Reply-to detection, numbered list parsing
│     Node         │    Image context retrieval
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Planner Node   │  ← LLM: Natural language → Plan DSL
│      (LLM)       │    Outputs intent_type, confidence, plan[]
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   HITL Gate      │  ← Confidence check, missing fields, risk level
│     Node         │    Uses interrupt() for clarification
└────────┬─────────┘
         │
    ┌────┴────────────────────────────────────┐
    │ (needs clarification?)                   │
    │                                          │
    ▼ NO                                   YES ▼
    │                              ┌──────────────────┐
    │                              │   interrupt()    │ → Graph pauses
    │                              │   Returns to     │   State saved
    │                              │   webhook        │
    │                              └──────────────────┘
    │                                          │
    │                              [User replies]
    │                                          │
    │                              ┌──────────────────┐
    │                              │ Command({resume})│ → Graph resumes
    │                              │   Continue here  │
    │                              └────────┬─────────┘
    │                                       │
    └───────────────┬───────────────────────┘
                    │
                    ▼
┌──────────────────┐
│ ResolverRouter   │  ← Build DAG from plan[], route to resolvers
│     Node         │    Determines parallel execution
└────────┬─────────┘
         │
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
┌────────┐ ┌────────┐ ┌────────┐
│Calendar│ │Database│ │ Gmail  │  ← LLM: PlanStep → Tool args
│Resolver│ │Resolver│ │Resolver│    Uses QueryResolver for entity lookup
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐
│Calendar│ │Database│ │ Gmail  │  ← Code: Execute tool calls
│Executor│ │Executor│ │Executor│    No LLM here
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    └────┬─────┴──────────┘
         │
         ▼
┌──────────────────┐
│    Join Node     │  ← Merge results, detect partial failures
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ResponseFormatter │  ← Code: ISO dates → human, categorization
│     (Code)       │    Metadata extraction
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ ResponseWriter   │  ← LLM: Tone, phrasing, UX polish
│     (LLM)        │    Or template for simple responses
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  MemoryUpdate    │  ← Code: Update short-term memory
│     Node         │    Optional LLM for summarization
└────────┬─────────┘
         │
         ▼
    WhatsApp Response
```

---

## 3. WhatsApp & Webhook Reuse (V1)

> ⚠️ **CRITICAL**: Do NOT rewrite the WhatsApp message handling. Reuse V1 as-is.

### 3.1 Files to Reuse Directly

| V1 File                 | Purpose                                   | Changes for V2                                                  |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `src/index.ts`          | Express server, routes, scheduler startup | Update import to call V2 graph instead of `processMessageV2`    |
| `src/index-v2.ts`       | Entry point for message processing        | Replace `MainAgent.processRequest` with LangGraph `invokeGraph` |
| `src/routes/webhook.ts` | WhatsApp webhook handlers                 | Minimal changes - call V2 graph instead of `processMessageV2`   |

### 3.2 Webhook Flow (Unchanged)

The existing webhook flow remains **exactly the same**:

```
WhatsApp POST /webhook/whatsapp
         │
         ▼
┌──────────────────────────────────────┐
│  handleIncomingMessage() (V1)        │
│  ├─ Normalize phone number           │
│  ├─ Duplicate message ID check       │
│  ├─ Send typing indicator            │
│  ├─ Start performance tracking       │
│  ├─ Handle message type:             │
│  │   ├─ text → direct               │
│  │   ├─ audio → transcribeAudio()    │
│  │   └─ image → analyzeImage()       │
│  ├─ Onboarding check                 │
│  └─ Call processMessageV2()  ←─────── ONLY THIS CHANGES
└──────────────────────────────────────┘
         │
         ▼  (V2 replaces this call)
┌──────────────────────────────────────┐
│  LangGraph.invoke(message, context)  │
│  ← Returns final_response string     │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  sendWhatsAppMessage(response)       │
│  ├─ Post-agent onboarding check      │
│  ├─ End performance tracking         │
│  └─ Upload performance logs          │
└──────────────────────────────────────┘
```

### 3.3 What V2 Replaces

**V1 (current)**:

```typescript
// src/routes/webhook.ts line ~295
const response = await RequestContext.run(context, () =>
	processMessageV2(userPhone, messageText, {
		whatsappMessageId: message.id,
		replyToMessageId: replyToMessageId,
	})
);
```

**V2 (new)**:

```typescript
// Same location, different call
const response = await RequestContext.run(context, () =>
	invokeMemoGraph(userPhone, messageText, {
		whatsappMessageId: message.id,
		replyToMessageId: replyToMessageId,
		triggerType: "user",
	})
);
```

### 3.4 Preserved V1 Logic

The following V1 logic is **preserved without modification**:

- `normalizeWhatsAppNumber()` — Phone number normalization
- `MessageIdCache` — Duplicate message prevention
- `sendTypingIndicator()` — UX feedback
- `PerformanceTracker` — Performance logging
- `transcribeAudio()` — Voice message transcription
- `openaiService.analyzeImage()` — Image analysis
- `conversationWindow.addMessage()` — Image context storage
- `onboardingHandler.handleUserMessage()` — Onboarding flow
- `onboardingHandler.handlePostAgentResponse()` — Post-response onboarding
- `sendWhatsAppMessage()` — WhatsApp response sending
- `DebugForwarderService` — Debug environment forwarding

---

## 4. LLM Configuration Management

> ⚠️ **CRITICAL**: Create a centralized config for all LLM usage. Different models have different capabilities.

### 4.1 Why This Matters

| Capability       | gpt-4o | gpt-4o-mini | o1/o3      | Notes                       |
| ---------------- | ------ | ----------- | ---------- | --------------------------- |
| Prompt Caching   | ✅     | ✅          | ❌         | o1/o3 don't support caching |
| Function Calling | ✅     | ✅          | ⚠️ Limited | o1 has different format     |
| Streaming        | ✅     | ✅          | ❌         | o1/o3 don't stream          |
| Cost             | $$$$   | $$          | $$$$$      | 4o-mini is cheapest         |
| Speed            | Fast   | Faster      | Slow       | o1 is slow                  |
| Reasoning        | Good   | Good        | Excellent  | o1 for complex planning     |

### 4.2 Global LLM Config Schema

```typescript
// src/config/llm-config.ts

export interface LLMModelConfig {
	model: string;
	maxTokens?: number;
	temperature?: number;

	// Capability flags
	supportsCaching: boolean;
	supportsFunctionCalling: boolean;
	supportsStreaming: boolean;

	// Function calling format
	functionFormat: "tools" | "functions" | "none";

	// Cost tracking
	inputCostPer1k: number; // USD
	outputCostPer1k: number; // USD
}

export interface LLMUsageConfig {
	// Per-node model selection
	planner: LLMModelConfig;
	resolvers: {
		calendar: LLMModelConfig;
		database: LLMModelConfig;
		gmail: LLMModelConfig;
		secondBrain: LLMModelConfig;
		general: LLMModelConfig;
	};
	responseWriter: LLMModelConfig;
	imageAnalysis: LLMModelConfig;

	// Global defaults
	default: LLMModelConfig;

	// Fallback chain
	fallbackOrder: string[];
}

export const LLM_MODELS: Record<string, LLMModelConfig> = {
	"gpt-4o": {
		model: "gpt-4o",
		supportsCaching: true,
		supportsFunctionCalling: true,
		supportsStreaming: true,
		functionFormat: "tools",
		inputCostPer1k: 0.0025,
		outputCostPer1k: 0.01,
	},
	"gpt-4o-mini": {
		model: "gpt-4o-mini",
		supportsCaching: true,
		supportsFunctionCalling: true,
		supportsStreaming: true,
		functionFormat: "tools",
		inputCostPer1k: 0.00015,
		outputCostPer1k: 0.0006,
	},
	o1: {
		model: "o1",
		supportsCaching: false,
		supportsFunctionCalling: false,
		supportsStreaming: false,
		functionFormat: "none",
		inputCostPer1k: 0.015,
		outputCostPer1k: 0.06,
	},
	"o1-mini": {
		model: "o1-mini",
		supportsCaching: false,
		supportsFunctionCalling: false,
		supportsStreaming: false,
		functionFormat: "none",
		inputCostPer1k: 0.003,
		outputCostPer1k: 0.012,
	},
	"gpt-4.1-nano": {
		model: "gpt-4.1-nano", // hypothetical
		supportsCaching: true,
		supportsFunctionCalling: true,
		supportsStreaming: true,
		functionFormat: "tools",
		inputCostPer1k: 0.0001,
		outputCostPer1k: 0.0004,
	},
};
```

### 4.3 Default Configuration

```typescript
// src/config/llm-config.ts (continued)

export const DEFAULT_LLM_CONFIG: LLMUsageConfig = {
	// Planner: needs good reasoning, can use caching
	planner: LLM_MODELS["gpt-4o-mini"],

	// Resolvers: need function calling
	resolvers: {
		calendar: LLM_MODELS["gpt-4o-mini"],
		database: LLM_MODELS["gpt-4o-mini"],
		gmail: LLM_MODELS["gpt-4o-mini"],
		secondBrain: LLM_MODELS["gpt-4o-mini"],
		general: LLM_MODELS["gpt-4o-mini"],
	},

	// Response writer: cheap, fast
	responseWriter: LLM_MODELS["gpt-4o-mini"],

	// Image analysis: needs vision
	imageAnalysis: LLM_MODELS["gpt-4o"],

	// Default fallback
	default: LLM_MODELS["gpt-4o-mini"],

	// Fallback order if model fails
	fallbackOrder: ["gpt-4o-mini", "gpt-4o"],
};
```

### 4.4 LLM Service Wrapper

```typescript
// src/services/llm/LLMService.ts

export class LLMService {
	private config: LLMUsageConfig;

	constructor(config: LLMUsageConfig = DEFAULT_LLM_CONFIG) {
		this.config = config;
	}

	/**
	 * Get the model config for a specific node
	 */
	getModelConfig(node: keyof LLMUsageConfig | string): LLMModelConfig {
		if (node in this.config) {
			return this.config[node as keyof LLMUsageConfig] as LLMModelConfig;
		}
		return this.config.default;
	}

	/**
	 * Create completion with automatic config handling
	 */
	async createCompletion(
		nodeType: string,
		messages: ChatMessage[],
		options?: {
			functions?: FunctionDefinition[];
			tools?: ToolDefinition[];
		}
	): Promise<CompletionResult> {
		const modelConfig = this.getModelConfig(nodeType);

		// Handle function calling format differences
		let requestOptions: any = {
			model: modelConfig.model,
			messages,
			max_tokens: modelConfig.maxTokens,
			temperature: modelConfig.temperature,
		};

		if (options?.functions || options?.tools) {
			if (!modelConfig.supportsFunctionCalling) {
				// For o1/o3: embed function schemas in system prompt instead
				messages = this.embedFunctionsInPrompt(messages, options);
			} else if (modelConfig.functionFormat === "tools") {
				requestOptions.tools =
					options.tools || this.convertToTools(options.functions);
			} else {
				requestOptions.functions = options.functions;
			}
		}

		// Handle caching
		if (modelConfig.supportsCaching) {
			// OpenAI auto-caches based on static prefix
			// Ensure system prompt is first and static
		}

		return await this.openai.chat.completions.create(requestOptions);
	}

	/**
	 * Update model config at runtime (for A/B testing, rollout)
	 */
	setModelForNode(node: string, model: string): void {
		if (model in LLM_MODELS) {
			(this.config as any)[node] = LLM_MODELS[model];
		}
	}
}
```

### 4.5 Environment Override

```bash
# .env
LLM_PLANNER_MODEL=gpt-4o
LLM_RESOLVER_MODEL=gpt-4o-mini
LLM_RESPONSE_MODEL=gpt-4o-mini
LLM_IMAGE_MODEL=gpt-4o
```

```typescript
// Load from environment
function loadLLMConfigFromEnv(): Partial<LLMUsageConfig> {
	return {
		planner: process.env.LLM_PLANNER_MODEL
			? LLM_MODELS[process.env.LLM_PLANNER_MODEL]
			: undefined,
		// ... etc
	};
}
```

---

## 5. LangGraph Node Design

### 5.1 Node Registry

| Node                     | Type     | LLM? | Purpose                                        |
| ------------------------ | -------- | ---- | ---------------------------------------------- |
| `ContextAssemblyNode`    | Code     | ❌   | Build clean state from user profile, memory    |
| `ReplyContextNode`       | Code     | ❌   | Handle reply-to, numbered lists, image context |
| `PlannerNode`            | LLM      | ✅   | Natural language → Plan DSL                    |
| `HITLGateNode`           | Code     | ❌   | Confidence/risk check, pause if needed         |
| `ResolverRouterNode`     | Code     | ❌   | Build DAG, route to resolvers                  |
| `CalendarFindResolver`   | LLM      | ✅   | Calendar search/get → tool args                |
| `CalendarMutateResolver` | LLM      | ✅   | Calendar create/update/delete → tool args      |
| `DatabaseTaskResolver`   | LLM      | ✅   | Task CRUD → tool args                          |
| `DatabaseListResolver`   | LLM      | ✅   | List CRUD → tool args                          |
| `GmailResolver`          | LLM      | ✅   | Email operations → tool args                   |
| `SecondBrainResolver`    | LLM      | ✅   | Memory store/search → tool args                |
| `GeneralResolver`        | LLM      | ✅   | Conversation response (no tools)               |
| `MetaResolver`           | Template | ❌   | Predefined capability descriptions             |
| `CalendarExecutor`       | Code     | ❌   | Execute calendar API calls                     |
| `DatabaseExecutor`       | Code     | ❌   | Execute database operations                    |
| `GmailExecutor`          | Code     | ❌   | Execute Gmail API calls                        |
| `SecondBrainExecutor`    | Code     | ❌   | Execute RAG operations                         |
| `JoinNode`               | Code     | ❌   | Merge parallel results                         |
| `ResponseFormatterNode`  | Code     | ❌   | Format dates, categorize, extract metadata     |
| `ResponseWriterNode`     | LLM      | ✅   | Generate final user message                    |
| `MemoryUpdateNode`       | Code     | ❌   | Update state.recent_messages                   |

### 5.2 Node Details

#### ContextAssemblyNode

**Inputs**: WhatsApp message, user phone, trigger type  
**Outputs**: Populated `MemoState`

```typescript
// Pseudocode
function contextAssembly(input: TriggerInput): MemoState {
	const user = await getUserProfile(input.userPhone);
	const recentMessages = getRecentMessages(input.userPhone);
	const longTermSummary = await getLongTermMemorySummary(input.userPhone);

	return {
		user: {
			phone: input.userPhone,
			timezone: user.timezone || "Asia/Jerusalem",
			language: detectLanguage(input.message),
			planTier: user.planTier,
			googleConnected: user.googleConnected,
		},
		input: {
			message: input.message,
			triggerType: input.triggerType,
			whatsappMessageId: input.whatsappMessageId,
			replyToMessageId: input.replyToMessageId,
		},
		now: getCurrentTimeContext(), // Format: [Current time: Day, DD/MM/YYYY HH:mm (ISO+offset)]
		recent_messages: recentMessages,
		long_term_summary: longTermSummary,
		// ... rest initialized as null/empty
	};
}
```

#### ReplyContextNode

**Purpose**: Handle WhatsApp reply context, numbered list references, image context

```typescript
// Pseudocode
function replyContext(state: MemoState): MemoState {
	// 1. Check if this is a reply to a previous message
	if (state.input.replyToMessageId) {
		const repliedTo = findMessageById(state.input.replyToMessageId);
		if (repliedTo) {
			// Check for numbered list (like "1. Event 1\n2. Event 2")
			if (hasNumberedList(repliedTo.content)) {
				state.input.enhancedMessage = buildNumberedListContext(
					repliedTo,
					state.input.message
				);
			} else {
				state.input.enhancedMessage = buildReplyContext(
					repliedTo,
					state.input.message
				);
			}

			// Check for image context in replied message
			if (repliedTo.imageContext) {
				state.input.imageContext = repliedTo.imageContext;
			}
		}
	}

	// 2. Check for image context in recent messages (last 3)
	if (!state.input.imageContext) {
		state.input.imageContext = findRecentImageContext(state.recent_messages);
	}

	// 3. Include image context in enhanced message if found
	if (state.input.imageContext) {
		state.input.enhancedMessage = buildImageContextMessage(
			state.input.imageContext,
			state.input.enhancedMessage || state.input.message
		);
	}

	return state;
}
```

#### PlannerNode

**Purpose**: Convert natural language → Plan DSL  
**Model**: gpt-4o-mini (cacheable system prompt)

**Input Message Structure**:

```
[System Prompt - Static, Cacheable]
[Recent Context - Last 4 messages]
[User Message with Time Context]
```

**Output Schema**:

```typescript
interface PlannerOutput {
	intent_type: "operation" | "conversation" | "meta";
	confidence: number; // 0.0 - 1.0
	risk_level: "low" | "medium" | "high";
	needs_approval: boolean;
	missing_fields: string[];
	plan: PlanStep[];
}

interface PlanStep {
	id: string;
	capability:
		| "calendar"
		| "database"
		| "gmail"
		| "second-brain"
		| "general"
		| "meta";
	action: string; // Semantic action like 'create_event', 'find_task', 'draft_email'
	constraints: Record<string, any>;
	changes: Record<string, any>;
	depends_on: string[];
}
```

**Planner Rules**:

1. Never choose tool schemas or arguments
2. Policy checks happen in code AFTER Planner:
   - Reminder vs calendar distinction
   - Task/reminder priority over memory
3. intent_type = 'conversation' for pure questions
4. intent_type = 'meta' for "what can you do?"
5. intent_type = 'operation' for actions (including mixed)

#### HITLGateNode (Native LangGraph Interrupts)

**Purpose**: Protect correctness and trust using LangGraph's native `interrupt()` mechanism.

**Architecture**: We use LangGraph's built-in HITL system:

- `interrupt(payload)` - Pauses graph and returns payload to caller
- `Command({ resume: value })` - Resumes graph with user input
- `MemorySaver` / `SupabaseCheckpointer` - Persists state between calls
- `thread_id` - Identifies user conversation (= userPhone)

**Triggers interrupt() if**:

- `confidence < 0.7`
- `missing_fields` not empty
- `risk_level = 'high'`
- `needs_approval = true`

**When triggered**:

```typescript
import { interrupt } from "@langchain/langgraph";

function hitlGateNode(state: MemoState) {
	if (needsHITL(state)) {
		// LangGraph native interrupt - pauses graph, persists state
		const userResponse = interrupt({
			type: "clarification",
			question: generateClarificationMessage(state),
			options: state.disambiguation?.candidates?.map((c) => c.displayText),
			metadata: {
				stepId: state.plannerOutput?.plan[0]?.id,
				reason: determineInterruptReason(state),
			},
		});

		// This code runs AFTER user replies and graph resumes
		return {
			...state,
			disambiguation: {
				...state.disambiguation,
				userSelection: userResponse,
				resolved: true,
			},
		};
	}
	return state;
}
```

**Interrupt Flow**:

```
┌─────────────────────────────────────────────────────────────────┐
│                    INTERRUPT FLOW                                │
└─────────────────────────────────────────────────────────────────┘

1. First Message: "Move my meeting tomorrow"
   │
   ├─ graph.invoke(input, { thread_id: userPhone })
   │
   ├─ ContextAssembly → Planner → HITLGate
   │                                   │
   │                              interrupt({ question: "Which meeting?" })
   │                                   │
   │                              ◄────┘ Graph pauses, state saved
   │
   └─ Returns: { type: 'interrupt', payload: { question: "Which meeting?", options: [...] } }

2. User Reply: "The team sync"
   │
   ├─ Webhook detects pending interrupt for thread_id
   │
   ├─ graph.invoke(Command({ resume: "The team sync" }), { thread_id: userPhone })
   │
   ├─ HITLGate receives "The team sync" as userResponse
   │
   └─ Graph continues: ResolverRouter → Resolvers → Executors → Response
```

**Thread ID Strategy**:

```typescript
// Each user has one persistent thread
const threadId = userPhone; // e.g., "+972501234567"

// All messages from same user share state
await graph.invoke(input, {
	configurable: { thread_id: threadId },
});
```

#### ResolverRouterNode

**Purpose**: Route plan steps to appropriate resolvers

```typescript
// Pseudocode
function resolverRouter(state: MemoState): ResolverRoutes {
	const plan = state.planner_output.plan;
	const dag = buildDependencyDAG(plan);

	// Determine parallel groups
	const groups = topologicalSort(dag);

	return {
		routes: plan.map((step) => ({
			stepId: step.id,
			resolver: getResolverForStep(step),
			canRunParallel: !hasPendingDependencies(step, dag),
		})),
		executionOrder: groups,
	};
}

function getResolverForStep(step: PlanStep): string {
	const mapping = {
		"calendar.find": "CalendarFindResolver",
		"calendar.create": "CalendarMutateResolver",
		"calendar.update": "CalendarMutateResolver",
		"calendar.delete": "CalendarMutateResolver",
		"database.task": "DatabaseTaskResolver",
		"database.list": "DatabaseListResolver",
		gmail: "GmailResolver",
		"second-brain": "SecondBrainResolver",
		general: "GeneralResolver",
		meta: "MetaResolver",
	};

	return (
		mapping[`${step.capability}.${getActionGroup(step.action)}`] ||
		mapping[step.capability]
	);
}
```

---

## 6. State Schema

### 6.1 Complete MemoState

```typescript
interface MemoState {
	// === USER CONTEXT ===
	user: {
		phone: string;
		timezone: string;
		language: "he" | "en" | "other";
		planTier: "free" | "pro" | "enterprise";
		googleConnected: boolean;
		capabilities: {
			calendar: boolean;
			gmail: boolean;
			database: boolean;
			secondBrain: boolean;
		};
	};

	// === INPUT ===
	input: {
		message: string;
		enhancedMessage?: string; // With reply/image context
		triggerType: "user" | "cron" | "nudge" | "event";
		whatsappMessageId?: string;
		replyToMessageId?: string;
		imageContext?: ImageContext;
	};

	// === TIME CONTEXT ===
	now: {
		formatted: string; // "[Current time: Day, DD/MM/YYYY HH:mm (ISO+offset), Timezone: Asia/Jerusalem]"
		iso: string;
		timezone: string;
		dayOfWeek: number; // 0-6
	};

	// === MEMORY ===
	recent_messages: ConversationMessage[]; // Max 10, 500 tokens
	long_term_summary?: string; // From second-brain

	// === PLANNER OUTPUT ===
	planner_output?: PlannerOutput;

	// === DISAMBIGUATION ===
	// Note: Interrupt/resume is handled by LangGraph's native interrupt() mechanism
	// These fields are populated AFTER interrupt resumes
	disambiguation?: {
		type: "calendar_event" | "task" | "list" | "email";
		candidates: Array<{ id: string; displayText: string; [key: string]: any }>;
		resolver_step_id: string;
		userSelection?: string; // Filled by interrupt() resume
		resolved: boolean; // True after user responds
	};

	// === RESOLVER RESULTS ===
	resolver_results: Map<string, ResolverResult>;

	// === EXECUTION RESULTS ===
	execution_results: Map<string, ExecutionResult>;

	// === RUNNING CONTEXT (for multi-step) ===
	refs: {
		calendar_events?: any[];
		selected_event_id?: string;
		tasks?: any[];
		selected_task_id?: string;
		contacts?: any[];
		selected_contact_id?: string;
		emails?: any[];
		selected_email_id?: string;
	};

	// === RESPONSE ===
	formatted_response?: FormattedResponse;
	final_response?: string;

	// === CONTROL ===
	// Note: should_pause/pause_reason REMOVED - using LangGraph interrupt() instead
	error?: string;

	// === METADATA ===
	metadata: {
		startTime: number;
		nodeExecutions: NodeExecution[];
		llmCalls: number;
		totalTokens: number;
		totalCost: number;
	};
}
```

### 6.2 Supporting Types

```typescript
interface ConversationMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	whatsappMessageId?: string;
	replyToMessageId?: string;
	metadata?: {
		disambiguationContext?: DisambiguationContext;
		recentTasks?: RecentTaskSnapshot[];
		imageContext?: ImageContext;
	};
}

interface ImageContext {
	imageId: string;
	analysisResult: ImageAnalysisResult;
	imageType: "structured" | "random";
	extractedAt: number;
}

interface ResolverResult {
	stepId: string;
	type: "execute" | "clarify";
	args?: Record<string, any>; // Tool call arguments
	question?: string; // Clarification question
	options?: string[]; // Clarification options
}

interface ExecutionResult {
	stepId: string;
	success: boolean;
	data?: any;
	error?: string;
	durationMs: number;
}

interface FormattedResponse {
	agent: string;
	operation: string;
	entityType: string;
	rawData: any;
	formattedData: any; // With human-readable dates
	context: {
		isRecurring: boolean;
		isNudge: boolean;
		hasDueDate: boolean;
		isToday: boolean;
		isTomorrowOrLater: boolean;
	};
}
```

---

## 7. Memory Architecture

### 7.1 Memory Types

| Type                | Storage             | Lifetime                | V1 Equivalent                            |
| ------------------- | ------------------- | ----------------------- | ---------------------------------------- |
| **Short-term**      | LangGraph state     | Per-request             | ConversationWindow (in-memory)           |
| **Recent messages** | LangGraph state     | 10 messages, 500 tokens | ConversationWindow.memory                |
| **Disambiguation**  | LangGraph state     | 5 minutes               | ConversationWindow.disambiguationContext |
| **Image context**   | LangGraph state     | 3 user messages         | ConversationWindow.imageContext          |
| **Recent tasks**    | LangGraph state     | Per-session             | ConversationWindow.recentTaskContext     |
| **Long-term**       | Supabase (optional) | Persistent              | conversation_memory table                |
| **Second-brain**    | Vector DB           | Persistent              | SecondBrainService                       |

### 7.2 Memory Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                      MEMORY LIFECYCLE                               │
└─────────────────────────────────────────────────────────────────────┘

REQUEST START
     │
     ▼
┌──────────────────────────────────────┐
│  ContextAssemblyNode                 │
│  ├─ Load recent_messages (in-memory) │
│  ├─ Load long_term_summary (DB)      │
│  └─ Load user profile (DB)           │
└──────────────────────────────────────┘
     │
     ▼
[... Graph Execution ...]
     │
     ▼
┌──────────────────────────────────────┐
│  MemoryUpdateNode                    │
│  ├─ Add user message to recent       │
│  ├─ Add assistant response to recent │
│  ├─ Enforce 10 message limit         │
│  ├─ Enforce 500 token limit          │
│  ├─ Store disambiguation if any      │
│  └─ Update recent tasks if created   │
└──────────────────────────────────────┘
     │
     ▼
REQUEST END

CLEANUP (every 12 hours)
     │
     ▼
┌──────────────────────────────────────┐
│  Remove conversations > 12h old      │
│  Clear expired disambiguation        │
└──────────────────────────────────────┘
```

### 7.3 ConversationWindow Migration

V1 `ConversationWindow` maps to V2 as follows:

| V1 Property               | V2 Location                  |
| ------------------------- | ---------------------------- |
| `memory`                  | `state.recent_messages`      |
| `MAX_TOTAL_MESSAGES` (10) | Enforced in MemoryUpdateNode |
| `MAX_TOTAL_TOKENS` (500)  | Enforced in MemoryUpdateNode |
| `disambiguationContext`   | `state.disambiguation`       |
| `recentTaskContext`       | `state.refs.tasks`           |
| `imageContext`            | `state.input.imageContext`   |
| `getRepliedToMessage()`   | ReplyContextNode logic       |
| `pushRecentTasks()`       | MemoryUpdateNode             |

### 7.4 Checkpointer & Thread Persistence (HITL)

LangGraph requires a **Checkpointer** to persist state between `interrupt()` calls. This enables true pause/resume functionality.

#### Thread Strategy

```typescript
// Each user has one persistent conversation thread
const threadId = userPhone; // e.g., "+972501234567"

// Configuration for all graph invocations
const config = {
	configurable: { thread_id: threadId },
};
```

#### Checkpointer Options

| Environment | Checkpointer           | Notes                                         |
| ----------- | ---------------------- | --------------------------------------------- |
| Development | `MemorySaver`          | In-memory, resets on server restart           |
| Production  | `SupabaseCheckpointer` | Persistent, integrates with existing Supabase |

#### MemorySaver (Development)

```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver();

const graph = new StateGraph<MemoState>({...})
  .addNode(...)
  .compile({ checkpointer });
```

#### SupabaseCheckpointer (Production - Future)

```sql
-- Table for LangGraph checkpoints
CREATE TABLE langgraph_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (thread_id, checkpoint_id)
);

CREATE INDEX idx_checkpoints_thread ON langgraph_checkpoints(thread_id);
```

#### Invocation Flow

```typescript
// In webhook handler
async function handleMessage(userPhone: string, message: string) {
	const threadId = userPhone;
	const config = { configurable: { thread_id: threadId } };

	// Check for pending interrupt
	const state = await graph.getState(config);
	const hasPendingInterrupt = state?.next?.length > 0;

	if (hasPendingInterrupt) {
		// Resume from interrupt with user's response
		const result = await graph.invoke(new Command({ resume: message }), config);
		return result.final_response;
	} else {
		// Fresh invocation
		const result = await graph.invoke(
			{ message, userPhone, triggerType: "user" },
			config
		);
		return result.final_response;
	}
}
```

---

## 8. Resolver Strategy

> ⚠️ **CRITICAL**: All resolver schemas MUST be based on V1's function definitions.
> Source files: `src/agents/functions/CalendarFunctions.ts`, `src/agents/functions/DatabaseFunctions.ts`
>
> ⚠️ **V1 System Prompt Integration (January 2026)**:
> Resolver system prompts now incorporate proven logic from `src/config/system-prompts.ts`.
> See [RESOLVER_SPECS.md](./RESOLVER_SPECS.md) for detailed specifications.

### 8.0 V1 System Prompt Integration

The resolvers now include the complete logic from V1's system prompts:

**DatabaseTaskResolver** (from `getDatabaseAgentPrompt()`):

- NUDGE vs DAILY detection: "כל X דקות" → nudge, "כל יום ב-X" → daily
- Reminder detection rules (explicit time, "X before", date-only)
- reminderRecurrence structure: `{ type, time, days, interval, dayOfMonth, until }`
- Task completion = deletion for reminder tasks
- Hebrew patterns: "נדנד אותי", "תציק לי", "תחפור לי"

**DatabaseListResolver** (from `getDatabaseAgentPrompt()`):

- List keyword detection: ONLY use lists when user says "list"/"רשימה"
- Default `isChecklist: true`

**CalendarMutateResolver** (from `getCalendarAgentPrompt()`):

- Event reminders: `reminderMinutesBefore` (different from standalone reminders)
- All-day multi-day events: `allDay: true`, date format `YYYY-MM-DD`, end = day after last
- searchCriteria + updateFields pattern for updates
- Forward-looking for day-of-week references
- Recurring: Weekly uses day NAMES, Monthly uses numeric STRING ["10"]
- createMultiple, createRecurring, createMultipleRecurring patterns

**CalendarFindResolver** (from `getCalendarAgentPrompt()`):

- Natural language resolution (summary-based, never eventId from user)
- Time range defaults (7 days if not specified)
- Schedule analysis support

### 8.1 V1 Function Schema Mapping

| V1 Function Class     | V1 File                  | V2 Resolver                                       |
| --------------------- | ------------------------ | ------------------------------------------------- |
| `CalendarFunction`    | `CalendarFunctions.ts`   | `CalendarFindResolver` + `CalendarMutateResolver` |
| `TaskFunction`        | `DatabaseFunctions.ts`   | `DatabaseTaskResolver`                            |
| `ListFunction`        | `DatabaseFunctions.ts`   | `DatabaseListResolver`                            |
| `UserDataFunction`    | `DatabaseFunctions.ts`   | Merged into DatabaseTaskResolver                  |
| `GmailFunction`       | `GmailFunctions.ts`      | `GmailResolver`                                   |
| `SecondBrainFunction` | `SecondBrainFunction.ts` | `SecondBrainResolver`                             |

### 8.2 Resolver Grouping

```
┌─────────────────────────────────────────────────────────────────────┐
│                      RESOLVER REGISTRY                              │
│           (All schemas derived from V1 function definitions)        │
└─────────────────────────────────────────────────────────────────────┘

CALENDAR (from V1: CalendarFunction.parameters)
├── CalendarFindResolver
│   └── Actions: get, getEvents, checkConflicts, getRecurringInstances
│   └── Schema: Read-only subset of V1 calendarOperations
│
└── CalendarMutateResolver
    └── Actions: create, createMultiple, createRecurring, createMultipleRecurring,
    │            update, delete, deleteBySummary, truncateRecurring
    └── Schema: Write subset of V1 calendarOperations
    └── Special: excludeSummaries, searchCriteria, updateFields (from V1)

DATABASE (from V1: TaskFunction.parameters + ListFunction.parameters)
├── DatabaseTaskResolver
│   └── Actions: create, createMultiple, get, getAll, update, updateMultiple,
│   │            delete, deleteMultiple, deleteAll, updateAll, complete, completeAll, addSubtask
│   └── Schema: EXACT copy of V1 taskOperations
│   └── Special: reminderRecurrence, reminderDetails, nudge support (from V1)
│
└── DatabaseListResolver
    └── Actions: create, createMultiple, get, getAll, update, updateMultiple,
    │            delete, deleteMultiple, addItem, toggleItem, deleteItem
    └── Schema: EXACT copy of V1 listOperations

GMAIL (from V1: GmailFunction.parameters)
└── GmailResolver
    └── Actions: search, read, compose, send, reply, forward, label, archive, delete, markRead
    └── Schema: gmailOperations (from V1)

SECOND-BRAIN (from V1: SecondBrainFunction.parameters)
└── SecondBrainResolver
    └── Actions: store, search, update, delete, summarize
    └── Schema: memoryOperations (from V1)

GENERAL (no tools)
└── GeneralResolver
    └── Actions: respond (pure LLM conversation)
    └── Schema: None

META (template-based)
└── MetaResolver
    └── Actions: describe_capabilities
    └── Schema: None (uses predefined text)
```

### 8.3 V1 Schema Extraction Example

**From V1 `TaskFunction.parameters`** (keep exact structure):

```typescript
// V1: src/agents/functions/DatabaseFunctions.ts lines 12-217
// V2: Extract and use EXACTLY this schema

const taskOperationsSchema = {
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
		dueDate: { type: "string", description: "Due date in ISO format" },
		reminder: {
			type: "string",
			description: 'Reminder interval (e.g., "30 minutes")',
		},
		reminderRecurrence: {
			type: "object",
			properties: {
				type: { type: "string", enum: ["daily", "weekly", "monthly", "nudge"] },
				time: { type: "string", description: "ONLY for daily/weekly/monthly" },
				interval: { type: "string", description: "ONLY for nudge" },
				days: { type: "array", items: { type: "number" } },
				dayOfMonth: { type: "number" },
				until: { type: "string" },
			},
		},
		reminderDetails: { type: "object" }, // Structured reminder payload
		filters: { type: "object" },
		tasks: { type: "array" }, // For createMultiple
		taskIds: { type: "array" }, // For deleteMultiple
		updates: { type: "array" }, // For updateMultiple
	},
	required: ["operation"],
};
```

**From V1 `CalendarFunction.parameters`** (keep exact structure):

```typescript
// V1: src/agents/functions/CalendarFunctions.ts lines 14-155
// Special fields to preserve:
// - excludeSummaries (for delete filtering)
// - excludeDays (for getEvents filtering)
// - searchCriteria (for update/delete by criteria)
// - updateFields (for separating old vs new values)
// - isRecurring (for recurring series updates)
// - reminderMinutesBefore (anyOf: [number, null])
```

### 8.4 QueryResolver Reuse

V1's `QueryResolver` is reused inside Resolver Nodes:

```typescript
// Inside CalendarMutateResolver
async function resolve(
	step: PlanStep,
	state: MemoState
): Promise<ResolverResult> {
	const queryResolver = new QueryResolver();

	// If action is update/delete and no eventId, use QueryResolver
	if (step.action === "update_event" && !step.constraints.eventId) {
		const result = await queryResolver.resolveOneOrAsk(
			step.constraints.summary,
			state.user.phone,
			"event"
		);

		if (result.disambiguation) {
			// Store candidates in state for HITL
			return {
				stepId: step.id,
				type: "clarify",
				question: queryResolver.formatDisambiguation(
					"event",
					result.disambiguation.candidates,
					state.user.language
				),
				options: result.disambiguation.candidates.map((c, i) => `${i + 1}`),
			};
		}

		if (result.entity) {
			step.constraints.eventId = result.entity.id;
		}
	}

	// Continue to build tool args...
	return {
		stepId: step.id,
		type: "execute",
		args: buildCalendarUpdateArgs(step),
	};
}
```

### 8.5 Disambiguation Flow

```
User: "Update the meeting"
         │
         ▼
    PlannerNode
    → plan: [{ action: "update_event", constraints: { summary: "meeting" } }]
         │
         ▼
    CalendarMutateResolver
    → QueryResolver.resolveOneOrAsk("meeting", userId, "event")
    → Returns disambiguation (3 candidates)
         │
         ▼
    HITLGateNode
    → state.disambiguation = { candidates: [...], type: "calendar_event" }
    → state.should_pause = true
    → Response: "מצאתי 3 פגישות:\n1. פגישה עם דנה\n2. פגישה צוות\n3. פגישה עם לקוח\nנא לבחור מספר."
         │
         ▼
    [Graph Pauses]
         │
         ▼
User: "2"
         │
         ▼
    ReplyContextNode
    → Detects numbered reply
    → Maps "2" → candidate[1].id
    → state.refs.selected_event_id = "uuid-..."
    → state.disambiguation = null
         │
         ▼
    CalendarMutateResolver (resumes)
    → Uses state.refs.selected_event_id
    → Returns { type: "execute", args: { eventId: "uuid-...", ... } }
```

---

## 9. Cron & Scheduled Jobs (V1 Reuse)

> ⚠️ **CRITICAL**: Do NOT rewrite cron/scheduler logic. Reuse V1 exactly as-is.
> Source files: `src/services/scheduler/SchedulerService.ts`, `src/services/reminder/ReminderService.ts`

### 9.1 V1 Files to Reuse Directly

| V1 File                                      | Purpose                               | Changes for V2                     |
| -------------------------------------------- | ------------------------------------- | ---------------------------------- |
| `src/services/scheduler/SchedulerService.ts` | Cron job orchestration                | **NONE** - use as-is               |
| `src/services/reminder/ReminderService.ts`   | Reminder logic, morning brief, nudges | **NONE** - use as-is               |
| `src/index.ts` (lines 57-58)                 | Scheduler startup                     | **NONE** - keep exact same startup |

### 9.2 V1 Scheduler Architecture (Preserved)

```typescript
// V1: src/services/scheduler/SchedulerService.ts
// This is KEPT EXACTLY as-is

export class SchedulerService {
	private reminderService: ReminderService;

	start(): void {
		// Run reminder checks every 1 minute
		cron.schedule("*/1 * * * *", async () => {
			await this.reminderService.sendUpcomingReminders();
		});

		// Run daily digest check every hour
		// Checks if it's the configured hour for each user's timezone
		cron.schedule("0 * * * *", async () => {
			await this.reminderService.sendMorningDigest(this.morningDigestHour);
		});
	}
}
```

### 9.3 V1 Reminder Service (Preserved)

The `ReminderService` handles all proactive messaging:

```typescript
// V1: src/services/reminder/ReminderService.ts
// This is KEPT EXACTLY as-is

class ReminderService {
	// ✅ Upcoming reminders (one-time and recurring)
	async sendUpcomingReminders(): Promise<void> {
		/* V1 logic */
	}

	// ✅ Morning digest (daily summary)
	async sendMorningDigest(hour: number): Promise<void> {
		/* V1 logic */
	}

	// ✅ Nudge reminders (every X minutes)
	// Handled via reminderRecurrence: { type: 'nudge', interval: '10 minutes' }

	// ✅ Overdue notifications
	// Part of sendUpcomingReminders() logic
}
```

### 9.4 Why No LangGraph for Cron

Cron jobs do **NOT** use the LangGraph flow because:

1. **No user intent to parse** — These are system-triggered, not user messages
2. **No disambiguation needed** — We know exactly what data to fetch
3. **Deterministic output** — Template-based, optional LLM polish only
4. **Already working** — V1's implementation is stable and tested

### 9.5 V2 Integration Point

The only change is that cron jobs MAY optionally use V2's `ResponseWriterNode` for text enhancement:

```typescript
// OPTIONAL enhancement in V2
// If we want to polish morning brief text with LLM

import { LLMService } from "../services/llm/LLMService";

class ReminderService {
	private llmService: LLMService;

	async sendMorningDigest(hour: number): Promise<void> {
		// ... existing V1 logic to gather data ...

		// Format with template (V1 logic)
		const formatted = this.formatMorningBrief(tasks, events);

		// OPTIONAL: LLM polish (new in V2)
		const enhanced = await this.llmService.createCompletion("responseWriter", [
			{ role: "system", content: MORNING_BRIEF_POLISH_PROMPT },
			{ role: "user", content: formatted },
		]);

		await sendWhatsAppMessage(userPhone, enhanced);
	}
}
```

### 9.6 Nudge Reminder Flow (Unchanged)

```
Task created with reminderRecurrence: { type: 'nudge', interval: '10 minutes' }
         │
         ▼
┌──────────────────────────────────────┐
│  SchedulerService.start()            │
│  └─ cron.schedule('*/1 * * * *')     │
└──────────────────────────────────────┘
         │
         ▼ (every minute)
┌──────────────────────────────────────┐
│  ReminderService.sendUpcoming()      │
│  ├─ Query tasks with nudge reminders │
│  ├─ Check if interval has passed     │
│  ├─ Send reminder message            │
│  └─ Update last_sent timestamp       │
└──────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  User receives nudge via WhatsApp    │
│  └─ Repeats until task is completed  │
└──────────────────────────────────────┘
```

---

## 10. Response Pipeline

### 10.1 ResponseFormatter (Code)

Reuses V1's `ResponseFormatter` logic:

```typescript
class ResponseFormatterNode {
	// From V1: src/services/response/ResponseFormatter.ts

	format(executionResults: ExecutionResult[]): FormattedResponse {
		return {
			// 1. ISO dates → human-readable
			formattedData: this.formatDatesInObject(results),

			// 2. Task categorization
			categories: this.categorizeData(results), // overdue, upcoming, recurring

			// 3. Metadata extraction
			context: this.extractResponseContext(results),
		};
	}

	// Reuse exact V1 methods:
	private parseISOToLocalTime(isoString: string) {
		/* ... */
	}
	private formatRelativeDate(parsed: ParsedDate) {
		/* ... */
	}
	private formatDatesInObject(obj: any) {
		/* ... */
	}
}
```

### 10.2 ResponseWriter (LLM)

Uses V1's `ResponseFormatterPrompt`:

```typescript
class ResponseWriterNode {
	async write(formatted: FormattedResponse, state: MemoState): Promise<string> {
		// Template path for simple responses
		if (this.shouldUseTemplate(formatted)) {
			return this.generateFromTemplate(formatted);
		}

		// LLM path for complex responses
		const completion = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{ role: "system", content: ResponseFormatterPrompt.getSystemPrompt() },
				{ role: "user", content: JSON.stringify(formatted) },
			],
		});

		return completion.choices[0].message.content;
	}
}
```

---

## 11. Module Structure

### 11.1 Folder Layout

```
Memo_v2/
├── docs/
│   ├── BLUEPRINT.md              # This file
│   ├── STATE_SCHEMA.md           # Detailed state types
│   ├── RESOLVER_SPECS.md         # Per-resolver specifications
│   └── MIGRATION_CHECKLIST.md    # Migration tracking
│
├── src/
│   ├── graph/
│   │   ├── index.ts              # Main graph definition
│   │   ├── nodes/
│   │   │   ├── ContextAssemblyNode.ts
│   │   │   ├── ReplyContextNode.ts
│   │   │   ├── PlannerNode.ts
│   │   │   ├── HITLGateNode.ts
│   │   │   ├── ResolverRouterNode.ts
│   │   │   ├── JoinNode.ts
│   │   │   ├── ResponseFormatterNode.ts
│   │   │   ├── ResponseWriterNode.ts
│   │   │   └── MemoryUpdateNode.ts
│   │   │
│   │   ├── resolvers/
│   │   │   ├── CalendarFindResolver.ts
│   │   │   ├── CalendarMutateResolver.ts
│   │   │   ├── DatabaseTaskResolver.ts
│   │   │   ├── DatabaseListResolver.ts
│   │   │   ├── GmailResolver.ts
│   │   │   ├── SecondBrainResolver.ts
│   │   │   ├── GeneralResolver.ts
│   │   │   └── MetaResolver.ts
│   │   │
│   │   ├── executors/
│   │   │   ├── index.ts              # Executor registry & exports
│   │   │   ├── BaseExecutor.ts       # Abstract base class
│   │   │   ├── CalendarExecutor.ts
│   │   │   ├── DatabaseExecutor.ts
│   │   │   ├── GmailExecutor.ts
│   │   │   ├── SecondBrainExecutor.ts
│   │   │   └── GeneralExecutor.ts    # Also exports MetaExecutor
│   │   │
│   │   ├── cron/
│   │   │   ├── CronSubGraph.ts
│   │   │   ├── MorningBriefNode.ts
│   │   │   └── NudgeNode.ts
│   │   │
│   │   └── state/
│   │       ├── MemoState.ts      # State type definitions
│   │       └── StateManager.ts   # State utilities
│   │
│   ├── prompts/
│   │   ├── PlannerPrompt.ts
│   │   ├── ResolverPrompts.ts
│   │   └── ResponseWriterPrompt.ts
│   │
│   ├── services/
│   │   └── adapters/             # Thin wrappers calling V1 services
│   │       ├── index.ts
│   │       ├── CalendarServiceAdapter.ts
│   │       ├── TaskServiceAdapter.ts
│   │       ├── ListServiceAdapter.ts
│   │       ├── GmailServiceAdapter.ts
│   │       └── SecondBrainServiceAdapter.ts
│   │
│   ├── utils/                    # Adapted from V1
│   │   ├── index.ts              # Re-exports all utilities
│   │   ├── QueryResolverAdapter.ts  # Stateless version (no ConversationWindow)
│   │   ├── fuzzy.ts              # From V1/src/utils/fuzzy.ts
│   │   ├── time.ts               # From V1/src/utils/time.ts
│   │   ├── timeContext.ts        # From V1/src/utils/timeContext.ts
│   │   └── constants.ts          # Shared constants
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── PlanStep.ts
│   │   └── ExecutionResult.ts
│   │
│   └── index.ts                  # Entry point
│
├── tests/
│   ├── nodes/
│   ├── resolvers/
│   └── integration/
│
├── package.json
├── tsconfig.json
└── README.md
```

### 11.2 Reused Modules from V1

| V1 Module                                    | V2 Location                                | Changes                          |
| -------------------------------------------- | ------------------------------------------ | -------------------------------- |
| `src/services/calendar/CalendarService.ts`   | Called via `CalendarServiceAdapter.ts`     | Adapter wraps V1 service         |
| `src/services/database/TaskService.ts`       | Called via `TaskServiceAdapter.ts`         | Adapter wraps V1 service         |
| `src/services/database/ListService.ts`       | Called via `ListServiceAdapter.ts`         | Adapter wraps V1 service         |
| `src/services/email/GmailService.ts`         | Called via `GmailServiceAdapter.ts`        | Adapter wraps V1 service         |
| `src/services/memory/SecondBrainService.ts`  | Called via `SecondBrainServiceAdapter.ts`  | Adapter wraps V1 service         |
| `src/core/orchestrator/QueryResolver.ts`     | `src/utils/QueryResolverAdapter.ts`        | Stateless, no ConversationWindow |
| `src/utils/fuzzy.ts`                         | `src/utils/fuzzy.ts`                       | Adapted (removed config import)  |
| `src/utils/time.ts`                          | `src/utils/time.ts`                        | Copied with minor updates        |
| `src/utils/timeContext.ts`                   | `src/utils/timeContext.ts`                 | Adapted (configurable timezone)  |
| `src/services/response/ResponseFormatter.ts` | `src/graph/nodes/ResponseFormatterNode.ts` | Adapt to node pattern            |
| `src/agents/functions/CalendarFunctions.ts`  | Schema → `CalendarResolvers.ts`            | Integrated into resolvers        |
| `src/agents/functions/DatabaseFunctions.ts`  | Schema → `DatabaseResolvers.ts`            | Integrated into resolvers        |

---

## 12. Interfaces & Contracts

### 12.1 Node Interface

```typescript
interface MemoNode<TInput = MemoState, TOutput = Partial<MemoState>> {
	name: string;

	// Main execution
	execute(input: TInput): Promise<TOutput>;

	// Optional: Pre-execution validation
	validate?(input: TInput): ValidationResult;

	// Optional: Post-execution side effects
	afterExecute?(input: TInput, output: TOutput): Promise<void>;
}
```

### 12.2 Resolver Interface

```typescript
interface Resolver {
	name: string;
	capability: string;
	actions: string[];

	// Convert PlanStep to tool args or clarification
	resolve(step: PlanStep, state: MemoState): Promise<ResolverResult>;

	// Get the schema slice for this resolver
	getSchema(): FunctionDefinition;
}
```

### 12.3 Executor Interface

```typescript
interface Executor {
	name: string;
	capability: string;

	// Execute tool call
	execute(args: Record<string, any>, userId: string): Promise<ExecutionResult>;
}
```

### 12.4 Graph Definition

```typescript
// src/graph/index.ts
import { StateGraph } from "@langchain/langgraph";

const graph = new StateGraph<MemoState>({
	channels: memoStateChannels,
})
	// Nodes
	.addNode("context_assembly", contextAssemblyNode)
	.addNode("reply_context", replyContextNode)
	.addNode("planner", plannerNode)
	.addNode("hitl_gate", hitlGateNode)
	.addNode("resolver_router", resolverRouterNode)
	.addNode("calendar_find_resolver", calendarFindResolver)
	.addNode("calendar_mutate_resolver", calendarMutateResolver)
	.addNode("database_task_resolver", databaseTaskResolver)
	.addNode("database_list_resolver", databaseListResolver)
	.addNode("gmail_resolver", gmailResolver)
	.addNode("secondbrain_resolver", secondBrainResolver)
	.addNode("general_resolver", generalResolver)
	.addNode("meta_resolver", metaResolver)
	.addNode("calendar_executor", calendarExecutor)
	.addNode("database_executor", databaseExecutor)
	.addNode("gmail_executor", gmailExecutor)
	.addNode("secondbrain_executor", secondBrainExecutor)
	.addNode("join", joinNode)
	.addNode("response_formatter", responseFormatterNode)
	.addNode("response_writer", responseWriterNode)
	.addNode("memory_update", memoryUpdateNode)

	// Edges
	.addEdge("context_assembly", "reply_context")
	.addEdge("reply_context", "planner")
	.addConditionalEdges("planner", plannerRouter)
	.addEdge("hitl_gate", conditionalPause)
	.addConditionalEdges("resolver_router", resolverDispatch)
	// ... resolver → executor edges
	.addEdge("join", "response_formatter")
	.addEdge("response_formatter", "response_writer")
	.addEdge("response_writer", "memory_update")
	.addEdge("memory_update", END);
```

---

## 13. Migration Plan

### 13.1 Phase 1: Foundation (Week 1-2)

- [ ] Set up Memo_v2 folder structure
- [ ] Install dependencies (LangGraph, LangChain, LangSmith)
- [ ] Copy reusable services (Calendar, Database, Gmail, SecondBrain)
- [ ] Copy utilities (QueryResolver, fuzzy, time, timeContext)
- [ ] Define MemoState type
- [ ] Create basic graph skeleton

### 13.2 Phase 2: Core Nodes (Week 3-4)

- [ ] Implement ContextAssemblyNode
- [ ] Implement ReplyContextNode
- [ ] Implement PlannerNode + prompt
- [ ] Implement HITLGateNode
- [ ] Implement ResolverRouterNode
- [ ] Test basic flow end-to-end

### 13.3 Phase 3: Resolvers (Week 5-6)

- [ ] Implement CalendarFindResolver
- [ ] Implement CalendarMutateResolver
- [ ] Implement DatabaseTaskResolver
- [ ] Implement DatabaseListResolver
- [ ] Implement GmailResolver
- [ ] Implement SecondBrainResolver
- [ ] Implement GeneralResolver
- [ ] Implement MetaResolver

### 13.4 Phase 4: Executors & Response (Week 7)

- [ ] Implement all Executors (reuse V1 services)
- [ ] Implement JoinNode
- [ ] Implement ResponseFormatterNode (port from V1)
- [ ] Implement ResponseWriterNode
- [ ] Implement MemoryUpdateNode

### 13.5 Phase 5: Cron & Integration (Week 8)

- [ ] Implement CronSubGraph
- [ ] Implement MorningBriefNode
- [ ] Implement NudgeNode
- [ ] Integrate with WhatsApp webhook
- [ ] End-to-end testing

### 13.6 Phase 6: Polish & Deploy (Week 9-10)

- [ ] Performance optimization
- [ ] Error handling
- [ ] Logging and monitoring (LangSmith)
- [ ] A/B testing V1 vs V2
- [ ] Gradual rollout

---

## 14. Dependencies

### 14.1 Required Packages

```json
{
	"dependencies": {
		"@langchain/core": "^0.3.x",
		"@langchain/langgraph": "^0.2.x",
		"@langchain/openai": "^0.3.x",
		"langsmith": "^0.2.x",
		"openai": "^4.x",
		"zod": "^3.x",
		"uuid": "^9.x"
	},
	"devDependencies": {
		"@types/node": "^20.x",
		"typescript": "^5.x",
		"vitest": "^1.x"
	}
}
```

### 14.2 LangSmith Setup

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=<your-key>
export LANGCHAIN_PROJECT=memo-v2
```

---

## 15. Open Questions

### 15.1 Pending Decisions

1. **Supabase conversation persistence**: Keep or remove?

   - Current: Optional, 50 messages, 24h cleanup
   - Proposal: Remove for V2, keep only LangGraph state
   - Decision: TBD

2. **LangSmith tracing**: Required for production?

   - Pros: Excellent debugging, cost tracking
   - Cons: Additional cost, dependency
   - Decision: TBD

3. **Parallel execution limits**: How many concurrent Resolvers?

   - Proposal: Max 3 parallel
   - Decision: TBD

4. **Template vs LLM threshold for ResponseWriter**:
   - Proposal: Template if < 3 items AND no complex formatting
   - Decision: TBD

### 15.2 V1 Features to Verify

- [ ] All-day event detection
- [ ] Recurring event handling (weekly, monthly)
- [ ] Nudge reminders (every X minutes)
- [ ] Fuzzy matching thresholds
- [ ] Time parsing (Hebrew + English)
- [ ] Attendee extraction from text

---

## Next Steps

1. Review and approve this blueprint
2. Create detailed RESOLVER_SPECS.md
3. Create STATE_SCHEMA.md with full TypeScript types
4. Begin Phase 1 implementation

---

_This document will be updated as implementation progresses._
