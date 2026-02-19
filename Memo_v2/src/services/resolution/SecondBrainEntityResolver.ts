/**
 * SecondBrainEntityResolver
 *
 * Handles two resolution scenarios:
 *
 * 1. CONFLICT DETECTION (storeMemory for contact/kv):
 *    - Runs hybrid retrieval to find strong matches
 *    - If strong match found → HITL disambiguation:
 *        Option 1: "Update existing (override)"
 *        Option 2: "Keep both (insert new)"
 *    - Note type: NEVER triggers conflict check
 *
 * 2. ENTITY LOOKUP (updateMemory/deleteMemory/getMemoryById):
 *    - Searches for matching memories
 *    - Disambiguation if multiple matches
 */

import {
  getSecondBrainVaultService,
  type ConflictMatch,
} from '../second-brain/SecondBrainVaultService.js';
import {
  RESOLUTION_THRESHOLDS,
} from './resolution-config.js';
import type {
  EntityResolverContext,
  IEntityResolver,
  ResolutionCandidate,
  ResolutionOutput,
} from './types.js';

// Sentinel ID used when user chooses "keep both / insert new"
const INSERT_NEW_SENTINEL = '__insert_new__';

export class SecondBrainEntityResolver implements IEntityResolver {
  readonly domain = 'second-brain' as const;

  async resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // ======================================================================
    // SCENARIO 1: Conflict detection on storeMemory for contact/kv
    // ======================================================================
    if (operation === 'storeMemory' && args._needsConflictCheck && args.memory) {
      const memoryType = args.memory.type;

      if (memoryType === 'note') {
        return { type: 'resolved', args };
      }

      if (memoryType === 'contact' || memoryType === 'kv') {
        return this.checkConflicts(args, context);
      }

      return { type: 'resolved', args };
    }

    // ======================================================================
    // SCENARIO 2: Entity lookup for update/delete/getById
    // ======================================================================
    const operationsNeedingResolution = ['updateMemory', 'deleteMemory', 'getMemoryById'];

    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }

    if (args.memoryId) {
      return { type: 'resolved', args };
    }

    const searchQuery = args.searchText || args.query || args.memory?.content;
    if (!searchQuery) {
      return {
        type: 'clarify_query',
        error: 'No memory description provided',
        searchedFor: '',
        suggestions: ['Provide what the memory is about'],
      };
    }

    return this.searchAndDisambiguate(searchQuery, args, operation, context);
  }

  async applySelection(
    selection: number | number[] | string,
    candidates: ResolutionCandidate[],
    args: Record<string, any>
  ): Promise<ResolutionOutput> {
    // Handle "both" / "all"
    if (typeof selection === 'string') {
      const lower = selection.toLowerCase();
      if (lower === 'both' || lower === 'all' || lower === 'שניהם' || lower === 'כולם') {
        return {
          type: 'resolved',
          resolvedIds: candidates.map(c => c.id),
          args: { ...args, memoryIds: candidates.map(c => c.id) },
        };
      }

      const parsed = parseInt(selection, 10);
      if (!isNaN(parsed)) {
        selection = parsed;
      } else {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
    }

    if (Array.isArray(selection)) {
      const selected = selection.map(idx => candidates[idx - 1]).filter(Boolean);
      if (selected.length === 0) {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
      return this.applyConflictOrEntitySelection(selected, args);
    }

    const index = (selection as number) - 1;
    if (index < 0 || index >= candidates.length) {
      return {
        type: 'disambiguation',
        candidates,
        question: 'Invalid selection. Please reply with a number.',
      };
    }

    return this.applyConflictOrEntitySelection([candidates[index]], args);
  }

  // ==========================================================================
  // CONFLICT DETECTION
  // ==========================================================================

  private async checkConflicts(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const vault = getSecondBrainVaultService();
    const memory = args.memory;

    let conflicts: ConflictMatch[];
    try {
      conflicts = await vault.findConflicts(
        context.userPhone,
        memory.content,
        memory.type
      );
    } catch (error) {
      console.error('[SecondBrainEntityResolver] Conflict check failed, proceeding with insert:', error);
      return { type: 'resolved', args };
    }

    const strongMatches = conflicts.filter(c => c.isStrongMatch);

    if (strongMatches.length === 0) {
      return { type: 'resolved', args };
    }

    const topMatch = strongMatches[0].memory;
    const candidates: ResolutionCandidate[] = [
      {
        id: topMatch.id,
        displayText: this.formatConflictDisplay(topMatch, context.language),
        entity: topMatch,
        score: topMatch.similarity,
        metadata: { action: 'override' },
      },
      {
        id: INSERT_NEW_SENTINEL,
        displayText: context.language === 'he'
          ? 'שמור כרשומה חדשה (השאר את שניהם)'
          : 'Save as new entry (keep both)',
        entity: null,
        score: 0,
        metadata: { action: 'insert_new' },
      },
    ];

    const question = this.buildConflictQuestion(topMatch, memory, context.language);

    return {
      type: 'disambiguation',
      candidates,
      question,
      allowMultiple: false,
    };
  }

  private formatConflictDisplay(match: any, language: 'he' | 'en' | 'other'): string {
    const content = match.content || '';
    const truncated = content.length > 100 ? content.substring(0, 100) + '...' : content;
    if (language === 'he') {
      return `עדכן את הקיים: "${truncated}"`;
    }
    return `Update existing: "${truncated}"`;
  }

  private buildConflictQuestion(
    existing: any,
    newMemory: any,
    language: 'he' | 'en' | 'other'
  ): string {
    const existingContent = existing.content?.substring(0, 80) || '';
    const newContent = newMemory.content?.substring(0, 80) || '';

    if (language === 'he') {
      return `מצאתי רשומה קיימת דומה:\n"${existingContent}"\n\nאתה רוצה לעדכן אותה עם:\n"${newContent}"\n\nאו לשמור את שניהם?`;
    }
    return `I found an existing similar entry:\n"${existingContent}"\n\nDo you want to update it with:\n"${newContent}"\n\nOr keep both?`;
  }

  // ==========================================================================
  // ENTITY SEARCH + DISAMBIGUATION
  // ==========================================================================

  private async searchAndDisambiguate(
    searchQuery: string,
    args: Record<string, any>,
    operation: string,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const vault = getSecondBrainVaultService();

    let memories;
    try {
      memories = await vault.hybridSearch(
        context.userPhone,
        searchQuery,
        { type: args.type, limit: 10 }
      );
    } catch (error) {
      console.error('[SecondBrainEntityResolver] Search failed:', error);
      return {
        type: 'not_found',
        error: context.language === 'he'
          ? `לא הצלחתי לחפש זיכרונות`
          : 'Failed to search memories',
        searchedFor: searchQuery,
      };
    }

    if (memories.length === 0) {
      return {
        type: 'not_found',
        error: context.language === 'he'
          ? `לא מצאתי זיכרון התואם ל-"${searchQuery}"`
          : `No memory matching "${searchQuery}" found`,
        searchedFor: searchQuery,
      };
    }

    const candidates: ResolutionCandidate[] = memories.map(m => ({
      id: m.id,
      displayText: this.formatMemoryDisplay(m),
      entity: m,
      score: m.similarity,
      metadata: { type: m.type, createdAt: m.created_at },
    }));

    if (candidates.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, memoryId: candidates[0].id },
      };
    }

    const scoreGap = candidates[0].score - candidates[1].score;
    if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, memoryId: candidates[0].id },
      };
    }

    return {
      type: 'disambiguation',
      candidates: candidates.slice(0, 5),
      question: this.buildDisambiguationQuestion(candidates.slice(0, 5), context.language),
      allowMultiple: operation === 'deleteMemory',
    };
  }

  // ==========================================================================
  // SELECTION HANDLING
  // ==========================================================================

  private applyConflictOrEntitySelection(
    selected: ResolutionCandidate[],
    args: Record<string, any>
  ): ResolutionOutput {
    const first = selected[0];

    if (first.id === INSERT_NEW_SENTINEL) {
      return {
        type: 'resolved',
        args: { ...args, conflictDecision: 'insert' },
      };
    }

    if (first.metadata?.action === 'override') {
      return {
        type: 'resolved',
        resolvedIds: [first.id],
        args: { ...args, conflictDecision: 'override', conflictTargetId: first.id },
      };
    }

    if (selected.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [first.id],
        args: { ...args, memoryId: first.id },
      };
    }

    return {
      type: 'resolved',
      resolvedIds: selected.map(c => c.id),
      args: {
        ...args,
        memoryId: first.id,
        memoryIds: selected.map(c => c.id),
      },
    };
  }

  // ==========================================================================
  // FORMATTING
  // ==========================================================================

  private formatMemoryDisplay(memory: any): string {
    const content = memory.content || '';
    const typeLabel = memory.type ? `[${memory.type}] ` : '';
    const maxLen = 90;
    const truncated = content.length > maxLen ? content.substring(0, maxLen) + '...' : content;
    return `${typeLabel}${truncated}`;
  }

  private buildDisambiguationQuestion(
    candidates: ResolutionCandidate[],
    language: 'he' | 'en' | 'other'
  ): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');

    if (language === 'he') {
      return `מצאתי כמה זיכרונות תואמים:\n${optionsText}\n\nאיזה התכוונת?`;
    }
    return `I found multiple matching memories:\n${optionsText}\n\nWhich one?`;
  }
}
