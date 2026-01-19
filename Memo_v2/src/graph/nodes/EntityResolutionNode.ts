/**
 * EntityResolutionNode
 * 
 * Orchestrates entity resolution across all domains.
 * 
 * This node:
 * 1. Takes resolver results (semantic action → args)
 * 2. Applies domain-specific resolution (fuzzy match, ID lookup)
 * 3. Returns resolved args OR disambiguation request for HITL
 * 
 * Flow:
 * - Resolver outputs: { operation: 'delete', text: 'meeting notes' }
 * - EntityResolution: Finds matching tasks → { taskIds: ['abc', 'def'] } OR disambiguation
 * - Executor: Receives resolved IDs, executes directly
 */

import {
  CalendarEntityResolver,
  DatabaseEntityResolver,
  GmailEntityResolver,
  SecondBrainEntityResolver,
  type EntityResolverContext,
  type IEntityResolver
} from '../../services/resolution/index.js';
import type { DisambiguationContext } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';

// ============================================================================
// ENTITY RESOLUTION NODE
// ============================================================================

export class EntityResolutionNode {
  readonly name = 'entity_resolution';
  
  private entityResolvers: Map<string, IEntityResolver>;
  
  constructor() {
    this.entityResolvers = new Map<string, IEntityResolver>([
      ['calendar', new CalendarEntityResolver()],
      ['database', new DatabaseEntityResolver()],
      ['gmail', new GmailEntityResolver()],
      ['second-brain', new SecondBrainEntityResolver()],
    ]);
  }
  
  /**
   * Process state - resolve entities or return disambiguation
   */
  async process(state: MemoState): Promise<Partial<MemoState>> {
    console.log('[EntityResolutionNode] Processing...');
    
    // Check if we're resuming from ENTITY RESOLUTION disambiguation
    // Must have: userSelection, valid resolverStepId, and non-empty candidates
    // This prevents processing planner HITL responses (which don't have candidates)
    if (state.disambiguation?.userSelection &&
        state.disambiguation.resolverStepId &&
        state.disambiguation.candidates &&
        state.disambiguation.candidates.length > 0) {
      console.log('[EntityResolutionNode] Resuming from disambiguation selection');
      return this.handleDisambiguationSelection(state);
    }
    
    // Log if we received a disambiguation but it's not from entity resolution
    if (state.disambiguation?.userSelection) {
      console.log('[EntityResolutionNode] Skipping disambiguation - not from entity resolution (planner HITL or empty candidates)');
    }
    
    // Get resolver results to process
    const resolverResults = state.resolverResults;
    if (!resolverResults || resolverResults.size === 0) {
      console.log('[EntityResolutionNode] No resolver results to process');
      return { needsHITL: false };
    }
    
    // Build context for resolvers
    const context = this.buildContext(state);
    
    // Track executor args
    const executorArgs = new Map<string, any>(state.executorArgs || new Map());
    
    // Process each unresolved step
    for (const [stepId, result] of resolverResults) {
      // Skip non-execute results
      if (result.type !== 'execute') {
        console.log(`[EntityResolutionNode] Skipping step ${stepId}: type=${result.type}`);
        continue;
      }
      
      // Skip already resolved steps
      if (executorArgs.has(stepId)) {
        console.log(`[EntityResolutionNode] Step ${stepId} already resolved`);
        continue;
      }
      
      // Get capability and resolver
      const capability = this.getCapabilityFromStep(stepId, state);
      const selectedEntityResolver = this.entityResolvers.get(capability);
      
      if (!selectedEntityResolver) {
        console.log(`[EntityResolutionNode] No resolver for capability: ${capability}, passing through`);
        executorArgs.set(stepId, result.args);
        continue;
      }
      
      console.log(`[EntityResolutionNode] Resolving step ${stepId} with ${capability} resolver`);
      
      // Resolve entities
      const operation = result.args?.operation || this.extractOperation(stepId, state);
      const resolution = await selectedEntityResolver.resolve(operation, result.args || {}, context);
      
      console.log(`[EntityResolutionNode] Resolution result: ${resolution.type}`);
      
      // Handle resolution output
      switch (resolution.type) {
        case 'resolved':
          // Store resolved args for executor
          executorArgs.set(stepId, resolution.args);
          break;
          
        case 'disambiguation':
          // Return disambiguation for HITL
          console.log(`[EntityResolutionNode] Disambiguation needed for step ${stepId}`);
          return {
            disambiguation: {
              type: selectedEntityResolver.domain as DisambiguationContext['type'],
              candidates: resolution.candidates || [],
              question: resolution.question || 'Please select:',
              allowMultiple: resolution.allowMultiple,
              resolverStepId: stepId,
              originalArgs: result.args,
            },
            needsHITL: true,
            hitlReason: 'disambiguation',
            executorArgs,
          };
          
        case 'not_found':
        case 'clarify_query':
          // NOT FOUND / CLARIFY: Do NOT interrupt - let graph finish with explanation
          // Store failure context so ResponseFormatter can build error message
          console.log(`[EntityResolutionNode] Not found / clarify for step ${stepId} - will end with explanation (no interrupt)`);
          
          // Store failure in executionResults so ResponseFormatter can explain
          const executionResults = new Map<string, any>(state.executionResults || new Map());
          executionResults.set(stepId, {
            stepId,
            success: false,
            error: resolution.error || `Could not find: ${resolution.searchedFor}`,
            data: {
              searchedFor: resolution.searchedFor,
              suggestions: resolution.suggestions,
              reason: resolution.type,
            },
            durationMs: 0,
          });
          
          // Continue to executor (will skip this step) -> ResponseFormatter -> END
          return {
            executionResults,
            executorArgs,
            needsHITL: false,  // NO interrupt for not_found!
          };
      }
    }
    
    // All steps resolved
    console.log(`[EntityResolutionNode] All steps resolved, executorArgs count: ${executorArgs.size}`);
    return { 
      executorArgs, 
      needsHITL: false,
      // Clear disambiguation if all resolved
      disambiguation: undefined,
    };
  }
  
  /**
   * Handle user's disambiguation selection
   */
  private async handleDisambiguationSelection(state: MemoState): Promise<Partial<MemoState>> {
    const disambiguation = state.disambiguation!;
    const selection = disambiguation.userSelection!;
    const stepId = disambiguation.resolverStepId;
    
    console.log(`[EntityResolutionNode] Processing selection: ${selection} for step ${stepId}`);
    
    // Get the appropriate resolver
    const resolverDomain = disambiguation.type === 'error' ? 'database' : disambiguation.type;
    const resolver = this.entityResolvers.get(resolverDomain as string);
    
    if (!resolver) {
      console.error(`[EntityResolutionNode] No resolver for domain: ${resolverDomain}`);
      return { error: `Unknown resolver type: ${resolverDomain}` };
    }
    
    // Apply selection - map candidates to ensure required fields
    const candidates = (disambiguation.candidates || []).map(c => ({
      id: c.id,
      displayText: c.displayText,
      entity: c.entity ?? null,
      score: c.score ?? 0,
      metadata: c.metadata ?? {},
    }));
    
    const resolved = await resolver.applySelection(
      selection,
      candidates,
      disambiguation.originalArgs || {}
    );
    
    console.log(`[EntityResolutionNode] Selection result: ${resolved.type}`);
    
    if (resolved.type !== 'resolved') {
      // Selection was invalid, ask again
      console.log('[EntityResolutionNode] Invalid selection, asking again');
      return {
        disambiguation: {
          ...disambiguation,
          userSelection: undefined,
          error: 'Invalid selection, please try again',
        },
        needsHITL: true,
        hitlReason: 'disambiguation',
      };
    }
    
    // Store resolved args
    const executorArgs = new Map<string, any>(state.executorArgs || new Map());
    executorArgs.set(stepId, resolved.args);
    
    console.log(`[EntityResolutionNode] Selection applied, checking for more unresolved steps`);
    
    // Check if there are more steps to resolve
    const resolverResults = state.resolverResults;
    let hasMoreUnresolved = false;
    
    for (const [otherStepId, result] of resolverResults) {
      if (result.type === 'execute' && !executorArgs.has(otherStepId)) {
        hasMoreUnresolved = true;
        break;
      }
    }
    
    if (hasMoreUnresolved) {
      // Continue resolving other steps
      console.log('[EntityResolutionNode] More steps to resolve, continuing...');
      return {
        executorArgs,
        disambiguation: { ...disambiguation, resolved: true },
        needsHITL: false,
      };
    }
    
    // All done
    console.log('[EntityResolutionNode] All steps resolved after selection');
    return {
      executorArgs,
      disambiguation: { ...disambiguation, resolved: true },
      needsHITL: false,
    };
  }
  
  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================
  
  /**
   * Build context for resolvers
   */
  private buildContext(state: MemoState): EntityResolverContext {
    return {
      userPhone: state.input.userPhone,
      language: state.input.language || 'he',
      timeContext: {
        now: state.now.date,
        timezone: state.input.timezone || 'Asia/Jerusalem',
        formatted: state.now.formatted,
      },
      recentMessages: state.recentMessages,
    };
  }
  
  /**
   * Get capability from step ID or plan
   */
  private getCapabilityFromStep(stepId: string, state: MemoState): string {
    // Try to find step in plan
    const plan = state.plannerOutput?.plan;
    if (plan) {
      const step = plan.find(s => s.id === stepId);
      if (step) {
        return step.capability;
      }
    }
    
    // Try to infer from resolver result args (only if execute type)
    const result = state.resolverResults.get(stepId);
    if (result && result.type === 'execute') {
      // Check for capability hints in args
      if (result.args.eventId || result.args.summary) return 'calendar';
      if (result.args.taskId || result.args.text) return 'database';
      if (result.args.listId || result.args.listName) return 'database';
      if (result.args.messageId || result.args.subject) return 'gmail';
      if (result.args.memoryId || result.args.query) return 'second-brain';
    }
    
    // Default
    return 'database';
  }
  
  /**
   * Extract operation from step
   */
  private extractOperation(stepId: string, state: MemoState): string {
    // Try to find in plan
    const plan = state.plannerOutput?.plan;
    if (plan) {
      const step = plan.find(s => s.id === stepId);
      if (step) {
        return step.action;
      }
    }
    
    // Try from resolver result (only if execute type)
    const result = state.resolverResults.get(stepId);
    if (result && result.type === 'execute' && result.args?.operation) {
      return result.args.operation;
    }
    
    return 'unknown';
  }
  
  /**
   * Create a node function for LangGraph registration
   */
  asNodeFunction(): (state: MemoState) => Promise<Partial<MemoState>> {
    return (state: MemoState) => this.process(state);
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createEntityResolutionNode() {
  const node = new EntityResolutionNode();
  return node.asNodeFunction();
}

