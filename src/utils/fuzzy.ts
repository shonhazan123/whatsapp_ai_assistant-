import Fuse from 'fuse.js';

/**
 * Fuzzy matching utilities for entity resolution
 * Uses Fuse.js for fuzzy string matching
 */

export interface FuzzyMatch<T> {
  item: T;
  score: number; // 0-1, higher is better
  matches?: string[];
}

export class FuzzyMatcher {
  /**
   * Find best matches for a query in a list of items
   * @param query - Search query
   * @param items - Items to search through
   * @param keys - Keys to search in (for objects)
   * @param threshold - Minimum score threshold (0-1)
   */
  static search<T>(
    query: string,
    items: T[],
    keys: string[],
    threshold: number = 0.6
  ): FuzzyMatch<T>[] {
    const fuse = new Fuse(items, {
      keys,
      threshold: 1 - threshold, // Fuse uses distance, we use similarity
      includeScore: true,
      includeMatches: true,
      ignoreLocation: true,
      minMatchCharLength: 2
    });

    const results = fuse.search(query);

    return results
      .map(result => ({
        item: result.item,
        score: 1 - (result.score || 0), // Convert distance to similarity
        matches: result.matches?.map(m => m.key).filter((k): k is string => k !== undefined) || []
      }))
      .filter(match => match.score >= threshold)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Find single best match
   */
  static findBest<T>(
    query: string,
    items: T[],
    keys: string[],
    threshold: number = 0.6
  ): FuzzyMatch<T> | null {
    const matches = this.search(query, items, keys, threshold);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * Levenshtein distance between two strings
   */
  static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate similarity score (0-1) using Levenshtein distance
   */
  static similarity(str1: string, str2: string): number {
    const distance = this.levenshteinDistance(str1.toLowerCase(), str2.toLowerCase());
    const maxLength = Math.max(str1.length, str2.length);
    return maxLength === 0 ? 1 : 1 - distance / maxLength;
  }

  /**
   * Check if two strings are similar enough
   */
  static isSimilar(str1: string, str2: string, threshold: number = 0.6): boolean {
    return this.similarity(str1, str2) >= threshold;
  }

  /**
   * Extract keywords from text for matching
   */
  static extractKeywords(text: string): string[] {
    // Remove common words (Hebrew and English)
    const stopWords = [
      'את', 'ה', 'של', 'ל', 'ב', 'מ', 'על', 'אל', 'כל', 'זה', 'זאת',
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for'
    ];

    return text
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
  }

  /**
   * Score match based on keyword overlap
   */
  static keywordScore(text1: string, text2: string): number {
    const keywords1 = new Set(this.extractKeywords(text1));
    const keywords2 = new Set(this.extractKeywords(text2));

    if (keywords1.size === 0 || keywords2.size === 0) return 0;

    const intersection = new Set([...keywords1].filter(k => keywords2.has(k)));
    const union = new Set([...keywords1, ...keywords2]);

    return intersection.size / union.size;
  }
}

