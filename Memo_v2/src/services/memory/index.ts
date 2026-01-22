/**
 * Memory Service - Centralized exports
 * 
 * This module provides all memory-related functionality for Memo V2.
 * Use MemoryService for all memory operations - it handles format conversion
 * and provides a clean API.
 */

// Main service
export { MemoryService, getMemoryService, type RecentTaskSnapshot } from './MemoryService.js';

// ConversationWindow (for advanced use cases or direct access)
export { 
  ConversationWindow,
  type ConversationMessage as CWConversationMessage, // Renamed to avoid conflict with types/index.ts
} from './ConversationWindow.js';
