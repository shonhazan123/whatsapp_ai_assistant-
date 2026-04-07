/**
 * BaseResolver - Abstract base class for all Resolver nodes
 * 
 * Resolvers convert PlanStep (semantic action) into concrete tool call arguments.
 * 
 * Key responsibilities:
 * - Fixed, cacheable system prompt per resolver
 * - Schema slice (only relevant properties)
 * - Entity lookup via QueryResolver
 * - Output: execute (tool args) or clarify (interrupt)
 * - Never talks to user directly
 * - Never knows about other capabilities
 */

import { interrupt } from '@langchain/langgraph';
import { getNodeModel } from '../../config/llm-config.js';
import { CONVERSATION_RAW_MESSAGE_CAP } from '../../services/memory/ConversationContextStore.js';
import { traceLlmReasoningLog } from '../../services/trace/traceLlmReasoningLog.js';
import type {
  Capability,
  InterruptPayload,
  PlanStep,
  ResolverResult,
  ResolverResultClarify,
} from '../../types/index.js';
import type { LLMStep, MemoState } from '../state/MemoState.js';

// ============================================================================
// RESOLVER INTERFACE
// ============================================================================

export interface ResolverConfig {
  name: string;
  capability: Capability;
  actions: string[];
  systemPrompt: string;
  schemaSlice: object;
}

/**
 * ResolverOutput - Union type for resolver results
 * Uses the core ResolverResult type from types/index.ts
 */
export type ResolverOutput = ResolverResult;

// ============================================================================
// BASE RESOLVER CLASS
// ============================================================================

export abstract class BaseResolver {
  abstract readonly name: string;
  abstract readonly capability: Capability;
  abstract readonly actions: string[];
  protected _pendingLlmSteps: LLMStep[] = [];

  /** Drain accumulated LLM trace steps (returns and clears). */
  drainLlmSteps(): LLMStep[] {
    const steps = this._pendingLlmSteps;
    this._pendingLlmSteps = [];
    return steps;
  }

  /**
   * Get the system prompt for this resolver (cacheable)
   */
  abstract getSystemPrompt(): string;

  /**
   * Get the schema slice for this resolver
   */
  abstract getSchemaSlice(): object;

  /**
   * Resolve a PlanStep into tool call arguments or request clarification
   */
  abstract resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput>;

  /**
   * Check if this resolver can handle a given action
   */
  canHandle(action: string): boolean {
    return this.actions.includes(action);
  }

  /**
   * Execute the resolver as a LangGraph node function
   * Handles interrupts for clarification
   */
  async execute(state: MemoState): Promise<Partial<MemoState>> {
    this._pendingLlmSteps = [];

    const step = this.findMyStep(state);

    if (!step) {
      console.log(`[${this.name}] No step found for this resolver`);
      return {};
    }

    console.log(`[${this.name}] Resolving step ${step.id}: ${step.action}`);

    try {
      const result = await this.resolve(step, state);

      if (result.type === 'clarify') {
        // Use LangGraph's native interrupt for clarification
        const userResponse = this.requestClarification(result, state);

        // After resume, update state with user's selection
        return {
          disambiguation: {
            type: this.getEntityType(),
            candidates: [],
            resolverStepId: step.id,
            userSelection: userResponse as string,
            resolved: true,
          },
        };
      }

      // Execute type - store the result
      if (result.type === 'execute') {
        const resolverResults = new Map(state.resolverResults);
        resolverResults.set(step.id, result);
        return {
          resolverResults,
          ...(this._pendingLlmSteps.length > 0 ? { llmSteps: this._pendingLlmSteps } : {}),
        };
      }

      return {};

    } catch (error) {
      console.error(`[${this.name}] Error resolving step ${step.id}:`, error);
      return {
        error: `Resolver error in ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        ...(this._pendingLlmSteps.length > 0 ? { llmSteps: this._pendingLlmSteps } : {}),
      };
    }
  }

  /**
   * Request clarification using LangGraph interrupt()
   * Only called for 'clarify' type results
   */
  protected requestClarification(
    result: ResolverResultClarify,
    state: MemoState
  ): unknown {
    const payload: InterruptPayload = {
      type: 'disambiguation',
      question: result.question || 'Please clarify:',
      options: result.options,
      metadata: {
        stepId: result.stepId,
        entityType: this.getEntityType(),
      },
    };

    // This pauses the graph and returns when user responds
    return interrupt(payload);
  }

  /**
   * Get the entity type for disambiguation
   * Updated to use new domain types: 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error'
   */
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    switch (this.capability) {
      case 'calendar':
        return 'calendar';
      case 'database':
        return 'database';
      case 'gmail':
        return 'gmail';
      case 'second-brain':
        return 'second-brain';
      default:
        return 'database';
    }
  }

  /**
   * Find the plan step that this resolver should handle
   */
  protected findMyStep(state: MemoState): PlanStep | undefined {
    const plan = state.plannerOutput?.plan;
    if (!plan) return undefined;

    // Find the first step that:
    // 1. Matches this resolver's capability
    // 2. Has an action this resolver can handle
    // 3. Hasn't been resolved yet
    return plan.find(step =>
      step.capability === this.capability &&
      this.canHandle(step.action) &&
      !state.resolverResults.has(step.id)
    );
  }

  /**
   * Format disambiguation message for multiple matches
   */
  protected formatDisambiguationMessage(
    entityType: string,
    candidates: Array<{ displayText: string }>,
    language: 'he' | 'en' | 'other'
  ): string {
    const options = candidates
      .map((c, i) => `${i + 1}. ${c.displayText}`)
      .join('\n');

    if (language === 'he') {
      return `מצאתי כמה ${this.getEntityTypeHebrew(entityType)}:\n${options}\n\nאיזה התכוונת?`;
    }

    return `I found multiple ${entityType}s:\n${options}\n\nWhich one did you mean?`;
  }

  private getEntityTypeHebrew(entityType: string): string {
    const types: Record<string, string> = {
      'calendar_event': 'אירועים',
      'task': 'משימות',
      'list': 'רשימות',
      'email': 'אימיילים',
    };
    return types[entityType] || entityType;
  }

  /**
   * Create a node function for LangGraph registration
   */
  asNodeFunction(): (state: MemoState) => Promise<Partial<MemoState>> {
    return (state: MemoState) => this.execute(state);
  }
}

// ============================================================================
// RESOLVER WITH LLM
// ============================================================================

/**
 * LLMResolver - Base class for resolvers that use LLM for argument generation
 */
export abstract class LLMResolver extends BaseResolver {
  /**
   * Call LLM to generate tool arguments using function calling.
   * Automatically traces the call and accumulates the LLMStep.
   */
  protected async callLLM(
    step: PlanStep,
    state: MemoState
  ): Promise<Record<string, any>> {
    console.log(`[${this.name}] callLLM() invoked for step ${step.id} with capability ${this.capability}`);

    const resolverNodeType = this.capability === 'calendar' ? 'calendar' :
      this.capability === 'database' ? 'database' :
        this.capability === 'gmail' ? 'gmail' :
          this.capability === 'second-brain' ? 'secondBrain' :
            'general';

    let modelConfig;
    try {
      modelConfig = getNodeModel(resolverNodeType, true);
    } catch (error: any) {
      console.error(`[${this.name}] Failed to get model config:`, error);
      throw new Error(`Failed to get model config: ${error.message}`);
    }

    const systemPrompt = this.getSystemPrompt();
    const schemaSlice = this.getSchemaSlice();
    const userMessage = this.buildUserMessage(step, state);
    const requestId = (state.input as any).requestId;

    try {
      const { response, llmStep } = await traceLlmReasoningLog(
        `resolver:${this.capability}`,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          model: modelConfig.model,
          temperature: modelConfig.temperature || 0.7,
          maxTokens: modelConfig.maxTokens || 2000,
          functions: [schemaSlice as any],
          functionCall: { name: (schemaSlice as any).name },
        },
        requestId,
      );

      this._pendingLlmSteps.push(llmStep);

      if (response.functionCall) {
        const parsed = JSON.parse(response.functionCall.arguments);
        console.log(`[${this.name}] Parsed function call arguments:`, Object.keys(parsed));
        return parsed;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        const parsed = JSON.parse(response.toolCalls[0].function.arguments);
        console.log(`[${this.name}] Parsed tool call arguments:`, Object.keys(parsed));
        return parsed;
      }

      console.warn(`[${this.name}] No function call in LLM response, using constraints`);
      return step.constraints;
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed, error type: ${error?.constructor?.name}, message: ${error?.message}`);
      throw error;
    }
  }

  /**
   * Find clarification response from canonical hitlResults (planner HITL with 'continue' mode).
   */
  protected findClarificationResult(state: MemoState): string | null {
    if (!state.hitlResults) return null;
    const entries = Object.values(state.hitlResults);
    const cont = entries.find(e => e.returnTo?.node === 'resolver_router' && e.returnTo?.mode === 'continue');
    return cont?.raw || null;
  }

  /**
   * Build user message for LLM call
   * Override in subclasses for custom message formatting
   */
  protected buildUserMessage(step: PlanStep, state: MemoState): string {
    const message = state.input.enhancedMessage || state.input.message;
    const timeContext = state.now.formatted;

    let userMessage = `${timeContext}\n\n`;

    // Planner context summary — resolved references and intent in plain language
    if (step.contextSummary) {
      userMessage += `## Context Summary (from planner)\n${step.contextSummary}\n\n`;
    }

    // Include user's clarification response from canonical hitlResults
    const clarification = this.findClarificationResult(state);
    if (clarification) {
      userMessage += `## User Clarification\n`;
      userMessage += `The user was asked for more information and responded: "${clarification}"\n`;
      userMessage += `This clarification applies to the original request below. Extract all relevant info from BOTH messages.\n\n`;
    }

    const roll = state.conversationContext?.summary ?? state.longTermSummary;
    if (roll) {
      userMessage += `Conversation summary:\n${roll}\n\n`;
    }
    if (state.recentMessages.length > 0) {
      userMessage += `Recent conversation:\n`;
      const recent = state.recentMessages.slice(-CONVERSATION_RAW_MESSAGE_CAP);
      for (const msg of recent) {
        userMessage += `${msg.role}: ${msg.content.substring(0, 250)}...\n`;
      }
      userMessage += '\n';
    }

    // Add step context
    userMessage += `User wants to: ${step.action}\n`;
    if (Object.keys(step.constraints).length > 0) {
      userMessage += `Constraints: ${JSON.stringify(step.constraints)}\n`;
    }
    if (Object.keys(step.changes).length > 0) {
      userMessage += `Changes: ${JSON.stringify(step.changes)}\n`;
    }

    userMessage += `\nUser message: ${message}`;

    return userMessage;
  }
}

// ============================================================================
// TEMPLATE RESOLVER (No LLM)
// ============================================================================

/**
 * TemplateResolver - Base class for resolvers that use templates (no LLM)
 */
export abstract class TemplateResolver extends BaseResolver {
  /**
   * Generate response from template
   */
  protected abstract generateFromTemplate(
    step: PlanStep,
    state: MemoState
  ): string;
}

