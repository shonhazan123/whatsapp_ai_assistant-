/**
 * Service Adapters
 * 
 * Thin wrappers around V1 services for use in Memo V2 executors.
 * These adapters normalize the interface between resolver args and V1 service methods.
 * 
 * Path aliases configured in tsconfig.json allow importing from V1:
 * - @v1/services/* → src/services/*
 */

export { CalendarServiceAdapter } from './CalendarServiceAdapter.js';
export { TaskServiceAdapter } from './TaskServiceAdapter.js';
export { ListServiceAdapter } from './ListServiceAdapter.js';
export { GmailServiceAdapter } from './GmailServiceAdapter.js';
export { SecondBrainServiceAdapter } from './SecondBrainServiceAdapter.js';

