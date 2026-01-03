/**
 * Executor exports
 */

export { BaseExecutor, type ExecutorContext } from './BaseExecutor.js';
export { CalendarExecutor, createCalendarExecutor } from './CalendarExecutor.js';
export { DatabaseExecutor, createDatabaseExecutor } from './DatabaseExecutor.js';
export { GmailExecutor, createGmailExecutor } from './GmailExecutor.js';
export { SecondBrainExecutor, createSecondBrainExecutor } from './SecondBrainExecutor.js';
export { GeneralExecutor, MetaExecutor, createGeneralExecutor, createMetaExecutor } from './GeneralExecutor.js';

// ============================================================================
// EXECUTOR REGISTRY
// ============================================================================

import { CalendarExecutor } from './CalendarExecutor.js';
import { DatabaseExecutor } from './DatabaseExecutor.js';
import { GmailExecutor } from './GmailExecutor.js';
import { SecondBrainExecutor } from './SecondBrainExecutor.js';
import { GeneralExecutor, MetaExecutor } from './GeneralExecutor.js';

export const EXECUTOR_REGISTRY = [
  new CalendarExecutor(),
  new DatabaseExecutor(),
  new GmailExecutor(),
  new SecondBrainExecutor(),
  new GeneralExecutor(),
  new MetaExecutor(),
];

/**
 * Find executor for a capability
 */
export function findExecutor(capability: string) {
  return EXECUTOR_REGISTRY.find(e => e.capability === capability);
}

