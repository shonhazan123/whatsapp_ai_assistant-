/**
 * Entity Resolution Module
 * 
 * Provides domain-specific entity resolvers that handle:
 * - Fuzzy matching and disambiguation
 * - HITL integration for ambiguous cases
 * - V1 logic ports (deriveWindow, findEventByCriteria, etc.)
 */

// Types
export * from './types.js';

// Config
export * from './resolution-config.js';

// Resolvers
export { CalendarEntityResolver } from './CalendarEntityResolver.js';
export { DatabaseEntityResolver } from './DatabaseEntityResolver.js';
export { GmailEntityResolver } from './GmailEntityResolver.js';
export { SecondBrainEntityResolver } from './SecondBrainEntityResolver.js';

// Re-export IEntityResolver interface for convenience
export type { IEntityResolver, EntityResolverContext, ResolutionOutput, ResolutionCandidate } from './types.js';

