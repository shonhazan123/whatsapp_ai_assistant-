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

import { Command, END, MemorySaver, StateGraph } from '@langchain/langgraph';
import type { InterruptPayload, TriggerInput } from '../types/index.js';
import type { MemoState } from './state/MemoState.js';
import { createInitialState, MemoStateAnnotation } from './state/MemoState.js';

// Node imports
import { ContextAssemblyNode } from './nodes/ContextAssemblyNode.js';
import { createEntityResolutionNode } from './nodes/EntityResolutionNode.js';
import { createExecutorNode } from './nodes/ExecutorNode.js';
import { createHITLGateNode } from './nodes/HITLGateNode.js';
import { createJoinNode } from './nodes/JoinNode.js';
import { createMemoryUpdateNode } from './nodes/MemoryUpdateNode.js';
import { createPlannerNode } from './nodes/PlannerNode.js';
import { createReplyContextNode } from './nodes/ReplyContextNode.js';
import { createResolverRouterNode } from './nodes/ResolverRouterNode.js';
import { createResponseFormatterNode } from './nodes/ResponseFormatterNode.js';
import { createResponseWriterNode } from './nodes/ResponseWriterNode.js';

// ============================================================================
// CHECKPOINTER (State Persistence)
// ============================================================================

/**
 * In-memory checkpointer for development
 * Production: Replace with SupabaseCheckpointer
 */
const checkpointer = new MemorySaver();

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
    .addNode('context_assembly', contextAssemblyNode.asNodeFunction())
    .addNode('reply_context', createReplyContextNode())
    .addNode('planner', createPlannerNode())
    .addNode('hitl_gate', createHITLGateNode())
    
    // Resolver routing
    .addNode('resolver_router', createResolverRouterNode())
    
    // Entity Resolution (ID lookup, disambiguation handling)
    .addNode('entity_resolution', createEntityResolutionNode())
    
    // Executor node (Phase 4)
    .addNode('executor', createExecutorNode())
    
    // Pipeline nodes
    .addNode('join', createJoinNode())
    .addNode('response_formatter', createResponseFormatterNode())
    .addNode('response_writer', createResponseWriterNode())
    .addNode('memory_update', createMemoryUpdateNode())
    
    // ======== EDGES ========
    .addEdge('__start__', 'context_assembly')
    .addEdge('context_assembly', 'reply_context')
    .addEdge('reply_context', 'planner')
    .addConditionalEdges('planner', plannerRouter)
    // HITL Gate can interrupt(), so no conditional edge needed
    // After interrupt resumes, it continues to resolver_router
    .addEdge('hitl_gate', 'resolver_router')
    .addEdge('resolver_router', 'entity_resolution')
    // Entity Resolution can trigger HITL for disambiguation
    .addConditionalEdges('entity_resolution', entityResolutionRouter)
    .addEdge('executor', 'join')
    .addEdge('join', 'response_formatter')
    .addEdge('response_formatter', 'response_writer')
    .addEdge('response_writer', 'memory_update')
    .addEdge('memory_update', END);
  
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
    console.log(`[plannerRouter] No planner output, routing to hitl_gate`);
    return 'hitl_gate'; // Error case, let HITL handle
  }
  
  // Meta requests go directly to response
  if (plannerOutput.intentType === 'meta') {
    console.log(`[plannerRouter] Meta intent, routing to response_formatter`);
    return 'response_formatter';
  }
  
  // All other intents go through HITL gate
  console.log(`[plannerRouter] Intent: ${plannerOutput.intentType}, routing to hitl_gate`);
  return 'hitl_gate';
}

/**
 * Route from EntityResolution based on HITL needs
 */
function entityResolutionRouter(state: MemoState): string {
  // If disambiguation/clarification needed, go to HITL gate to handle interrupt
  if (state.needsHITL) {
    console.log(`[Graph] EntityResolution needs HITL: ${state.hitlReason}`);
    return 'hitl_gate';
  }
  
  // All resolved, proceed to executor
  return 'executor';
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
  metadata: MemoState['metadata'];
}

/**
 * Check if there's a pending interrupt for a thread
 * 
 * @param threadId - The thread ID (usually userPhone)
 * @returns True if there's a pending interrupt
 */
export async function hasPendingInterrupt(threadId: string): Promise<boolean> {
  try {
    console.log(`[MemoGraph] Checking pending interrupt for thread ${threadId}`);
    const graph = buildMemoGraph({ userPhone: threadId, message: '', triggerType: 'user' });
    console.log(`[MemoGraph] Graph built, getting state...`);
    const config = { configurable: { thread_id: threadId } };
    const state = await graph.getState(config);
    console.log(`[MemoGraph] State retrieved, next: ${state?.next?.length || 0} pending`);
    
    return state?.next?.length > 0;
  } catch (error) {
    console.error(`[MemoGraph] hasPendingInterrupt error:`, error);
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
    triggerType?: 'user' | 'cron' | 'nudge' | 'event';
  } = {}
): Promise<InvokeResult> {
  const threadId = userPhone;
  const config = { configurable: { thread_id: threadId } };
  
  // Check if this is a resume from a pending interrupt
  const isPendingInterrupt = await hasPendingInterrupt(threadId);
  
  // Result type per LangGraph docs - __interrupt__ contains interrupt payloads
  let result: MemoState & { __interrupt__?: Array<{ value: InterruptPayload; resumable?: boolean; ns?: string[] }> };
  
  if (isPendingInterrupt) {
    // Resume from interrupt with user's message as the response
    // Per docs: "Command({ resume }) returns that value from interrupt() in the node"
    console.log(`[MemoGraph] Resuming from interrupt for thread ${threadId}`);
    
    const graph = buildMemoGraph({ userPhone, message, triggerType: options.triggerType || 'user' });
    result = await graph.invoke(new Command({ resume: message }), config) as typeof result;
  } else {
    // Fresh invocation
    console.log(`[MemoGraph] Fresh invocation for thread ${threadId}`);
    
    const input: TriggerInput = {
      userPhone,
      message,
      triggerType: options.triggerType || 'user',
      whatsappMessageId: options.whatsappMessageId,
      replyToMessageId: options.replyToMessageId,
    };
    
    const graph = buildMemoGraph(input);
    
    // Execute graph with initial state
    const initialState = createInitialState({
      user: {
        phone: userPhone,
        timezone: 'Asia/Jerusalem',
        language: 'he',
        planTier: 'free',
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
        triggerType: options.triggerType || 'user',
        whatsappMessageId: options.whatsappMessageId,
        replyToMessageId: options.replyToMessageId,
        userPhone,
        timezone: 'Asia/Jerusalem',
        language: 'he',
      },
    });
    
    result = await graph.invoke(initialState, config) as typeof result;
  }
  
  // ========================================================================
  // Check for interrupt via __interrupt__ field (LangGraph v0.4.0+)
  // Per docs: "Interrupt payloads surface as __interrupt__"
  // ========================================================================
  if (result.__interrupt__ && result.__interrupt__.length > 0) {
    const interruptPayload = result.__interrupt__[0]?.value;
    
    console.log(`[MemoGraph] Graph interrupted for thread ${threadId}`);
    console.log(`[MemoGraph] Interrupt payload: ${JSON.stringify(interruptPayload)}`);
    
    return {
      response: interruptPayload?.question || 'I need more information.',
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
  console.log(`[MemoGraph] Completed in ${Date.now() - result.metadata.startTime}ms`);
  console.log(`[MemoGraph] LLM calls: ${result.metadata.llmCalls}`);
  console.log(`[MemoGraph] Total tokens: ${result.metadata.totalTokens}`);
  console.log(`[MemoGraph] Total cost: $${result.metadata.totalCost.toFixed(4)}`);
  
  return {
    response: result.finalResponse || 'No response generated',
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
    triggerType?: 'user' | 'cron' | 'nudge' | 'event';
  } = {}
): Promise<string> {
  const result = await invokeMemoGraph(userPhone, message, options);
  return result.response;
}

// Export types and state
export { createInitialState, MemoStateAnnotation } from './state/MemoState.js';
export type { ExecutionMetadata, MemoState } from './state/MemoState.js';
export { checkpointer };

