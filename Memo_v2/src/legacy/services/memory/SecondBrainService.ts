import { query } from '../../config/database';
import { DEFAULT_MERGE_THRESHOLD, DEFAULT_MIN_SIMILARITY } from '../../config/secondBrain';
import { RequestContext } from '../../core/context/RequestContext';
import { MemoryMetadata, MemoryRecord, SearchResult } from '../../types/memory';
import { logger } from '../../utils/logger';
import { OpenAIService } from '../ai/OpenAIService';
import { BaseService } from '../database/BaseService';

export class SecondBrainService extends BaseService {
  private openaiService: OpenAIService;

  constructor(loggerInstance: any = logger) {
    super(loggerInstance);
    this.openaiService = new OpenAIService(loggerInstance);
  }

  /**
   * Convert JavaScript array to pgvector format string
   * @param vector Array of numbers
   * @returns String in format '[0.1,0.2,...]' for pgvector
   */
  private arrayToVectorString(vector: number[]): string {
    return '[' + vector.join(',') + ']';
  }

  /**
   * Convert pgvector string to JavaScript array
   * @param vectorString String in format '[0.1,0.2,...]' from pgvector
   * @returns Array of numbers
   */
  private vectorStringToArray(vectorString: string): number[] {
    try {
      // Handle different possible formats from pgvector
      let cleaned = String(vectorString).trim();
      
      // Remove brackets if present
      if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
        cleaned = cleaned.slice(1, -1);
      }
      
      // Split by comma and parse
      const parts = cleaned.split(',');
      const result = parts.map(part => {
        const num = parseFloat(part.trim());
        if (isNaN(num)) {
          throw new Error(`Invalid number in vector: "${part}"`);
        }
        return num;
      });
      
      return result;
    } catch (error) {
      this.logger.error(`[vectorStringToArray] Error parsing vector string: ${vectorString.substring(0, 100)}`, error);
      throw new Error(`Failed to parse vector string: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate element-wise average of two vectors
   * @param v1 First vector
   * @param v2 Second vector
   * @returns Average vector
   */
  private averageVectors(v1: number[], v2: number[]): number[] {
    if (v1.length !== v2.length) {
      throw new Error('Vectors must have the same length');
    }
    return v1.map((val, i) => (val + v2[i]) / 2);
  }

  /**
   * Create embedding for text using OpenAI
   * @param text Text to embed
   * @returns 1536-dimensional embedding vector
   */
  async embedText(text: string, requestId?: string): Promise<number[]> {
    try {
      // Get requestId from context if not provided
      if (!requestId) {
        const requestContext = RequestContext.get();
        requestId = requestContext?.performanceRequestId;
      }
      
      this.logger.info('Creating embedding for text');
      const embedding = await this.openaiService.createEmbedding(text, 'text-embedding-3-small', requestId, 'second-brain');
      return embedding;
    } catch (error) {
      this.logger.error('Error in embedText:', error);
      throw error;
    }
  }

  /**
   * Insert or merge a new memory into the database
   * If a similar memory exists (similarity >= 0.70), merge into it instead of creating new row
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @param newText New memory text content
   * @param embedding Pre-computed embedding vector (must be provided, 1536 dimensions)
   * @param metadata Optional metadata (tags, category, language, etc.)
   * @returns Object with memory record and merge status
   */
  async insertOrMergeMemory(
    userIdOrPhone: string,
    newText: string,
    embedding: number[],
    metadata: MemoryMetadata = {}
  ): Promise<{ memory: MemoryRecord; merged: boolean }> {
    try {
      if (!newText || newText.trim().length === 0) {
        throw new Error('Memory text cannot be empty');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      if (!embedding || embedding.length !== 1536) {
        throw new Error('Embedding must be provided and have 1536 dimensions');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      // Search for most similar existing memory
      const queryVectorString = this.arrayToVectorString(embedding);
      const mergeThreshold = DEFAULT_MERGE_THRESHOLD;

      this.logger.info(`[insertOrMergeMemory] Searching for similar memories (threshold: ${mergeThreshold})`);

      const searchSql = `
        SELECT 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at,
          1 - (embedding <=> $1::vector) AS similarity
        FROM second_brain_memory
        WHERE user_id = $2
          AND (1 - (embedding <=> $1::vector)) >= $3
        ORDER BY embedding <=> $1::vector
        LIMIT 1
      `;

      const searchResult = await query(searchSql, [
        queryVectorString,
        userId,
        mergeThreshold,
      ]);

      // If similar memory found, merge into it
      if (searchResult.rows && searchResult.rows.length > 0) {
        const existingRow = searchResult.rows[0];
        const similarity = parseFloat(existingRow.similarity) || 0;

        this.logger.info(`[insertOrMergeMemory] Found similar memory (id: ${existingRow.id}, similarity: ${similarity.toFixed(4)}) - merging`);

        // Convert existing embedding from vector string to array
        // pgvector returns embedding as a string representation like '[0.1,0.2,...]'
        const existingEmbeddingString = String(existingRow.embedding || '[]');
        this.logger.debug(`[insertOrMergeMemory] Existing embedding string length: ${existingEmbeddingString.length}, first 100 chars: ${existingEmbeddingString.substring(0, 100)}`);
        
        let existingEmbedding: number[];
        try {
          existingEmbedding = this.vectorStringToArray(existingEmbeddingString);
          this.logger.debug(`[insertOrMergeMemory] Parsed existing embedding: ${existingEmbedding.length} dimensions`);
        } catch (error) {
          this.logger.error(`[insertOrMergeMemory] Failed to parse existing embedding, using new embedding only`, error);
          // Fallback: use new embedding only
          existingEmbedding = embedding;
        }
        
        if (existingEmbedding.length !== 1536) {
          this.logger.warn(`[insertOrMergeMemory] Existing embedding has unexpected length: ${existingEmbedding.length}, expected 1536. Using new embedding only.`);
          // Fallback: use new embedding only if existing is malformed
          const finalEmbedding = embedding;
          const finalVectorString = this.arrayToVectorString(finalEmbedding);
          
          // Merge text
          const mergedText = `${existingRow.text}\n- ${newText.trim()}`;
          
          // Detect language
          const detectedLanguage = metadata.language || this.detectLanguage(newText);
          const mergedMetadata: MemoryMetadata = {
            ...(existingRow.metadata || {}),
            ...metadata,
            language: detectedLanguage,
          };
          
          // Update with new embedding only
          const updateSql = `
            UPDATE second_brain_memory
            SET 
              text = $1,
              embedding = $2::vector,
              metadata = $3::jsonb,
              updated_at = NOW()
            WHERE id = $4 AND user_id = $5
            RETURNING 
              id,
              user_id,
              text,
              embedding,
              metadata,
              created_at,
              updated_at
          `;
          
          const updateResult = await query(updateSql, [
            mergedText,
            finalVectorString,
            JSON.stringify(mergedMetadata),
            existingRow.id,
            userId,
          ]);
          
          if (!updateResult.rows || updateResult.rows.length === 0) {
            throw new Error('Failed to update merged memory');
          }
          
          const updatedRow = updateResult.rows[0];
          const memory: MemoryRecord = {
            id: updatedRow.id,
            user_id: updatedRow.user_id,
            text: updatedRow.text,
            embedding: finalEmbedding,
            metadata: updatedRow.metadata || {},
            created_at: new Date(updatedRow.created_at),
            updated_at: new Date(updatedRow.updated_at),
          };
          
          this.logger.info(`[insertOrMergeMemory] Memory merged successfully (id: ${memory.id}, used new embedding only)`);
          return { memory, merged: true };
        }

        // Merge text: existing + new
        const mergedText = `${existingRow.text}\n- ${newText.trim()}`;

        // Average the embeddings
        const averagedEmbedding = this.averageVectors(existingEmbedding, embedding);
        const averagedVectorString = this.arrayToVectorString(averagedEmbedding);

        // Detect language if not provided
        const detectedLanguage = metadata.language || this.detectLanguage(newText);
        const mergedMetadata: MemoryMetadata = {
          ...(existingRow.metadata || {}),
          ...metadata,
          language: detectedLanguage, // Use new text's language if different
        };

        // Update existing row
        const updateSql = `
          UPDATE second_brain_memory
          SET 
            text = $1,
            embedding = $2::vector,
            metadata = $3::jsonb,
            updated_at = NOW()
          WHERE id = $4 AND user_id = $5
          RETURNING 
            id,
            user_id,
            text,
            embedding,
            metadata,
            created_at,
            updated_at
        `;

        const updateResult = await query(updateSql, [
          mergedText,
          averagedVectorString,
          JSON.stringify(mergedMetadata),
          existingRow.id,
          userId,
        ]);

        if (!updateResult.rows || updateResult.rows.length === 0) {
          throw new Error('Failed to update merged memory');
        }

        const updatedRow = updateResult.rows[0];
        const memory: MemoryRecord = {
          id: updatedRow.id,
          user_id: updatedRow.user_id,
          text: updatedRow.text,
          embedding: averagedEmbedding,
          metadata: updatedRow.metadata || {},
          created_at: new Date(updatedRow.created_at),
          updated_at: new Date(updatedRow.updated_at),
        };

        this.logger.info(`[insertOrMergeMemory] Memory merged successfully (id: ${memory.id})`);
        return { memory, merged: true };
      }

      // No similar memory found, insert new row
      this.logger.info(`[insertOrMergeMemory] No similar memory found - creating new row`);

      // Detect language if not provided
      const detectedLanguage = metadata.language || this.detectLanguage(newText);
      const finalMetadata: MemoryMetadata = {
        ...metadata,
        language: detectedLanguage,
      };

      const vectorString = this.arrayToVectorString(embedding);

      const insertSql = `
        INSERT INTO second_brain_memory (user_id, text, embedding, metadata)
        VALUES ($1, $2, $3::vector, $4::jsonb)
        RETURNING 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at
      `;

      const insertResult = await query(insertSql, [
        userId,
        newText.trim(),
        vectorString,
        JSON.stringify(finalMetadata),
      ]);

      if (!insertResult.rows || insertResult.rows.length === 0) {
        throw new Error('Failed to insert memory');
      }

      const row = insertResult.rows[0];
      const memory: MemoryRecord = {
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: embedding, // Return the original embedding
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };

      this.logger.info(`[insertOrMergeMemory] Memory inserted successfully (id: ${memory.id})`);
      return { memory, merged: false };
    } catch (error) {
      this.logger.error('Error in insertOrMergeMemory:', error);
      throw error;
    }
  }

  /**
   * Insert a new memory into the database
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @param text Memory text content
   * @param embedding Pre-computed embedding vector (optional, will be generated if not provided)
   * @param metadata Optional metadata (tags, category, language, etc.)
   * @returns Created memory record
   */
  async insertMemory(
    userIdOrPhone: string,
    text: string,
    embedding?: number[],
    metadata: MemoryMetadata = {}
  ): Promise<MemoryRecord> {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Memory text cannot be empty');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      // Generate embedding if not provided
      let finalEmbedding: number[];
      if (embedding && embedding.length === 1536) {
        finalEmbedding = embedding;
      } else {
        this.logger.info('Generating embedding for new memory');
        const requestContext = RequestContext.get();
        const requestId = requestContext?.performanceRequestId;
        finalEmbedding = await this.embedText(text, requestId);
      }

      // Detect language if not provided
      const detectedLanguage = metadata.language || this.detectLanguage(text);
      const finalMetadata: MemoryMetadata = {
        ...metadata,
        language: detectedLanguage,
      };

      // Convert embedding array to pgvector format
      const vectorString = this.arrayToVectorString(finalEmbedding);

      // Insert into database
      const sql = `
        INSERT INTO second_brain_memory (user_id, text, embedding, metadata)
        VALUES ($1, $2, $3::vector, $4::jsonb)
        RETURNING 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at
      `;

      const result = await query(sql, [
        userId,
        text.trim(),
        vectorString,
        JSON.stringify(finalMetadata),
      ]);

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Failed to insert memory');
      }

      const row = result.rows[0];
      const memory: MemoryRecord = {
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: finalEmbedding, // Return the array, not the database vector
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };

      this.logger.info(`Memory inserted successfully (id: ${memory.id})`);
      return memory;
    } catch (error) {
      this.logger.error('Error inserting memory:', error);
      throw error;
    }
  }

  /**
   * Search memories by semantic similarity
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @param queryText Search query text
   * @param limit Maximum number of results (default: 5)
   * @param minSimilarity Minimum similarity threshold (0-1, default: from config/secondBrain.ts)
   * @returns Array of search results with similarity scores
   */
  async searchMemory(
    userIdOrPhone: string,
    queryText: string,
    limit: number = 5,
    minSimilarity: number = DEFAULT_MIN_SIMILARITY
  ): Promise<SearchResult[]> {
    try {
      if (!queryText || queryText.trim().length === 0) {
        throw new Error('Search query cannot be empty');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);
      this.logger.debug(`[searchMemory] Resolved user identifier: ${userIdOrPhone} → ${userId}`);

      if (minSimilarity < 0 || minSimilarity > 1) {
        throw new Error('minSimilarity must be between 0 and 1');
      }

      // Generate embedding for query
      this.logger.info(`[searchMemory] Generating embedding for query: "${queryText.substring(0, 100)}${queryText.length > 100 ? '...' : ''}"`);
      const requestContext = RequestContext.get();
      const requestId = requestContext?.performanceRequestId;
      const queryEmbedding = await this.embedText(queryText, requestId);
      const queryVectorString = this.arrayToVectorString(queryEmbedding);
      this.logger.debug(`[searchMemory] Query embedding generated (${queryEmbedding.length} dimensions)`);

      // Perform similarity search using pgvector
      // <=> is cosine distance operator in pgvector
      // 1 - distance = similarity score
      const sql = `
        SELECT 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at,
          1 - (embedding <=> $1::vector) AS similarity
        FROM second_brain_memory
        WHERE user_id = $2
          AND (1 - (embedding <=> $1::vector)) >= $3
        ORDER BY embedding <=> $1::vector
        LIMIT $4
      `;

      this.logger.debug(`[searchMemory] Executing similarity search with:`);
      this.logger.debug(`   userId: ${userId}`);
      this.logger.debug(`   minSimilarity: ${minSimilarity}`);
      this.logger.debug(`   limit: ${limit}`);
      
      const result = await query(sql, [
        queryVectorString,
        userId,
        minSimilarity,
        limit,
      ]);

      this.logger.debug(`[searchMemory] Database query returned ${result.rows.length} rows`);

      const searchResults: SearchResult[] = result.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: [], // Don't return full embedding in search results
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
        similarity: parseFloat(row.similarity) || 0,
      }));

      // Log detailed results for debugging
      if (searchResults.length > 0) {
        this.logger.info(`[searchMemory] Search completed: ${searchResults.length} results found`);
        searchResults.forEach((result, index) => {
          this.logger.debug(`   Result ${index + 1}: similarity=${result.similarity.toFixed(4)}, id=${result.id}, text="${result.text.substring(0, 80)}${result.text.length > 80 ? '...' : ''}"`);
        });
      } else {
        this.logger.warn(`[searchMemory] No results found with similarity >= ${minSimilarity}`);
        this.logger.debug(`   Query: "${queryText}"`);
        this.logger.debug(`   Suggestion: Try lowering minSimilarity threshold or using different key terms`);
      }
      
      return searchResults;
    } catch (error) {
      this.logger.error('Error searching memories:', error);
      throw error;
    }
  }

  /**
   * Get memory by ID
   * @param memoryId Memory ID
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @returns Memory record or null if not found
   */
  async getMemoryById(memoryId: string, userIdOrPhone: string): Promise<MemoryRecord | null> {
    try {
      if (!memoryId) {
        throw new Error('Memory ID is required');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      const sql = `
        SELECT 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at
        FROM second_brain_memory
        WHERE id = $1 AND user_id = $2
      `;

      const result = await query(sql, [memoryId, userId]);

      if (!result.rows || result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      // Note: embedding from database is a vector type, we'll return empty array
      // since we don't need the full embedding for retrieval
      const memory: MemoryRecord = {
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: [], // Don't return full embedding
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };

      return memory;
    } catch (error) {
      this.logger.error('Error getting memory by ID:', error);
      throw error;
    }
  }

  /**
   * Update existing memory
   * @param memoryId Memory ID
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @param newText New text content
   * @param newEmbedding Optional pre-computed embedding (will be generated if not provided)
   * @returns Updated memory record
   */
  async updateMemory(
    memoryId: string,
    userIdOrPhone: string,
    newText: string,
    newEmbedding?: number[]
  ): Promise<MemoryRecord> {
    try {
      if (!memoryId) {
        throw new Error('Memory ID is required');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      if (!newText || newText.trim().length === 0) {
        throw new Error('Memory text cannot be empty');
      }

      // Verify memory exists and belongs to user
      const existing = await this.getMemoryById(memoryId, userId);
      if (!existing) {
        throw new Error('Memory not found or access denied');
      }

      // Generate embedding if not provided
      let finalEmbedding: number[];
      if (newEmbedding && newEmbedding.length === 1536) {
        finalEmbedding = newEmbedding;
      } else {
        this.logger.info('Generating embedding for updated memory');
        const requestContext = RequestContext.get();
        const requestId = requestContext?.performanceRequestId;
        finalEmbedding = await this.embedText(newText, requestId);
      }

      // Update language in metadata if changed
      const detectedLanguage = this.detectLanguage(newText);
      const updatedMetadata: MemoryMetadata = {
        ...existing.metadata,
        language: detectedLanguage,
      };

      const vectorString = this.arrayToVectorString(finalEmbedding);

      const sql = `
        UPDATE second_brain_memory
        SET 
          text = $1,
          embedding = $2::vector,
          metadata = $3::jsonb,
          updated_at = NOW()
        WHERE id = $4 AND user_id = $5
        RETURNING 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at
      `;

      const result = await query(sql, [
        newText.trim(),
        vectorString,
        JSON.stringify(updatedMetadata),
        memoryId,
        userId,
      ]);

      if (!result.rows || result.rows.length === 0) {
        throw new Error('Failed to update memory');
      }

      const row = result.rows[0];
      const memory: MemoryRecord = {
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: finalEmbedding,
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      };

      this.logger.info(`Memory updated successfully (id: ${memory.id})`);
      return memory;
    } catch (error) {
      this.logger.error('Error updating memory:', error);
      throw error;
    }
  }

  /**
   * Delete memory
   * @param memoryId Memory ID
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @returns true if deleted, false if not found
   */
  async deleteMemory(memoryId: string, userIdOrPhone: string): Promise<boolean> {
    try {
      if (!memoryId) {
        throw new Error('Memory ID is required');
      }

      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      const sql = `
        DELETE FROM second_brain_memory
        WHERE id = $1 AND user_id = $2
      `;

      const result = await query(sql, [memoryId, userId]);

      const deleted = (result.rowCount || 0) > 0;
      if (deleted) {
        this.logger.info(`Memory deleted successfully (id: ${memoryId})`);
      } else {
        this.logger.warn(`Memory not found or access denied (id: ${memoryId})`);
      }

      return deleted;
    } catch (error) {
      this.logger.error('Error deleting memory:', error);
      throw error;
    }
  }

  /**
   * Get all memories for a user (paginated)
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @param limit Maximum number of results (default: 20)
   * @param offset Pagination offset (default: 0)
   * @returns Array of memory records
   */
  async getAllMemory(
    userIdOrPhone: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<MemoryRecord[]> {
    try {
      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      const sql = `
        SELECT 
          id,
          user_id,
          text,
          embedding,
          metadata,
          created_at,
          updated_at
        FROM second_brain_memory
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await query(sql, [userId, limit, offset]);

      const memories: MemoryRecord[] = result.rows.map((row) => ({
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        embedding: [], // Don't return full embedding in list
        metadata: row.metadata || {},
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
      }));

      this.logger.info(`Retrieved ${memories.length} memories for user`);
      return memories;
    } catch (error) {
      this.logger.error('Error getting all memories:', error);
      throw error;
    }
  }

  /**
   * Get memory count for a user
   * @param userIdOrPhone User ID (UUID) or phone number (will be resolved to UUID)
   * @returns Total number of memories
   */
  async getMemoryCount(userIdOrPhone: string): Promise<number> {
    try {
      if (!userIdOrPhone) {
        throw new Error('User identifier is required');
      }

      // Resolve phone number to user UUID if needed
      const userId = await this.resolveUserId(undefined, userIdOrPhone);

      const sql = `
        SELECT COUNT(*) as count
        FROM second_brain_memory
        WHERE user_id = $1
      `;

      const result = await query(sql, [userId]);

      const count = parseInt(result.rows[0]?.count || '0', 10);
      return count;
    } catch (error) {
      this.logger.error('Error getting memory count:', error);
      throw error;
    }
  }

  /**
   * Detect language from text
   * @param text Text to analyze
   * @returns Detected language
   */
  private detectLanguage(text: string): 'hebrew' | 'english' | 'other' {
    const hebrewRegex = /[\u0590-\u05FF]/;
    const englishRegex = /[a-zA-Z]/;

    if (hebrewRegex.test(text)) {
      return 'hebrew';
    }
    if (englishRegex.test(text)) {
      return 'english';
    }
    return 'other';
  }
}

