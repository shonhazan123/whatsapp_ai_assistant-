/**
 * SecondBrainVaultService
 *
 * Standalone semantic memory vault. Fully isolated from working memory,
 * fact memory, and ConversationWindow.
 *
 * Implements:
 * - insert (embed + store)
 * - hybridSearch (vector + full-text + metadata filter)
 * - deleteById
 * - getById
 * - listByUser
 */

import { query } from '../../legacy/config/database.js';
import { logger } from '../../utils/logger.js';
import { getSecondBrainService } from '../v1-services.js';

// ============================================================================
// TYPES
// ============================================================================

export type MemoryType = 'note' | 'contact' | 'kv';

export interface SecondBrainMemory {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  summary: string | null;
  tags: string[];
  metadata: Record<string, any>;
  created_at: Date;
  embedding?: number[];
}

export interface HybridSearchResult extends SecondBrainMemory {
  similarity: number;
  keyword_score: number;
}

export interface ConflictMatch {
  memory: HybridSearchResult;
  isStrongMatch: boolean;
}

// ============================================================================
// THRESHOLDS
// ============================================================================

const HYBRID_THRESHOLDS = {
  VECTOR_SIMILARITY_MIN: 0.85,
  KEYWORD_SCORE_MIN: 0.01,
  SEARCH_SIMILARITY_MIN: 0.5,
  SEARCH_LIMIT: 10,
} as const;

// ============================================================================
// SERVICE
// ============================================================================

export class SecondBrainVaultService {
  /**
   * Create an embedding via the legacy OpenAI service.
   */
  async embedText(text: string): Promise<number[]> {
    const sbs = getSecondBrainService();
    if (!sbs) throw new Error('SecondBrainService (embedding provider) not available');
    return sbs.embedText(text);
  }

  /**
   * Insert a new memory. Embeds content automatically.
   */
  async insert(
    userPhone: string,
    memory: {
      type: MemoryType;
      content: string;
      summary?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<SecondBrainMemory> {
    const userId = await this.resolveUserId(userPhone);
    const embedding = await this.embedText(memory.content);
    const vectorStr = this.toVectorString(embedding);

    const sql = `
      INSERT INTO second_brain_memories (user_id, type, content, summary, tags, metadata, embedding)
      VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb, $7::vector)
      RETURNING id, user_id, type, content, summary, tags, metadata, created_at
    `;

    const result = await query(sql, [
      userId,
      memory.type,
      memory.content.trim(),
      memory.summary || null,
      memory.tags || [],
      JSON.stringify(memory.metadata || {}),
      vectorStr,
    ]);

    if (!result.rows?.length) throw new Error('Failed to insert memory');

    const row = result.rows[0];
    logger.info(`[SecondBrainVault] Inserted ${memory.type} memory: ${row.id}`);
    return this.rowToMemory(row);
  }

  /**
   * Override = delete existing + insert new (no version history).
   */
  async override(
    userPhone: string,
    existingId: string,
    memory: {
      type: MemoryType;
      content: string;
      summary?: string;
      tags?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<SecondBrainMemory> {
    await this.deleteById(userPhone, existingId);
    return this.insert(userPhone, memory);
  }

  /**
   * Delete a memory by ID.
   */
  async deleteById(userPhone: string, memoryId: string): Promise<boolean> {
    const userId = await this.resolveUserId(userPhone);
    const result = await query(
      'DELETE FROM second_brain_memories WHERE id = $1 AND user_id = $2',
      [memoryId, userId]
    );
    const deleted = (result.rowCount || 0) > 0;
    if (deleted) logger.info(`[SecondBrainVault] Deleted memory: ${memoryId}`);
    return deleted;
  }

  /**
   * Get a single memory by ID.
   */
  async getById(userPhone: string, memoryId: string): Promise<SecondBrainMemory | null> {
    const userId = await this.resolveUserId(userPhone);
    const result = await query(
      `SELECT id, user_id, type, content, summary, tags, metadata, created_at
       FROM second_brain_memories WHERE id = $1 AND user_id = $2`,
      [memoryId, userId]
    );
    if (!result.rows?.length) return null;
    return this.rowToMemory(result.rows[0]);
  }

  /**
   * List memories for a user, optionally filtered by type.
   */
  async list(
    userPhone: string,
    opts?: { type?: MemoryType; limit?: number; offset?: number }
  ): Promise<SecondBrainMemory[]> {
    const userId = await this.resolveUserId(userPhone);
    const limit = opts?.limit || 20;
    const offset = opts?.offset || 0;

    let sql: string;
    let params: any[];
    if (opts?.type) {
      sql = `SELECT id, user_id, type, content, summary, tags, metadata, created_at
             FROM second_brain_memories WHERE user_id = $1 AND type = $2
             ORDER BY created_at DESC LIMIT $3 OFFSET $4`;
      params = [userId, opts.type, limit, offset];
    } else {
      sql = `SELECT id, user_id, type, content, summary, tags, metadata, created_at
             FROM second_brain_memories WHERE user_id = $1
             ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      params = [userId, limit, offset];
    }

    const result = await query(sql, params);
    return result.rows.map((r: any) => this.rowToMemory(r));
  }

  // ==========================================================================
  // HYBRID SEARCH (vector + full-text + metadata filter)
  // ==========================================================================

  /**
   * General-purpose hybrid search (for user "search memory" queries).
   */
  async hybridSearch(
    userPhone: string,
    queryText: string,
    opts?: { type?: MemoryType; limit?: number }
  ): Promise<HybridSearchResult[]> {
    const userId = await this.resolveUserId(userPhone);
    const embedding = await this.embedText(queryText);
    const vectorStr = this.toVectorString(embedding);
    const limit = opts?.limit || HYBRID_THRESHOLDS.SEARCH_LIMIT;

    const typeFilter = opts?.type ? 'AND type = $5' : '';
    const params: any[] = [
      vectorStr,
      userId,
      HYBRID_THRESHOLDS.SEARCH_SIMILARITY_MIN,
      limit,
    ];
    if (opts?.type) params.push(opts.type);

    const sql = `
      SELECT
        id, user_id, type, content, summary, tags, metadata, created_at,
        1 - (embedding <=> $1::vector) AS similarity,
        ts_rank_cd(content_tsv, plainto_tsquery('simple', $6)) AS keyword_score
      FROM second_brain_memories
      WHERE user_id = $2
        AND (1 - (embedding <=> $1::vector)) >= $3
        ${typeFilter}
      ORDER BY
        (1 - (embedding <=> $1::vector)) * 0.7
        + ts_rank_cd(content_tsv, plainto_tsquery('simple', $6)) * 0.3 DESC
      LIMIT $4
    `;

    params.push(queryText);

    const result = await query(sql, params);
    return result.rows.map((r: any) => ({
      ...this.rowToMemory(r),
      similarity: parseFloat(r.similarity) || 0,
      keyword_score: parseFloat(r.keyword_score) || 0,
    }));
  }

  /**
   * Conflict detection for contact/kv types.
   * - contact: strong match = vector similarity >= 0.85 AND keyword overlap (content_tsv).
   * - kv: if opts.subject is provided, uses vector-only search then filters by subject overlap
   *   (so value-only updates like "3 haircuts" -> "4 haircuts" still trigger disambiguation).
   */
  async findConflicts(
    userPhone: string,
    content: string,
    type: 'contact' | 'kv',
    opts?: { subject?: string }
  ): Promise<ConflictMatch[]> {
    const userId = await this.resolveUserId(userPhone);
    const embedding = await this.embedText(content);
    const vectorStr = this.toVectorString(embedding);

    if (type === 'kv' && opts?.subject != null && opts.subject.trim() !== '') {
      return this.findConflictsKvBySubject(userId, vectorStr, opts.subject);
    }

    const sql = `
      SELECT
        id, user_id, type, content, summary, tags, metadata, created_at,
        1 - (embedding <=> $1::vector) AS similarity,
        ts_rank_cd(content_tsv, plainto_tsquery('simple', $5)) AS keyword_score
      FROM second_brain_memories
      WHERE user_id = $2
        AND type = $3
        AND (1 - (embedding <=> $1::vector)) >= $4
        AND content_tsv @@ plainto_tsquery('simple', $5)
      ORDER BY (1 - (embedding <=> $1::vector)) DESC
      LIMIT 3
    `;

    const result = await query(sql, [
      vectorStr,
      userId,
      type,
      HYBRID_THRESHOLDS.VECTOR_SIMILARITY_MIN,
      content,
    ]);

    return result.rows.map((r: any) => {
      const similarity = parseFloat(r.similarity) || 0;
      const keyword_score = parseFloat(r.keyword_score) || 0;
      return {
        memory: {
          ...this.rowToMemory(r),
          similarity,
          keyword_score,
        },
        isStrongMatch:
          similarity >= HYBRID_THRESHOLDS.VECTOR_SIMILARITY_MIN &&
          keyword_score >= HYBRID_THRESHOLDS.KEYWORD_SCORE_MIN,
      };
    });
  }

  /**
   * KV-only: vector similarity search (no keyword condition), then filter by subject overlap.
   * Used so that same-subject value updates (e.g. "3 haircuts" -> "4 haircuts") trigger HITL.
   */
  private async findConflictsKvBySubject(
    userId: string,
    vectorStr: string,
    newSubject: string
  ): Promise<ConflictMatch[]> {
    const sql = `
      SELECT
        id, user_id, type, content, summary, tags, metadata, created_at,
        1 - (embedding <=> $1::vector) AS similarity
      FROM second_brain_memories
      WHERE user_id = $2
        AND type = 'kv'
        AND (1 - (embedding <=> $1::vector)) >= $3
      ORDER BY (1 - (embedding <=> $1::vector)) DESC
      LIMIT 5
    `;

    const result = await query(sql, [
      vectorStr,
      userId,
      HYBRID_THRESHOLDS.VECTOR_SIMILARITY_MIN,
    ]);

    const normalizedNew = this.normalizeSubject(newSubject);

    return result.rows
      .filter((r: any) => {
        const meta = r.metadata != null && typeof r.metadata === 'string'
          ? (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })()
          : (r.metadata || {});
        const existingSubject = meta.subject != null ? String(meta.subject) : '';
        return this.subjectOverlap(normalizedNew, this.normalizeSubject(existingSubject));
      })
      .map((r: any) => {
        const similarity = parseFloat(r.similarity) || 0;
        return {
          memory: {
            ...this.rowToMemory(r),
            similarity,
            keyword_score: 0,
          },
          isStrongMatch: true,
        };
      });
  }

  private normalizeSubject(s: string): string {
    return s.trim().replace(/\s+/g, ' ');
  }

  private subjectOverlap(normalizedNew: string, normalizedExisting: string): boolean {
    if (!normalizedExisting) return false;
    if (normalizedNew === normalizedExisting) return true;
    return normalizedNew.includes(normalizedExisting) || normalizedExisting.includes(normalizedNew);
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private toVectorString(v: number[]): string {
    return '[' + v.join(',') + ']';
  }

  private rowToMemory(row: any): SecondBrainMemory {
    return {
      id: row.id,
      user_id: row.user_id,
      type: row.type as MemoryType,
      content: row.content,
      summary: row.summary || null,
      tags: row.tags || [],
      metadata: row.metadata || {},
      created_at: new Date(row.created_at),
    };
  }

  private async resolveUserId(userPhone: string): Promise<string> {
    const result = await query(
      'SELECT get_or_create_user($1) as user_id',
      [userPhone]
    );
    return result.rows[0]?.user_id || '';
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let _instance: SecondBrainVaultService | null = null;

export function getSecondBrainVaultService(): SecondBrainVaultService {
  if (!_instance) _instance = new SecondBrainVaultService();
  return _instance;
}
