/**
 * SecondBrainEntityResolver
 * 
 * Resolves memory entities from natural language to memory IDs.
 * Handles:
 * - Memory lookup by content/query
 * - Disambiguation for multiple matching memories
 */

import { FuzzyMatcher } from '../../utils/fuzzy.js';
import { getSecondBrainService } from '../v1-services.js';
import {
  RESOLUTION_THRESHOLDS,
} from './resolution-config.js';
import type {
  EntityResolverContext,
  IEntityResolver,
  ResolutionCandidate,
  ResolutionOutput,
} from './types.js';

// ============================================================================
// SECOND BRAIN ENTITY RESOLVER
// ============================================================================

export class SecondBrainEntityResolver implements IEntityResolver {
  readonly domain = 'second-brain' as const;
  
  /**
   * Resolve memory entities from operation args
   */
  async resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Operations that need resolution
    const operationsNeedingResolution = ['update', 'delete'];
    
    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }
    
    // Already has memoryId?
    if (args.memoryId) {
      return { type: 'resolved', args };
    }
    
    // Search query
    const searchQuery = args.query || args.text || args.content;
    if (!searchQuery) {
      return {
        type: 'clarify_query',
        error: 'No memory description provided',
        searchedFor: '',
        suggestions: ['Provide what the memory is about'],
      };
    }
    
    // Search memories
    const memories = await this.searchMemories(searchQuery, context);
    
    if (memories.length === 0) {
      return {
        type: 'not_found',
        error: this.buildNotFoundMessage(searchQuery, context.language),
        searchedFor: searchQuery,
      };
    }
    
    // Create candidates from search results
    const candidates = this.createCandidates(memories);
    
    // Single match
    if (candidates.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, memoryId: candidates[0].id },
      };
    }
    
    // Check score gap (memories come with similarity scores from vector search)
    const scoreGap = candidates[0].score - candidates[1].score;
    if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, memoryId: candidates[0].id },
      };
    }
    
    // Need disambiguation
    return {
      type: 'disambiguation',
      candidates: candidates.slice(0, 5),
      question: this.buildDisambiguationQuestion(candidates.slice(0, 5), context.language),
      allowMultiple: operation === 'delete',
    };
  }
  
  /**
   * Apply user's disambiguation selection
   */
  async applySelection(
    selection: number | number[] | string,
    candidates: ResolutionCandidate[],
    args: Record<string, any>
  ): Promise<ResolutionOutput> {
    // Handle "both" or "all" selection
    if (typeof selection === 'string') {
      const lowerSelection = selection.toLowerCase();
      if (lowerSelection === 'both' || lowerSelection === 'all' || 
          lowerSelection === 'שניהם' || lowerSelection === 'כולם') {
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
    
    // Handle array selection
    if (Array.isArray(selection)) {
      const selectedCandidates = selection
        .map(idx => candidates[idx - 1])
        .filter(Boolean);
      
      if (selectedCandidates.length === 0) {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
      
      return {
        type: 'resolved',
        resolvedIds: selectedCandidates.map(c => c.id),
        args: { 
          ...args, 
          memoryId: selectedCandidates[0].id,
          memoryIds: selectedCandidates.map(c => c.id),
        },
      };
    }
    
    // Handle single number selection (1-based)
    const index = selection - 1;
    if (index < 0 || index >= candidates.length) {
      return {
        type: 'disambiguation',
        candidates,
        question: 'Invalid selection. Please reply with a number.',
      };
    }
    
    const selected = candidates[index];
    return {
      type: 'resolved',
      resolvedIds: [selected.id],
      args: { ...args, memoryId: selected.id },
    };
  }
  
  // ==========================================================================
  // RESOLUTION METHODS
  // ==========================================================================
  
  /**
   * Search memories using vector similarity
   */
  private async searchMemories(query: string, context: EntityResolverContext): Promise<any[]> {
    const secondBrainService = getSecondBrainService();
    if (!secondBrainService) return [];
    
    try {
      const result = await secondBrainService.searchMemory(
        context.userPhone,
        query,
        10  // Limit to 10 results
      );
      
      if (result.success && result.data?.results) {
        return result.data.results;
      }
      if (result.success && Array.isArray(result.data)) {
        return result.data;
      }
    } catch (error) {
      console.error('[SecondBrainEntityResolver] Failed to search memories:', error);
    }
    
    return [];
  }
  
  /**
   * Create candidates from memory search results
   */
  private createCandidates(memories: any[]): ResolutionCandidate[] {
    return memories.map(memory => ({
      id: memory.id,
      displayText: this.formatMemoryDisplay(memory),
      entity: memory,
      score: memory.similarity || memory.score || 0.8,
      metadata: {
        createdAt: memory.created_at,
        updatedAt: memory.updated_at,
        category: memory.metadata?.category,
      },
    }));
  }
  
  /**
   * Format memory for display
   */
  private formatMemoryDisplay(memory: any): string {
    const content = memory.content || memory.text || '';
    
    // Truncate long content
    const maxLength = 100;
    if (content.length > maxLength) {
      return content.substring(0, maxLength) + '...';
    }
    
    return content || 'Memory';
  }
  
  /**
   * Build not found message
   */
  private buildNotFoundMessage(searchedFor: string, language: 'he' | 'en' | 'other'): string {
    if (language === 'he') {
      return `לא מצאתי זיכרון התואם ל-"${searchedFor}"`;
    }
    return `No memory matching "${searchedFor}" found`;
  }
  
  /**
   * Build disambiguation question
   */
  private buildDisambiguationQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');
    
    if (language === 'he') {
      return `מצאתי כמה זיכרונות תואמים:\n${optionsText}\n\nאיזה התכוונת?`;
    }
    return `I found multiple matching memories:\n${optionsText}\n\nWhich one?`;
  }
}

