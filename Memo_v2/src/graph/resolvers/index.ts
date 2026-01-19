/**
 * Resolver Index
 * 
 * Central export for all resolver implementations.
 * 
 * NEW ARCHITECTURE (January 2026):
 * - Planner routes to capability (not specific action)
 * - Each resolver uses its own LLM to determine operation and extract fields
 * - Resolvers handle all actions for their capability
 * - Schema-based routing with explicit patterns and examples
 */

// Base classes
export { BaseResolver, LLMResolver, TemplateResolver } from './BaseResolver.js';
export type { ResolverConfig, ResolverOutput } from './BaseResolver.js';

// Resolver Schema System
export {
  CALENDAR_FIND_SCHEMA,
  CALENDAR_MUTATE_SCHEMA, DATABASE_LIST_SCHEMA, DATABASE_TASK_SCHEMA, formatSchemasForPrompt, GENERAL_SCHEMA, getBestMatch, getResolverSchemas,
  getSchemaByName,
  getSchemasForCapability, GMAIL_SCHEMA, matchPatterns, META_SCHEMA, RESOLVER_SCHEMAS, SECONDBRAIN_SCHEMA
} from './ResolverSchema.js';
export type { PatternMatchResult, ResolverSchema } from './ResolverSchema.js';

// Calendar resolvers
export {
  CalendarFindResolver,
  CalendarMutateResolver,
  createCalendarFindResolver,
  createCalendarMutateResolver
} from './CalendarResolvers.js';

// Database resolvers
export {
  createDatabaseListResolver, createDatabaseTaskResolver, DatabaseListResolver, DatabaseTaskResolver
} from './DatabaseResolvers.js';

// Gmail resolver
export {
  createGmailResolver, GmailResolver
} from './GmailResolver.js';

// SecondBrain resolver
export {
  createSecondBrainResolver, SecondBrainResolver
} from './SecondBrainResolver.js';

// General and Meta resolvers
export {
  createGeneralResolver,
  createMetaResolver, GeneralResolver,
  MetaResolver
} from './GeneralResolver.js';

// ============================================================================
// RESOLVER REGISTRY
// ============================================================================

import type { Capability } from '../../types/index.js';
import type { BaseResolver } from './BaseResolver.js';
import { CalendarFindResolver, CalendarMutateResolver } from './CalendarResolvers.js';
import { DatabaseListResolver, DatabaseTaskResolver } from './DatabaseResolvers.js';
import { GeneralResolver, MetaResolver } from './GeneralResolver.js';
import { GmailResolver } from './GmailResolver.js';
import { getSchemasForCapability, matchPatterns } from './ResolverSchema.js';
import { SecondBrainResolver } from './SecondBrainResolver.js';

/**
 * Registry of all available resolvers
 */
export const RESOLVER_REGISTRY: BaseResolver[] = [
  new CalendarFindResolver(),
  new CalendarMutateResolver(),
  new DatabaseTaskResolver(),
  new DatabaseListResolver(),
  new GmailResolver(),
  new SecondBrainResolver(),
  new GeneralResolver(),
  new MetaResolver(),
];

/**
 * Find a resolver that can handle a given capability and action
 * 
 * NEW BEHAVIOR: If action is generic (e.g., "calendar_operation", "task_operation"),
 * returns the first resolver for that capability.
 */
export function findResolver(capability: Capability, action: string): BaseResolver | undefined {
  // First try exact match
  const exactMatch = RESOLVER_REGISTRY.find(r => 
    r.capability === capability && r.canHandle(action)
  );
  
  if (exactMatch) {
    return exactMatch;
  }
  
  // Fallback: return first resolver for the capability
  // This handles generic actions like "calendar_operation", "task_operation"
  return RESOLVER_REGISTRY.find(r => r.capability === capability);
}

/**
 * Get the primary resolver for a capability
 * Used when routing with only capability (no specific action)
 */
export function getPrimaryResolver(capability: Capability): BaseResolver | undefined {
  // Map capabilities to their primary resolvers
  const primaryResolverMap: Record<string, string> = {
    'calendar': 'calendar_mutate_resolver', // CalendarMutate handles more cases
    'database': 'database_task_resolver',   // Tasks are more common than lists
    'gmail': 'gmail_resolver',
    'second-brain': 'secondbrain_resolver',
    'general': 'general_resolver',
    'meta': 'meta_resolver',
  };
  
  const primaryName = primaryResolverMap[capability];
  if (primaryName) {
    return RESOLVER_REGISTRY.find(r => r.name === primaryName);
  }
  
  // Fallback: first resolver for capability
  return RESOLVER_REGISTRY.find(r => r.capability === capability);
}

/**
 * Get all resolvers for a capability
 */
export function getResolversForCapability(capability: Capability): BaseResolver[] {
  return RESOLVER_REGISTRY.filter(r => r.capability === capability);
}

/**
 * Get resolver by name
 */
export function getResolverByName(name: string): BaseResolver | undefined {
  return RESOLVER_REGISTRY.find(r => r.name === name);
}

/**
 * Smart resolver selection based on intent hint
 * 
 * Uses ResolverSchema actionHints as the SINGLE SOURCE OF TRUTH.
 * The Planner outputs action hints that match the schema definitions,
 * and this function finds the resolver whose actionHints include the hint.
 * 
 * Examples:
 * - "list_events", "find_event" → CalendarFindResolver (matches its actionHints)
 * - "create_event", "delete_event" → CalendarMutateResolver (matches its actionHints)
 * - "list_tasks", "create_reminder" → DatabaseTaskResolver (matches its actionHints)
 * - "create_list", "add_to_list" → DatabaseListResolver (matches its actionHints)
 */
export function selectResolver(capability: Capability, intentHint: string): BaseResolver | undefined {
  const hint = (intentHint || '').toLowerCase();
  
  // Normalize hint for matching (e.g., "list tasks" → "list_tasks")
  const normalizedHint = hint.replace(/\s+/g, '_');
  
  // Get all schemas for this capability (sorted by priority in ResolverSchema.ts)
  const schemas = getSchemasForCapability(capability);
  
  if (schemas.length === 0) {
    // No schemas defined for this capability, fallback to primary resolver
    return getPrimaryResolver(capability);
  }
  
  // If only one resolver for this capability, return it directly
  if (schemas.length === 1) {
    return getResolverByName(schemas[0].name);
  }
  
  // Multiple resolvers for this capability - match by actionHints
  // Check each schema's actionHints for a match
  for (const schema of schemas) {
    // Check if normalized hint matches any actionHint exactly
    if (schema.actionHints.includes(normalizedHint)) {
      console.log(`[selectResolver] Matched "${normalizedHint}" to ${schema.name} via actionHints`);
      return getResolverByName(schema.name);
    }
  }
  
  // No exact match - try pattern matching against trigger patterns
  for (const schema of schemas) {
    const allPatterns = [...schema.triggerPatterns.hebrew, ...schema.triggerPatterns.english];
    for (const pattern of allPatterns) {
      if (hint.includes(pattern.toLowerCase())) {
        console.log(`[selectResolver] Matched "${hint}" to ${schema.name} via pattern "${pattern}"`);
        return getResolverByName(schema.name);
      }
    }
  }
  
  // Still no match - return the highest priority resolver for this capability
  // (schemas are already sorted by priority in getSchemasForCapability)
  console.log(`[selectResolver] No match for "${hint}", defaulting to ${schemas[0].name}`);
  return getResolverByName(schemas[0].name);
}

/**
 * Schema-based resolver selection using pattern matching
 * 
 * Uses the ResolverSchema patterns to find the best matching resolver
 * based on the raw user message content.
 * 
 * @param message - Raw user message
 * @param constrainToCapability - Optional: only consider resolvers for this capability
 * @returns The best matching resolver or undefined
 */
export function selectResolverByPattern(
  message: string, 
  constrainToCapability?: Capability
): BaseResolver | undefined {
  const matches = matchPatterns(message);
  
  // Filter by capability if specified
  const filtered = constrainToCapability 
    ? matches.filter(m => m.schema.capability === constrainToCapability)
    : matches;
  
  if (filtered.length === 0) {
    return undefined;
  }
  
  const bestMatch = filtered[0];
  console.log(`[selectResolverByPattern] Best match: ${bestMatch.schema.name} (score: ${bestMatch.score}, patterns: ${bestMatch.matchedPatterns.join(', ')})`);
  
  return getResolverByName(bestMatch.schema.name);
}

/**
 * Get routing suggestion based on pattern matching
 * 
 * Returns pattern match results with scores for debugging and logging.
 * Used by PlannerNode for pre-routing hints.
 */
export function getRoutingSuggestions(message: string): Array<{
  resolverName: string;
  capability: Capability;
  score: number;
  matchedPatterns: string[];
}> {
  const matches = matchPatterns(message);
  
  return matches.map(m => ({
    resolverName: m.schema.name,
    capability: m.schema.capability,
    score: m.score,
    matchedPatterns: m.matchedPatterns,
  }));
}
