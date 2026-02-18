/**
 * GmailEntityResolver
 * 
 * Resolves email entities from natural language to message IDs.
 * Handles:
 * - Email lookup by subject, sender, or selection index
 * - Disambiguation for multiple matching emails
 */

import { FuzzyMatcher } from '../../utils/fuzzy.js';
import { getGmailService } from '../v1-services.js';
import {
  RESOLUTION_THRESHOLDS,
  getDisambiguationMessage,
} from './resolution-config.js';
import type {
  EntityResolverContext,
  IEntityResolver,
  ResolutionCandidate,
  ResolutionOutput,
} from './types.js';

// ============================================================================
// GMAIL ENTITY RESOLVER
// ============================================================================

export class GmailEntityResolver implements IEntityResolver {
  readonly domain = 'gmail' as const;
  
  /**
   * Resolve email entities from operation args
   */
  async resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Operations that need resolution
    const operationsNeedingResolution = [
      'getEmailById',
      'replyPreview',
      'replyConfirm',
      'markAsRead',
      'markAsUnread',
    ];
    
    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }
    
    // Already has messageId?
    if (args.messageId) {
      return { type: 'resolved', args };
    }
    
    // Check for selection index (from previous list)
    if (args.selectionIndex !== undefined) {
      return this.resolveBySelectionIndex(args, context);
    }
    
    // Search by hints
    const searchQuery = args.query || args.subjectHint || args.subject || args.from;
    if (!searchQuery) {
      return {
        type: 'clarify_query',
        error: 'No email identifier provided',
        searchedFor: '',
        suggestions: ['Provide subject, sender, or selection number from list'],
      };
    }
    
    // Fetch and fuzzy match emails
    const emails = await this.searchEmails(searchQuery, context);
    const candidates = this.fuzzyMatchEmails(searchQuery, emails);
    
    if (candidates.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('email_not_found', context.language, { searchedFor: searchQuery }),
        searchedFor: searchQuery,
      };
    }
    
    // Single match
    if (candidates.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, messageId: candidates[0].id },
      };
    }
    
    // Check score gap
    const scoreGap = candidates[0].score - candidates[1].score;
    if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, messageId: candidates[0].id },
      };
    }
    
    // Need disambiguation
    return {
      type: 'disambiguation',
      candidates: candidates.slice(0, 5),
      question: this.buildEmailDisambiguationQuestion(candidates.slice(0, 5), context.language),
      allowMultiple: false,
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
    // Try to parse as number if string
    if (typeof selection === 'string') {
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
    
    // Handle array selection (take first)
    if (Array.isArray(selection)) {
      selection = selection[0];
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
      args: { ...args, messageId: selected.id },
    };
  }
  
  // ==========================================================================
  // RESOLUTION METHODS
  // ==========================================================================
  
  /**
   * Resolve by selection index from previous email list
   */
  private async resolveBySelectionIndex(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // This would typically use state.refs.emails to get the email list
    // For now, we fetch recent emails and use the index
    const emails = await this.fetchRecentEmails(context);
    
    const index = args.selectionIndex - 1;  // 1-based to 0-based
    if (index < 0 || index >= emails.length) {
      return {
        type: 'clarify_query',
        error: `Invalid email number: ${args.selectionIndex}`,
        searchedFor: `email #${args.selectionIndex}`,
        suggestions: [`Choose a number between 1 and ${emails.length}`],
      };
    }
    
    const email = emails[index];
    return {
      type: 'resolved',
      resolvedIds: [email.id],
      args: { ...args, messageId: email.id },
    };
  }
  
  /**
   * Search emails by query
   */
  private async searchEmails(query: string, context: EntityResolverContext): Promise<any[]> {
    const gmailService = getGmailService();
    if (!gmailService) return [];
    
    try {
      // Build Gmail search query
      const searchQuery = this.buildGmailSearchQuery(query);
      
      const result = await gmailService.listEmails({
        query: searchQuery,
        maxResults: 20,
      });
      
      if (result.success && result.data?.emails) {
        return result.data.emails;
      }
    } catch (error) {
      console.error('[GmailEntityResolver] Failed to search emails:', error);
    }
    
    return [];
  }
  
  /**
   * Fetch recent emails
   */
  private async fetchRecentEmails(context: EntityResolverContext): Promise<any[]> {
    const gmailService = getGmailService();
    if (!gmailService) return [];
    
    try {
      const result = await gmailService.listEmails({
        maxResults: 10,
      });
      
      if (result.success && result.data?.emails) {
        return result.data.emails;
      }
    } catch (error) {
      console.error('[GmailEntityResolver] Failed to fetch recent emails:', error);
    }
    
    return [];
  }
  
  /**
   * Build Gmail search query from natural language
   */
  private buildGmailSearchQuery(query: string): string {
    // Check if it looks like an email address
    if (query.includes('@')) {
      return `from:${query} OR to:${query}`;
    }
    
    // Otherwise search in subject
    return `subject:${query}`;
  }
  
  /**
   * Fuzzy match emails against search text
   */
  private fuzzyMatchEmails(searchText: string, emails: any[]): ResolutionCandidate[] {
    if (emails.length === 0) return [];
    
    const matches = FuzzyMatcher.search<any>(
      searchText,
      emails,
      ['subject', 'from', 'snippet'],
      RESOLUTION_THRESHOLDS.FUZZY_MATCH_MIN
    );
    
    return matches.map(m => ({
      id: m.item.id || m.item.messageId,
      displayText: this.formatEmailDisplay(m.item),
      entity: m.item,
      score: m.score,
      metadata: {
        from: m.item.from,
        to: m.item.to,
        date: m.item.date,
        hasAttachments: m.item.hasAttachments,
      },
    }));
  }
  
  /**
   * Format email for display
   */
  private formatEmailDisplay(email: any): string {
    const subject = email.subject || '(No Subject)';
    const from = email.from || 'Unknown';
    
    // Extract just the name/email from "Name <email@example.com>" format
    const fromMatch = from.match(/^([^<]+)/);
    const fromDisplay = fromMatch ? fromMatch[1].trim() : from;
    
    // Format date if available
    let dateStr = '';
    if (email.date) {
      const date = new Date(email.date);
      dateStr = ` (${date.toLocaleDateString()})`;
    }
    
    return `${subject} - מאת ${fromDisplay}${dateStr}`;
  }
  
  /**
   * Build email disambiguation question
   */
  private buildEmailDisambiguationQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');
    return getDisambiguationMessage('email_multiple', language, { options: optionsText });
  }
}

