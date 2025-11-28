/**
 * Configuration for Second Brain (RAG) memory system
 */

/**
 * Default minimum similarity threshold for semantic search
 * Range: 0.0 to 1.0
 * - Higher values (0.7-0.9): More strict, only very similar results
 * - Lower values (0.3-0.5): More lenient, broader results
 * - Default: 0.5 (balanced between precision and recall)
 */
export const DEFAULT_MIN_SIMILARITY = 0.4;

/**
 * Fallback similarity thresholds to try if no results found
 * These will be tried in order from highest to lowest
 */
export const FALLBACK_SIMILARITY_THRESHOLDS = [0.4, 0.3, 0.2, 0.1];

/**
 * Minimum threshold to start fallback attempts
 * If initial threshold is below this, fallback won't be attempted
 */
export const MIN_FALLBACK_THRESHOLD = 0.3;

/**
 * Default limit for search results
 */
export const DEFAULT_SEARCH_LIMIT = 5;

/**
 * Default limit for getAllMemory
 */
export const DEFAULT_GET_ALL_LIMIT = 20;

/**
 * Default threshold for merging memories
 */
export const DEFAULT_MERGE_THRESHOLD = 0.45;

