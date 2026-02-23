/**
 * Memo V2 LangGraph Definition
 *
 * Main entry point for the LangGraph-based message processing.
 *
 * Key Features:
 * - Thread-based persistence (thread_id = userPhone)
 * - Native HITL via interrupt() and Command({ resume })
 * - MemorySaver checkpointer (Supabase in production)
 *
 * Graph Flow:
 * 1. context_assembly → Build state from user profile, memory
 * 2. reply_context → Enrich with reply/image context
 * 3. planner → Convert message to Plan DSL
 * 4. hitl_gate → Check confidence, risk, missing fields
 *    ├── interrupt() → Graph pauses, state saved, await reply
 *    └── (continue) → resolver_router
 * 5. resolver_router → Route to capability resolvers, get tool args
 * 6. executor → Execute tool calls via service adapters
 * 7. join → Merge execution results
 * 8. response_formatter → Format dates, categorize
 * 9. response_writer → Generate final message
 * 10. memory_update → Update state.recent_messages
 * 11. END
 */

import { END, MemorySaver, StateGraph } from "@langchain/langgraph";
import { Command } from "@langchain/langgraph";
import { HITL_TTL_MS } from "../types/hitl.js";

// ============================================================================
// INITIALIZE V1 SERVICES AT MODULE LOAD TIME
// This MUST happen before any graph execution to avoid TDZ errors
// ============================================================================
import { initializeServices } from "../services/v1-services.js";
import { sendTypingIndicator } from "../services/whatsapp.js";
import type { InterruptPayload, TriggerInput } from "../types/index.js";
import type { MemoState } from "./state/MemoState.js";
import { createInitialState, MemoStateAnnotation } from "./state/MemoState.js";
initializeServices();

// Node imports
import { createCapabilityCheckNode } from "./nodes/CapabilityCheckNode.js";
import { ContextAssemblyNode } from "./nodes/ContextAssemblyNode.js";
import { createEntityResolutionNode } from "./nodes/EntityResolutionNode.js";
import { createExecutorNode } from "./nodes/ExecutorNode.js";
import { createHITLGateNode } from "./nodes/HITLGateNode.js";
import { createJoinNode } from "./nodes/JoinNode.js";
import { createMemoryUpdateNode } from "./nodes/MemoryUpdateNode.js";
import { createPlannerNode } from "./nodes/PlannerNode.js";
import { createReplyContextNode } from "./nodes/ReplyContextNode.js";
import { createResolverRouterNode } from "./nodes/ResolverRouterNode.js";
import { createResponseFormatterNode } from "./nodes/ResponseFormatterNode.js";
import { createResponseWriterNode } from "./nodes/ResponseWriterNode.js";

// ============================================================================
// CHECKPOINTER (State Persistence)
// ============================================================================

/**
 * In-memory checkpointer for development
 * Production: Replace with SupabaseCheckpointer
 */
const checkpointer = new MemorySaver();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Wrapper for graph.getState() with timeout protection
 * Prevents indefinite hangs when checkpointer is blocked or state is corrupted
 *
 * @param graph - The compiled graph instance
 * @param config - LangGraph config with thread_id
 * @param timeoutMs - Timeout in milliseconds (default: 5000ms)
 * @returns The graph state or null if timed out
 */
async function getStateWithTimeout<T>(
	graph: { getState: (config: any) => Promise<T> },
	config: any,
	timeoutMs: number = 5000,
): Promise<T | null> {
	return Promise.race([
		graph.getState(config),
		new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
	]);
}

// ============================================================================
// GRAPH BUILDER
// ============================================================================

/**
 * Build the Memo LangGraph with checkpointer
 *
 * @param input - The trigger input (user message or cron)
 * @returns Compiled StateGraph ready for execution
 */
export function buildMemoGraph(input: TriggerInput) {
	// Create nodes with input context
	const contextAssemblyNode = new ContextAssemblyNode(input);

	// Build the graph using Annotation API (fully type-safe, no "as any" needed)
	const graph = new StateGraph(MemoStateAnnotation)
		// ======== NODES ========
		.addNode("context_assembly", contextAssemblyNode.asNodeFunction())
		.addNode("reply_context", createReplyContextNode())
		.addNode("planner", createPlannerNode())
		.addNode("capability_check", createCapabilityCheckNode())
		.addNode("hitl_gate", createHITLGateNode())

		// Resolver routing
		.addNode("resolver_router", createResolverRouterNode())

		// Entity Resolution (ID lookup, disambiguation handling)
		.addNode("entity_resolution", createEntityResolutionNode())

		// Executor node (Phase 4)
		.addNode("executor", createExecutorNode())

		// Pipeline nodes
		.addNode("join", createJoinNode())
		.addNode("response_formatter", createResponseFormatterNode())
		.addNode("response_writer", createResponseWriterNode())
		.addNode("memory_update", createMemoryUpdateNode())

		// ======== EDGES ========
		.addEdge("__start__", "context_assembly")
		.addEdge("context_assembly", "reply_context")
		.addEdge("reply_context", "planner")
		.addConditionalEdges("planner", plannerRouter)
		.addConditionalEdges("capability_check", capabilityCheckRouter)
		// HITLGateNode handles resume routing via Command({ goto }).
		// Default forward path: no pendingHITL → resolver_router.
		.addEdge("hitl_gate", "resolver_router")
		.addEdge("resolver_router", "entity_resolution")
		.addConditionalEdges("entity_resolution", entityResolutionRouter)
		.addEdge("executor", "join")
		.addEdge("join", "response_formatter")
		.addEdge("response_formatter", "response_writer")
		.addEdge("response_writer", "memory_update")
		.addEdge("memory_update", END);

	// Compile with checkpointer for state persistence
	return graph.compile({ checkpointer });
}

// ============================================================================
// ROUTING FUNCTIONS
// ============================================================================

/**
 * Route from Planner based on intent type
 */
function plannerRouter(state: MemoState): string {
	const plannerOutput = state.plannerOutput;

	if (!plannerOutput) {
		console.log(
			`[plannerRouter] No planner output, routing to capability_check`,
		);
		return "capability_check"; // Error case, let capability check handle
	}

	// All intents (including meta) go through capability check first
	console.log(
		`[plannerRouter] Intent: ${plannerOutput.intentType}, routing to capability_check`,
	);
	return "capability_check";
}

/**
 * Route from CapabilityCheck based on whether capabilities are missing
 */
function capabilityCheckRouter(state: MemoState): string {
	// If finalResponse is set, capabilities are missing - go directly to response_writer
	if (state.finalResponse) {
		console.log(
			`[capabilityCheckRouter] Capabilities missing, routing to response_writer`,
		);
		return "response_writer";
	}

	// All capabilities available, continue to HITL gate
	console.log(
		`[capabilityCheckRouter] All capabilities available, routing to hitl_gate`,
	);
	return "hitl_gate";
}

/**
 * Route from EntityResolution based on disambiguation state.
 * When machine disambiguation exists (candidates present, not yet resolved),
 * route to hitl_gate so it can create a PendingHITL.
 */
function entityResolutionRouter(state: MemoState): string {
	if (
		state.disambiguation?.candidates &&
		state.disambiguation.candidates.length > 0 &&
		!state.disambiguation.resolved
	) {
		console.log(`[Graph] EntityResolution needs HITL for disambiguation`);
		return "hitl_gate";
	}

	return "executor";
}


// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Graph invocation result
 */
export interface InvokeResult {
	response: string;
	interrupted: boolean;
	interruptPayload?: InterruptPayload;
	metadata: MemoState["metadata"];
}

/**
 * Check if there's a pending interrupt for a thread
 *
 * @param threadId - The thread ID (usually userPhone)
 * @returns True if there's a pending interrupt
 */
export async function hasPendingInterrupt(threadId: string): Promise<boolean> {
	const startTime = Date.now();
	try {
		console.log(
			`[MemoGraph] Checking pending interrupt for thread ${threadId}`,
		);
		const graph = buildMemoGraph({
			userPhone: threadId,
			message: "",
			triggerType: "user",
		});
		console.log(`[MemoGraph] Graph built, getting state...`);
		const config = { configurable: { thread_id: threadId } };

		// Use timeout wrapper to prevent indefinite hangs
		const state = await getStateWithTimeout(graph, config, 5000);

		// Handle timeout case
		if (state === null) {
			console.warn(
				`[MemoGraph] getState timed out for ${threadId} after 5000ms, treating as no pending interrupt`,
			);
			return false;
		}

		const duration = Date.now() - startTime;
		console.log(
			`[MemoGraph] State retrieved in ${duration}ms, next: ${state?.next?.length || 0} pending`,
		);

		return state?.next?.length > 0;
	} catch (error) {
		const duration = Date.now() - startTime;
		console.error(
			`[MemoGraph] hasPendingInterrupt error after ${duration}ms:`,
			error,
		);
		return false;
	}
}

/**
 * Invoke the Memo graph (new message or resume from interrupt)
 *
 * This is the main entry point, called from webhook.ts
 *
 * Per official LangGraph docs (https://docs.langchain.com/oss/javascript/langgraph/interrupts):
 * - Interrupt payloads surface as `__interrupt__` in the result (requires v0.4.0+)
 * - Resume with Command({ resume: value })
 * - The resume value becomes the return value of interrupt()
 *
 * @param userPhone - User's phone number (used as thread_id)
 * @param message - User's message
 * @param options - Additional options
 * @returns InvokeResult with response and interrupt status
 */
export async function invokeMemoGraph(
	userPhone: string,
	message: string,
	options: {
		whatsappMessageId?: string;
		replyToMessageId?: string;
		triggerType?: "user" | "cron" | "nudge" | "event";
	} = {},
): Promise<InvokeResult> {
	const threadId = userPhone;
	const config = { configurable: { thread_id: threadId } };

	let isPendingInterrupt = await hasPendingInterrupt(threadId);

	let result: MemoState & {
		__interrupt__?: Array<{
			value: InterruptPayload;
			resumable?: boolean;
			ns?: string[];
		}>;
	};

	if (isPendingInterrupt) {
		const graph = buildMemoGraph({
			userPhone,
			message,
			triggerType: options.triggerType || "user",
		});

		const state = await getStateWithTimeout(graph, config, 5000);

		if (state === null) {
			console.warn(
				`[MemoGraph] getState timed out when checking interrupt, treating as fresh invocation`,
			);
			isPendingInterrupt = false;
		} else {
			// Check expiry via interruptedAt in payload metadata (5 min TTL)
			const interruptPayload = state?.tasks?.[0]?.interrupts?.[0]?.value as
				| InterruptPayload
				| undefined;
			const interruptedAt = interruptPayload?.metadata?.interruptedAt as
				| number
				| undefined;

			if (interruptedAt && Date.now() - interruptedAt > HITL_TTL_MS) {
				console.log(JSON.stringify({
					event: "HITL_EXPIRED",
					threadId,
					hitlId: interruptPayload?.metadata?.hitlId,
					elapsedMs: Date.now() - interruptedAt,
				}));
				try {
					await checkpointer.deleteThread(threadId);
					console.log(`[MemoGraph] Cleaned up expired thread ${threadId}`);
				} catch (e) {
					console.warn(`[MemoGraph] Failed to cleanup stale thread:`, e);
				}
				isPendingInterrupt = false;

				const lang = detectLanguageSimple(message);
				return {
					response: lang === "he"
						? "הבקשה פגה — רוצה לנסות שוב?"
						: "That request expired — want to try again?",
					interrupted: false,
					metadata: {
						startTime: Date.now(),
						nodeExecutions: [],
						llmCalls: 0,
						totalTokens: 0,
						totalCost: 0,
					},
				};
			}
		}
	}

	// Stale reply guard: pendingInterrupt was already consumed or never existed,
	// but the message looks like a HITL answer (short "yes"/"no"/"1"/"2"/etc.)
	if (!isPendingInterrupt && isLikelyHITLAnswer(message)) {
		console.log(JSON.stringify({
			event: "HITL_STALE_REPLY",
			threadId,
			rawUserMessage: message,
		}));

		const lang = detectLanguageSimple(message);
		return {
			response: lang === "he"
				? "אני לא מחכה לתשובה כרגע — מה תרצה לעשות?"
				: "I'm not waiting on a question right now — what would you like to do?",
			interrupted: false,
			metadata: {
				startTime: Date.now(),
				nodeExecutions: [],
				llmCalls: 0,
				totalTokens: 0,
				totalCost: 0,
			},
		};
	}

	if (isPendingInterrupt) {
		console.log(`[MemoGraph] Resuming from interrupt for thread ${threadId}`);

		// Send typing indicator so the user knows their reply was received
		if (options.whatsappMessageId) {
			sendTypingIndicator(userPhone, options.whatsappMessageId).catch(() => {});
		}

		const graph = buildMemoGraph({
			userPhone,
			message,
			triggerType: options.triggerType || "user",
		});
		result = (await graph.invoke(
			new Command({ resume: message }),
			config,
		)) as typeof result;
	} else {
		// Fresh invocation
		console.log(`[MemoGraph] Fresh invocation for thread ${threadId}`);

		const input: TriggerInput = {
			userPhone,
			message,
			triggerType: options.triggerType || "user",
			whatsappMessageId: options.whatsappMessageId,
			replyToMessageId: options.replyToMessageId,
		};

		const graph = buildMemoGraph(input);

		// Execute graph with initial state
		const initialState = createInitialState({
			user: {
				phone: userPhone,
				timezone: "Asia/Jerusalem",
				language: "he",
				planTier: "free",
				googleConnected: false,
				capabilities: {
					calendar: false,
					gmail: false,
					database: true,
					secondBrain: true,
				},
			},
			input: {
				message,
				triggerType: options.triggerType || "user",
				whatsappMessageId: options.whatsappMessageId,
				replyToMessageId: options.replyToMessageId,
				userPhone,
				timezone: "Asia/Jerusalem",
				language: "he",
			},
		});

		result = (await graph.invoke(initialState, config)) as typeof result;
	}

	// ========================================================================
	// Check for interrupt via __interrupt__ field (LangGraph v0.4.0+)
	// Per docs: "Interrupt payloads surface as __interrupt__"
	// ========================================================================
	if (result.__interrupt__ && result.__interrupt__.length > 0) {
		const interruptPayload = result.__interrupt__[0]?.value;

		console.log(`[MemoGraph] Graph interrupted for thread ${threadId}`);
		console.log(
			`[MemoGraph] Interrupt payload: ${JSON.stringify(interruptPayload)}`,
		);

		return {
			response: interruptPayload?.question || "I need more information.",
			interrupted: true,
			interruptPayload,
			metadata: result.metadata || {
				startTime: Date.now(),
				nodeExecutions: [],
				llmCalls: 0,
				totalTokens: 0,
				totalCost: 0,
			},
		};
	}

	// Normal completion
	console.log(
		`[MemoGraph] Completed in ${Date.now() - result.metadata.startTime}ms`,
	);
	console.log(`[MemoGraph] LLM calls: ${result.metadata.llmCalls}`);
	console.log(`[MemoGraph] Total tokens: ${result.metadata.totalTokens}`);
	console.log(
		`[MemoGraph] Total cost: $${result.metadata.totalCost.toFixed(4)}`,
	);

	// Clean up checkpoints after successful completion to free memory
	// This prevents MemorySaver from accumulating checkpoints indefinitely
	try {
		await checkpointer.deleteThread(threadId);
		console.log(`[MemoGraph] Cleaned up checkpoints for thread ${threadId}`);
	} catch (e) {
		console.warn(`[MemoGraph] Failed to cleanup thread checkpoints:`, e);
	}

	return {
		response: result.finalResponse || "No response generated",
		interrupted: false,
		metadata: result.metadata,
	};
}

/**
 * Simple invocation that returns just the response string
 * For backward compatibility with existing code
 */
export async function invokeMemoGraphSimple(
	userPhone: string,
	message: string,
	options: {
		whatsappMessageId?: string;
		replyToMessageId?: string;
		triggerType?: "user" | "cron" | "nudge" | "event";
	} = {},
): Promise<string> {
	const result = await invokeMemoGraph(userPhone, message, options);
	return result.response;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Simple language detection for short responses (used in stale/expiry messages).
 */
function detectLanguageSimple(msg: string): "he" | "en" {
	return /[\u0590-\u05FF]/.test(msg) ? "he" : "en";
}

/**
 * Heuristic: does the message look like a typical HITL answer?
 * Used to guard against treating stale HITL replies as new user intent.
 */
function isLikelyHITLAnswer(msg: string): boolean {
	const trimmed = msg.trim().toLowerCase();
	if (trimmed.length > 30) return false; // Long messages are likely new intent
	const hitlPatterns = /^(yes|no|y|n|כן|לא|1|2|3|4|5|6|7|8|9|ok|okay|sure|בטוח|שניהם|כולם|both|all|אישור|ביטול|cancel)$/i;
	return hitlPatterns.test(trimmed) || /^\d[\s,\d]*$/.test(trimmed);
}

// Export types and state
export { createInitialState, MemoStateAnnotation } from "./state/MemoState.js";
export type { ExecutionMetadata, MemoState } from "./state/MemoState.js";
export { checkpointer };

