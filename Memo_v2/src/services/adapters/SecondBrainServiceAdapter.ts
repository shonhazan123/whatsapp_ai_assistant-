/**
 * SecondBrainServiceAdapter
 *
 * Adapter that converts resolver/executor args into SecondBrainVaultService calls.
 * Handles:
 * - storeMemory (insert or override based on conflictDecision)
 * - searchMemory (hybrid search)
 * - deleteMemory
 * - updateMemory
 * - getAllMemory
 * - getMemoryById
 */

import {
  getSecondBrainVaultService,
  type MemoryType,
} from '../second-brain/SecondBrainVaultService.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SecondBrainOperationArgs {
  operation: string;
  memory?: {
    type: MemoryType;
    content: string;
    summary?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  };
  query?: string;
  searchText?: string;
  type?: MemoryType;
  memoryId?: string;
  memoryIds?: string[];
  limit?: number;
  offset?: number;
  conflictDecision?: 'override' | 'insert';
  conflictTargetId?: string;
}

export interface SecondBrainOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ============================================================================
// ADAPTER
// ============================================================================

export class SecondBrainServiceAdapter {
  private userPhone: string;

  constructor(userPhone: string) {
    this.userPhone = userPhone;
  }

  async execute(args: SecondBrainOperationArgs): Promise<SecondBrainOperationResult> {
    const { operation } = args;
    const vault = getSecondBrainVaultService();

    try {
      switch (operation) {
        case 'storeMemory':
          return await this.storeMemory(vault, args);

        case 'searchMemory':
          return await this.searchMemory(vault, args);

        case 'deleteMemory':
          return await this.deleteMemory(vault, args);

        case 'updateMemory':
          return await this.updateMemory(vault, args);

        case 'getAllMemory':
          return await this.getAllMemory(vault, args);

        case 'getMemoryById':
          return await this.getMemoryById(vault, args);

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      console.error(`[SecondBrainServiceAdapter] Error in ${operation}:`, error);
      return { success: false, error: error.message || String(error) };
    }
  }

  // ========================================================================
  // OPERATION IMPLEMENTATIONS
  // ========================================================================

  private async storeMemory(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    if (!args.memory?.content) {
      return { success: false, error: 'Memory content is required for storing' };
    }

    const { memory, conflictDecision, conflictTargetId } = args;

    if (conflictDecision === 'override' && conflictTargetId) {
      const result = await vault.override(this.userPhone, conflictTargetId, {
        type: memory.type,
        content: memory.content,
        summary: memory.summary,
        tags: memory.tags,
        metadata: memory.metadata,
      });
      return { success: true, data: { ...result, overridden: true } };
    }

    const result = await vault.insert(this.userPhone, {
      type: memory.type,
      content: memory.content,
      summary: memory.summary,
      tags: memory.tags,
      metadata: memory.metadata,
    });
    return { success: true, data: result };
  }

  private async searchMemory(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    if (!args.query) {
      return { success: false, error: 'Query is required for searching memory' };
    }

    const results = await vault.hybridSearch(
      this.userPhone,
      args.query,
      { type: args.type, limit: args.limit || 5 }
    );

    return { success: true, data: { results } };
  }

  private async deleteMemory(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    const ids = args.memoryIds || (args.memoryId ? [args.memoryId] : []);
    if (ids.length === 0) {
      return { success: false, error: 'Memory ID is required for deletion' };
    }

    let deleted = 0;
    for (const id of ids) {
      const ok = await vault.deleteById(this.userPhone, id);
      if (ok) deleted++;
    }

    return { success: true, data: { deleted, total: ids.length } };
  }

  private async updateMemory(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    if (!args.memoryId) {
      return { success: false, error: 'Memory ID is required for update' };
    }
    if (!args.memory?.content) {
      return { success: false, error: 'New memory content is required for update' };
    }

    const result = await vault.override(this.userPhone, args.memoryId, {
      type: args.memory.type,
      content: args.memory.content,
      summary: args.memory.summary,
      tags: args.memory.tags,
      metadata: args.memory.metadata,
    });

    return { success: true, data: result };
  }

  private async getAllMemory(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    const results = await vault.list(this.userPhone, {
      type: args.type,
      limit: args.limit || 20,
      offset: args.offset || 0,
    });

    return { success: true, data: { memories: results } };
  }

  private async getMemoryById(
    vault: ReturnType<typeof getSecondBrainVaultService>,
    args: SecondBrainOperationArgs
  ): Promise<SecondBrainOperationResult> {
    if (!args.memoryId) {
      return { success: false, error: 'Memory ID is required' };
    }

    const result = await vault.getById(this.userPhone, args.memoryId);
    if (!result) {
      return { success: false, error: 'Memory not found' };
    }

    return { success: true, data: result };
  }
}
