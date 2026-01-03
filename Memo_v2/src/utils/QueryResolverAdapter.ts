/**
 * QueryResolverAdapter
 * 
 * Adapts V1 QueryResolver for use in LangGraph nodes.
 * This version is stateless and doesn't rely on V1's ServiceContainer or ConversationWindow.
 * Instead, it receives data directly and returns resolution results.
 */

import { FuzzyMatcher } from './fuzzy.js';

// ============================================================================
// TYPES
// ============================================================================

export type EntityDomain = 'task' | 'list' | 'event' | 'email';

export interface EntityReference {
  id?: string;
  domain: EntityDomain;
  canonical: string;
  metadata?: Record<string, any>;
}

export interface ResolutionCandidate {
  entity: any;
  reference: EntityReference;
  score: number;
  reason: string;
}

export interface ResolutionResult {
  candidates: ResolutionCandidate[];
  disambiguationRequired: boolean;
}

// ============================================================================
// QUERY RESOLVER ADAPTER
// ============================================================================

export class QueryResolverAdapter {
  /**
   * Resolve a query against a list of entities
   */
  static resolve<T>(
    query: string,
    entities: T[],
    keys: string[],
    domain: EntityDomain,
    threshold: number = 0.6
  ): ResolutionResult {
    // First try exact match
    const exactMatches = entities.filter(entity => 
      keys.some(key => {
        const value = (entity as any)[key];
        return typeof value === 'string' && value.toLowerCase() === query.toLowerCase();
      })
    );
    
    if (exactMatches.length > 0) {
      const candidates = exactMatches.map((entity, i) => ({
        entity,
        reference: this.toRef(domain, (entity as any).id, this.getCanonical(entity, keys, domain)),
        score: 1.0,
        reason: 'exact match'
      }));
      
      return {
        candidates,
        disambiguationRequired: exactMatches.length > 1
      };
    }
    
    // Then fuzzy match
    const matches = FuzzyMatcher.search(query, entities, keys, threshold);
    
    const candidates = matches.map(m => ({
      entity: m.item,
      reference: this.toRef(domain, (m.item as any).id, this.getCanonical(m.item, keys, domain)),
      score: m.score,
      reason: `${keys.join('/')} match`
    }));
    
    return this.result(candidates);
  }
  
  /**
   * Resolve tasks
   */
  static resolveTasks(query: string, tasks: any[]): ResolutionResult {
    return this.resolve(query, tasks, ['text', 'category'], 'task');
  }
  
  /**
   * Resolve lists
   */
  static resolveLists(query: string, lists: any[]): ResolutionResult {
    return this.resolve(query, lists, ['list_name'], 'list');
  }
  
  /**
   * Resolve calendar events
   */
  static resolveEvents(query: string, events: any[]): ResolutionResult {
    return this.resolve(query, events, ['summary', 'description'], 'event');
  }
  
  /**
   * Resolve emails
   */
  static resolveEmails(query: string, emails: any[]): ResolutionResult {
    return this.resolve(query, emails, ['subject', 'from', 'to'], 'email');
  }
  
  /**
   * Resolve and return single entity or null
   */
  static resolveOne<T>(
    query: string,
    entities: T[],
    keys: string[],
    domain: EntityDomain,
    threshold: number = 0.6
  ): { entity: T | null; reason: string; disambiguation?: ResolutionResult } {
    const result = this.resolve(query, entities, keys, domain, threshold);
    
    if (result.candidates.length === 0) {
      return { entity: null, reason: 'no_match' };
    }
    
    if (result.disambiguationRequired) {
      return { entity: null, reason: 'ambiguous', disambiguation: result };
    }
    
    return { entity: result.candidates[0].entity, reason: 'single_high_confidence' };
  }
  
  /**
   * Format disambiguation message for user
   */
  static formatDisambiguation(
    candidates: ResolutionCandidate[],
    language: 'he' | 'en' = 'he'
  ): string {
    const header = language === 'he'
      ? `מצאתי ${candidates.length} פריטים תואמים:\n\n`
      : `I found ${candidates.length} matching items:\n\n`;
    
    const lines = candidates.slice(0, 5).map((c, i) => 
      `${i + 1}. ${c.reference.canonical}`
    );
    
    const footer = language === 'he' 
      ? `\nנא לבחור מספר.` 
      : `\nPlease reply with a number.`;
    
    return header + lines.join('\n') + footer;
  }
  
  /**
   * Format disambiguation options for HITL
   */
  static formatDisambiguationOptions(candidates: ResolutionCandidate[]): string[] {
    return candidates.slice(0, 5).map(c => c.reference.canonical);
  }
  
  /**
   * Get entity by selection index (1-based)
   */
  static getBySelection<T>(
    selectionIndex: number,
    candidates: ResolutionCandidate[]
  ): T | null {
    if (selectionIndex >= 1 && selectionIndex <= candidates.length) {
      return candidates[selectionIndex - 1].entity;
    }
    return null;
  }
  
  /**
   * Check if a string is a valid UUID format
   */
  static isValidUUID(value: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  }
  
  /**
   * Detect language from text
   */
  static detectLanguage(text: string): 'he' | 'en' {
    return /[\u0590-\u05FF]/.test(text) ? 'he' : 'en';
  }
  
  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================
  
  private static toRef(
    domain: EntityDomain, 
    id: string | undefined, 
    canonical: string, 
    metadata?: Record<string, any>
  ): EntityReference {
    return { id, domain, canonical, metadata };
  }
  
  private static getCanonical(entity: any, keys: string[], domain: EntityDomain): string {
    // Try each key in order
    for (const key of keys) {
      if (entity[key]) {
        return entity[key];
      }
    }
    
    // Fallback by domain
    switch (domain) {
      case 'task': return entity.text || 'Task';
      case 'list': return entity.list_name || 'List';
      case 'event': return entity.summary || 'Event';
      case 'email': return entity.subject || 'Email';
      default: return 'Item';
    }
  }
  
  private static result(candidates: ResolutionCandidate[]): ResolutionResult {
    const disambiguationRequired = 
      candidates.length > 1 && 
      ((candidates[0]?.score || 0) - (candidates[1]?.score || 0)) < 0.15;
    
    return { candidates, disambiguationRequired };
  }
}

