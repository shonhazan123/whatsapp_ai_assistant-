/**
 * Resolver Index
 * 
 * Central export for all resolver implementations.
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
 */
export function findResolver(capability: Capability, action: string): BaseResolver | undefined {
  return RESOLVER_REGISTRY.find(r => 
    r.capability === capability && r.canHandle(action)
  );
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


