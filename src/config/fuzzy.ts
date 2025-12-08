/**
 * Fuzzy Matching Configuration
 * Global constants for fuzzy search and similarity matching
 */

export const FuzzyConfig = {
  /**
   * Default minimum similarity score threshold (0-1, higher is more strict)
   * Used when no threshold is explicitly provided
   * 0.6 = 60% similarity required for a match
   */
  DEFAULT_SIMILARITY_THRESHOLD: 0.52,

  /**
   * Minimum number of characters required for a match
   * Shorter matches are ignored to avoid false positives
   */
  MIN_MATCH_CHARACTER_LENGTH: 2,

  /**
   * Minimum word length for keyword extraction
   * Words shorter than this are filtered out as insignificant
   */
  MIN_KEYWORD_LENGTH: 2,

  /**
   * Fuse.js configuration
   * These settings control the behavior of the fuzzy search library
   */
  FUSE_CONFIG: {
    /**
     * Whether to ignore location when matching
     * true = match anywhere in the string, not just at the start
     */
    IGNORE_LOCATION: true,

    /**
     * Whether to include match score in results
     */
    INCLUDE_SCORE: true,

    /**
     * Whether to include which keys matched
     */
    INCLUDE_MATCHES: true,
  }
} as const;

/**
 * Helper to convert similarity score to Fuse.js distance threshold
 * Fuse uses distance (lower is better), we use similarity (higher is better)
 * @param similarityThreshold - Similarity score (0-1)
 * @returns Fuse distance threshold
 */
export function toFuseThreshold(similarityThreshold: number): number {
  return 1 - similarityThreshold;
}

