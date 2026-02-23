/**
 * EntityResolutionNode
 *
 * Orchestrates entity resolution across all domains.
 *
 * This node:
 * 1. Takes resolver results (semantic action -> args)
 * 2. Applies domain-specific resolution (fuzzy match, ID lookup)
 * 3. Returns resolved args OR machine-only disambiguation for HITLGateNode
 *
 * On resume (after HITL), reads selection from hitlResults (canonical)
 * and applies it via resolver.applySelection().
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

  async process(state: MemoState): Promise<Partial<MemoState>> {
    console.log('[EntityResolutionNode] Processing...');

    // Check if we're resuming from HITL disambiguation via hitlResults
    if (this.isResumeFromDisambiguation(state)) {
      console.log('[EntityResolutionNode] Resuming from disambiguation selection via hitlResults');
      return this.handleDisambiguationSelection(state);
    }

    // Legacy compat: check disambiguation.userSelection (set by HITLGateNode Command)
    if (state.disambiguation?.userSelection &&
        state.disambiguation.resolverStepId &&
        state.disambiguation.candidates &&
        state.disambiguation.candidates.length > 0) {
      console.log('[EntityResolutionNode] Resuming from disambiguation selection (Command path)');
      return this.handleDisambiguationSelection(state);
    }

    const resolverResults = state.resolverResults;
    if (!resolverResults || resolverResults.size === 0) {
      console.log('[EntityResolutionNode] No resolver results to process');
      return {};
    }

    const context = this.buildContext(state);
    const executorArgs = new Map<string, any>(state.executorArgs || new Map());

    for (const [stepId, result] of resolverResults) {
      if (result.type !== 'execute') {
        console.log(`[EntityResolutionNode] Skipping step ${stepId}: type=${result.type}`);
        continue;
      }

      if (executorArgs.has(stepId)) {
        console.log(`[EntityResolutionNode] Step ${stepId} already resolved`);
        continue;
      }

      const capability = this.getCapabilityFromStep(stepId, state);
      const selectedEntityResolver = this.entityResolvers.get(capability);

      if (!selectedEntityResolver) {
        console.log(`[EntityResolutionNode] No resolver for capability: ${capability}, passing through`);
        executorArgs.set(stepId, result.args);
        continue;
      }

      console.log(`[EntityResolutionNode] Resolving step ${stepId} with ${capability} resolver`);

      const operation = result.args?.operation || this.extractOperation(stepId, state);
      const resolution = await selectedEntityResolver.resolve(operation, result.args || {}, context);

      console.log(`[EntityResolutionNode] Resolution result: ${resolution.type}`);

      switch (resolution.type) {
        case 'resolved':
          executorArgs.set(stepId, resolution.args);
          break;

        case 'disambiguation':
          // Machine-only disambiguation: candidates + metadata, no user-facing question text
          console.log(`[EntityResolutionNode] Disambiguation needed for step ${stepId}`);
          return {
            disambiguation: {
              type: selectedEntityResolver.domain as DisambiguationContext['type'],
              candidates: resolution.candidates || [],
              allowMultiple: resolution.allowMultiple,
              resolverStepId: stepId,
              originalArgs: result.args,
            },
            executorArgs,
          };

        case 'not_found':
        case 'clarify_query':
          console.log(`[EntityResolutionNode] Not found / clarify for step ${stepId} — will end with explanation (no interrupt)`);

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

          return {
            executionResults,
            executorArgs,
          };
      }
    }

    console.log(`[EntityResolutionNode] All steps resolved, executorArgs count: ${executorArgs.size}`);
    return {
      executorArgs,
      disambiguation: undefined,
    };
  }

  /**
   * Check if we're resuming from entity HITL via canonical hitlResults.
   * Look for the most recent hitlResult whose returnTo targets entity_resolution.
   */
  private isResumeFromDisambiguation(state: MemoState): boolean {
    if (!state.hitlResults || !state.disambiguation?.resolverStepId) return false;
    return Object.values(state.hitlResults).some(
      r => r.returnTo?.node === 'entity_resolution' && r.returnTo?.mode === 'apply_selection'
    );
  }

  private async handleDisambiguationSelection(state: MemoState): Promise<Partial<MemoState>> {
    const disambiguation = state.disambiguation!;
    const stepId = disambiguation.resolverStepId;

    // Get selection: prefer from disambiguation.userSelection (set by Command),
    // fall back to hitlResults
    let selection = disambiguation.userSelection;
    if (selection === undefined || selection === null) {
      const hitlEntry = Object.values(state.hitlResults || {}).find(
        r => r.returnTo?.node === 'entity_resolution'
      );
      selection = hitlEntry?.parsed;
    }

    if (selection === undefined || selection === null) {
      console.error('[EntityResolutionNode] No selection found in disambiguation or hitlResults');
      return { error: 'No disambiguation selection available' };
    }

    console.log(`[EntityResolutionNode] Processing selection: ${selection} for step ${stepId}`);

    const resolverDomain = disambiguation.type === 'error' ? 'database' : disambiguation.type;
    const resolver = this.entityResolvers.get(resolverDomain as string);

    if (!resolver) {
      console.error(`[EntityResolutionNode] No resolver for domain: ${resolverDomain}`);
      return { error: `Unknown resolver type: ${resolverDomain}` };
    }

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
      console.log('[EntityResolutionNode] Invalid selection, asking again');
      return {
        disambiguation: {
          ...disambiguation,
          userSelection: undefined,
          resolved: false,
        },
      };
    }

    const executorArgs = new Map<string, any>(state.executorArgs || new Map());
    executorArgs.set(stepId, resolved.args);

    console.log('[EntityResolutionNode] Selection applied, checking for more unresolved steps');

    const resolverResults = state.resolverResults;
    let hasMoreUnresolved = false;

    for (const [otherStepId, result] of resolverResults) {
      if (result.type === 'execute' && !executorArgs.has(otherStepId)) {
        hasMoreUnresolved = true;
        break;
      }
    }

    if (hasMoreUnresolved) {
      console.log('[EntityResolutionNode] More steps to resolve, continuing...');
      return {
        executorArgs,
        disambiguation: { ...disambiguation, resolved: true },
      };
    }

    console.log('[EntityResolutionNode] All steps resolved after selection');
    return {
      executorArgs,
      disambiguation: { ...disambiguation, resolved: true },
    };
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

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
      authContext: state.authContext,
    };
  }

  private getCapabilityFromStep(stepId: string, state: MemoState): string {
    const plan = state.plannerOutput?.plan;
    if (plan) {
      const step = plan.find(s => s.id === stepId);
      if (step) {
        return step.capability;
      }
    }

    const result = state.resolverResults.get(stepId);
    if (result && result.type === 'execute') {
      if (result.args.eventId || result.args.summary) return 'calendar';
      if (result.args.taskId || result.args.text) return 'database';
      if (result.args.listId || result.args.listName) return 'database';
      if (result.args.messageId || result.args.subject) return 'gmail';
      if (result.args.memoryId || result.args.query) return 'second-brain';
    }

    return 'database';
  }

  private extractOperation(stepId: string, state: MemoState): string {
    const plan = state.plannerOutput?.plan;
    if (plan) {
      const step = plan.find(s => s.id === stepId);
      if (step) {
        return step.action;
      }
    }

    const result = state.resolverResults.get(stepId);
    if (result && result.type === 'execute' && result.args?.operation) {
      return result.args.operation;
    }

    return 'unknown';
  }

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
