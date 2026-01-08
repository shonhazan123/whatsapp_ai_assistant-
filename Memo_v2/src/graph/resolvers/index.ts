/**
 * Resolver Index
 * 
 * Central export for all resolver implementations.
 * 
 * NEW ARCHITECTURE (January 2026):
 * - Planner routes to capability (not specific action)
 * - Each resolver uses its own LLM to determine operation and extract fields
 * - Resolvers handle all actions for their capability
 */

// Base classes
export { BaseResolver, LLMResolver, TemplateResolver } from './BaseResolver.js';
export type { ResolverConfig, ResolverOutput } from './BaseResolver.js';

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
 * The intent from Planner gives hints about whether this is a read or write operation:
 * - "list events", "find event", "check schedule" → CalendarFindResolver
 * - "create event", "delete event", "update event" → CalendarMutateResolver
 * - "create reminder", "delete task" → DatabaseTaskResolver
 * - "create list", "add to list" → DatabaseListResolver
 */
export function selectResolver(capability: Capability, intentHint: string): BaseResolver | undefined {
  const hint = (intentHint || '').toLowerCase();
  
  switch (capability) {
    case 'calendar':
      // Read operations → FindResolver
      if (/list|find|get|show|what.*have|schedule|מה יש|מתי|check/i.test(hint)) {
        return getResolverByName('calendar_find_resolver');
      }
      // Write operations → MutateResolver
      return getResolverByName('calendar_mutate_resolver');
      
    case 'database':
      // List operations → ListResolver
      if (/list|רשימה/i.test(hint)) {
        return getResolverByName('database_list_resolver');
      }
      // Task/reminder operations → TaskResolver
      return getResolverByName('database_task_resolver');
      
    case 'gmail':
      return getResolverByName('gmail_resolver');
      
    case 'second-brain':
      return getResolverByName('secondbrain_resolver');
      
    case 'general':
      return getResolverByName('general_resolver');
      
    case 'meta':
      return getResolverByName('meta_resolver');
      
    default:
      return undefined;
  }
}
