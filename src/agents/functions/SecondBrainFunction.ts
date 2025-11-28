import { DEFAULT_MIN_SIMILARITY, DEFAULT_SEARCH_LIMIT, FALLBACK_SIMILARITY_THRESHOLDS, MIN_FALLBACK_THRESHOLD } from '../../config/secondBrain';
import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { SecondBrainService } from '../../services/memory/SecondBrainService';
import { logger } from '../../utils/logger';

export class SecondBrainFunction implements IFunction {
  name = 'secondBrainOperations';
  description = 'Handle all second brain memory operations including store, search, update, delete, and retrieve unstructured memories';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['storeMemory', 'searchMemory', 'updateMemory', 'deleteMemory', 'getAllMemory', 'getMemoryById'],
        description: 'The operation to perform on memories'
      },
      text: {
        type: 'string',
        description: 'Memory text content for storeMemory and updateMemory operations'
      },
      query: {
        type: 'string',
        description: 'Search query text for searchMemory operation'
      },
      memoryId: {
        type: 'string',
        description: 'Memory ID for updateMemory, deleteMemory, and getMemoryById operations'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results for searchMemory and getAllMemory operations (default: 5 for search, 20 for getAll)'
      },
      minSimilarity: {
        type: 'number',
        description: `Minimum similarity threshold (0-1) for searchMemory operation (default: ${DEFAULT_MIN_SIMILARITY})`
      },
      offset: {
        type: 'number',
        description: 'Pagination offset for getAllMemory operation (default: 0)'
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata (tags, category, language, etc.) for storeMemory operation',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Array of tags for categorization'
          },
          category: {
            type: 'string',
            description: 'Category name'
          },
          language: {
            type: 'string',
            enum: ['hebrew', 'english', 'other'],
            description: 'Language of the memory'
          }
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private secondBrainService: SecondBrainService,
    private loggerInstance: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      // Log function call details for debugging
      this.loggerInstance.info(`🔧 SecondBrainFunction.execute called`);
      this.loggerInstance.info(`   Operation: ${operation}`);
      this.loggerInstance.info(`   User: ${userId}`);
      this.loggerInstance.debug(`   Parameters: ${JSON.stringify(params, null, 2)}`);

      if (!userId) {
        this.loggerInstance.warn('❌ User ID is missing in SecondBrainFunction.execute');
        return {
          success: false,
          error: 'User ID is required'
        };
      }

      switch (operation) {
        case 'storeMemory':
          return await this.handleStoreMemory(params, userId);

        case 'searchMemory':
          return await this.handleSearchMemory(params, userId);

        case 'updateMemory':
          return await this.handleUpdateMemory(params, userId);

        case 'deleteMemory':
          return await this.handleDeleteMemory(params, userId);

        case 'getAllMemory':
          return await this.handleGetAllMemory(params, userId);

        case 'getMemoryById':
          return await this.handleGetMemoryById(params, userId);

        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`
          };
      }
    } catch (error) {
      this.loggerInstance.error('Error in SecondBrainFunction:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute memory operation'
      };
    }
  }

  private async handleStoreMemory(params: any, userId: string): Promise<IResponse> {
    try {
      this.loggerInstance.info(`📝 [storeMemory] Storing memory for user: ${userId}`);
      this.loggerInstance.debug(`   Text length: ${params.text?.length || 0} chars`);
      this.loggerInstance.debug(`   Metadata: ${JSON.stringify(params.metadata || {})}`);
      
      if (!params.text || typeof params.text !== 'string' || params.text.trim().length === 0) {
        this.loggerInstance.warn('❌ [storeMemory] Missing or empty text parameter');
        return {
          success: false,
          error: 'Memory text is required for storeMemory operation'
        };
      }

      // Generate embedding first (required for insertOrMergeMemory)
      this.loggerInstance.debug(`   Generating embedding for new memory text`);
      const embedding = await this.secondBrainService.embedText(params.text);

      // Use insertOrMergeMemory to check for similar memories and merge if found
      const result = await this.secondBrainService.insertOrMergeMemory(
        userId,
        params.text,
        embedding,
        params.metadata || {}
      );

      if (result.merged) {
        this.loggerInstance.info(`✅ [storeMemory] Memory merged into existing (id: ${result.memory.id})`);
        return {
          success: true,
          data: {
            id: result.memory.id,
            merged: true
          },
          message: 'Memory merged with existing similar memory'
        };
      } else {
        this.loggerInstance.info(`✅ [storeMemory] Memory stored as new (id: ${result.memory.id})`);
        return {
          success: true,
          data: {
            id: result.memory.id,
            merged: false
          },
          message: 'Memory stored successfully'
        };
      }
    } catch (error) {
      this.loggerInstance.error('Error storing memory:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store memory'
      };
    }
  }

  private async handleSearchMemory(params: any, userId: string): Promise<IResponse> {
    try {
      this.loggerInstance.info(`🔍 [searchMemory] Searching memories for user: ${userId}`);
      
      if (!params.query || typeof params.query !== 'string' || params.query.trim().length === 0) {
        this.loggerInstance.warn('❌ [searchMemory] Missing or empty query parameter');
        return {
          success: false,
          error: 'Search query is required for searchMemory operation'
        };
      }

      const limit = params.limit && typeof params.limit === 'number' ? params.limit : DEFAULT_SEARCH_LIMIT;
      let minSimilarity = params.minSimilarity && typeof params.minSimilarity === 'number' 
        ? Math.max(0, Math.min(1, params.minSimilarity)) // Clamp between 0 and 1
        : DEFAULT_MIN_SIMILARITY;

      this.loggerInstance.info(`   Query: "${params.query}"`);
      this.loggerInstance.info(`   Limit: ${limit}`);
      this.loggerInstance.info(`   Initial MinSimilarity: ${minSimilarity}`);
      this.loggerInstance.debug(`   Original user question might have been different - this is the extracted query`);

      // Try search with initial threshold
      let results = await this.secondBrainService.searchMemory(
        userId,
        params.query,
        limit,
        minSimilarity
      );

      // If no results and threshold is >= MIN_FALLBACK_THRESHOLD, try with progressively lower thresholds
      if (results.length === 0 && minSimilarity >= MIN_FALLBACK_THRESHOLD) {
        for (const threshold of FALLBACK_SIMILARITY_THRESHOLDS) {
          if (threshold >= minSimilarity) continue; // Skip if threshold is higher than initial
          
          this.loggerInstance.info(`   ⚠️ No results with threshold ${minSimilarity}, trying with ${threshold}...`);
          results = await this.secondBrainService.searchMemory(
            userId,
            params.query,
            limit,
            threshold
          );
          
          if (results.length > 0) {
            this.loggerInstance.info(`   ✅ Found ${results.length} results with threshold ${threshold}`);
            minSimilarity = threshold; // Update to reflect the threshold that worked
            break;
          }
        }
      }

      this.loggerInstance.info(`✅ [searchMemory] Search completed: ${results.length} results found (final threshold: ${minSimilarity})`);
      if (results.length > 0) {
        this.loggerInstance.debug(`   Top result similarity: ${results[0].similarity?.toFixed(3) || 'N/A'}`);
        results.forEach((r: any, i: number) => {
          this.loggerInstance.debug(`   Result ${i + 1}: similarity=${r.similarity?.toFixed(4)}, id=${r.id}, text="${r.text?.substring(0, 80)}${r.text?.length > 80 ? '...' : ''}"`);
        });
      } else {
        this.loggerInstance.warn(`⚠️ [searchMemory] No results found even with threshold as low as 0.1. Query might need different key terms.`);
      }

      return {
        success: true,
        data: {
          results,
          count: results.length,
          query: params.query,
          thresholdUsed: minSimilarity
        },
        message: `Found ${results.length} matching memories`
      };
    } catch (error) {
      this.loggerInstance.error('Error searching memories:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search memories'
      };
    }
  }

  private async handleUpdateMemory(params: any, userId: string): Promise<IResponse> {
    try {
      this.loggerInstance.info(`✏️ [updateMemory] Updating memory for user: ${userId}`);
      this.loggerInstance.debug(`   MemoryId: ${params.memoryId}`);
      this.loggerInstance.debug(`   New text length: ${params.text?.length || 0} chars`);
      
      if (!params.memoryId || typeof params.memoryId !== 'string') {
        this.loggerInstance.warn('❌ [updateMemory] Missing memoryId parameter');
        return {
          success: false,
          error: 'Memory ID is required for updateMemory operation'
        };
      }

      if (!params.text || typeof params.text !== 'string' || params.text.trim().length === 0) {
        this.loggerInstance.warn('❌ [updateMemory] Missing or empty text parameter');
        return {
          success: false,
          error: 'Memory text is required for updateMemory operation'
        };
      }

      const memory = await this.secondBrainService.updateMemory(
        params.memoryId,
        userId,
        params.text
      );

      this.loggerInstance.info(`✅ [updateMemory] Memory updated successfully (id: ${memory.id})`);
      
      return {
        success: true,
        data: memory,
        message: 'Memory updated successfully'
      };
    } catch (error) {
      this.loggerInstance.error('Error updating memory:', error);
      
      // Handle specific error cases
      if (error instanceof Error && error.message.includes('not found')) {
        return {
          success: false,
          error: 'Memory not found or access denied'
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update memory'
      };
    }
  }

  private async handleDeleteMemory(params: any, userId: string): Promise<IResponse> {
    try {
      this.loggerInstance.info(`🗑️ [deleteMemory] Deleting memory for user: ${userId}`);
      this.loggerInstance.debug(`   MemoryId: ${params.memoryId}`);
      
      if (!params.memoryId || typeof params.memoryId !== 'string') {
        this.loggerInstance.warn('❌ [deleteMemory] Missing memoryId parameter');
        return {
          success: false,
          error: 'Memory ID is required for deleteMemory operation'
        };
      }

      const deleted = await this.secondBrainService.deleteMemory(
        params.memoryId,
        userId
      );

      if (!deleted) {
        this.loggerInstance.warn(`⚠️ [deleteMemory] Memory not found or access denied (id: ${params.memoryId})`);
        return {
          success: false,
          error: 'Memory not found or access denied'
        };
      }

      this.loggerInstance.info(`✅ [deleteMemory] Memory deleted successfully (id: ${params.memoryId})`);
      
      return {
        success: true,
        data: { id: params.memoryId },
        message: 'Memory deleted successfully'
      };
    } catch (error) {
      this.loggerInstance.error('Error deleting memory:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete memory'
      };
    }
  }

  private async handleGetAllMemory(params: any, userId: string): Promise<IResponse> {
    try {
      this.loggerInstance.info(`📋 [getAllMemory] Retrieving all memories for user: ${userId}`);
      
      const limit = params.limit && typeof params.limit === 'number' ? params.limit : 20;
      const offset = params.offset && typeof params.offset === 'number' ? params.offset : 0;

      this.loggerInstance.debug(`   Limit: ${limit}, Offset: ${offset}`);

      const memories = await this.secondBrainService.getAllMemory(
        userId,
        limit,
        offset
      );

      const totalCount = await this.secondBrainService.getMemoryCount(userId);

      this.loggerInstance.info(`✅ [getAllMemory] Retrieved ${memories.length} memories (total: ${totalCount})`);

      return {
        success: true,
        data: {
          memories,
          count: memories.length,
          total: totalCount,
          limit,
          offset
        },
        message: `Retrieved ${memories.length} memories`
      };
    } catch (error) {
      this.loggerInstance.error('Error getting all memories:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve memories'
      };
    }
  }

  private async handleGetMemoryById(params: any, userId: string): Promise<IResponse> {
    try {
      if (!params.memoryId || typeof params.memoryId !== 'string') {
        return {
          success: false,
          error: 'Memory ID is required for getMemoryById operation'
        };
      }

      const memory = await this.secondBrainService.getMemoryById(
        params.memoryId,
        userId
      );

      if (!memory) {
        return {
          success: false,
          error: 'Memory not found or access denied'
        };
      }

      return {
        success: true,
        data: memory,
        message: 'Memory retrieved successfully'
      };
    } catch (error) {
      this.loggerInstance.error('Error getting memory by ID:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to retrieve memory'
      };
    }
  }
}

