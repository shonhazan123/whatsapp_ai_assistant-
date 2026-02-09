/**
 * SecondBrainServiceAdapter
 * 
 * Adapter for V1 SecondBrainService.
 * Converts resolver args (secondBrainOperations) into SecondBrainService method calls.
 */

import { getSecondBrainService } from '../v1-services.js';

export interface SecondBrainOperationArgs {
  operation: string;
  memoryId?: string;
  text?: string;
  query?: string;
  limit?: number;
  metadata?: {
    tags?: string[];
    source?: string;
    context?: string;
    category?: string;
  };
  language?: 'he' | 'en';
}

export interface SecondBrainOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class SecondBrainServiceAdapter {
  private userPhone: string;
  
  constructor(userPhone: string) {
    this.userPhone = userPhone;
  }
  
  /**
   * Execute a second brain operation
   */
  async execute(args: SecondBrainOperationArgs): Promise<SecondBrainOperationResult> {
    const { operation } = args;
    const secondBrainService = getSecondBrainService();
    
    if (!secondBrainService) {
      return { success: false, error: 'SecondBrainService not available' };
    }
    
    try {
      switch (operation) {
        case 'storeMemory':
          return await this.storeMemory(secondBrainService, args);
          
        case 'searchMemory':
          return await this.searchMemory(secondBrainService, args);
          
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
  
  private async storeMemory(secondBrainService: any, args: SecondBrainOperationArgs): Promise<SecondBrainOperationResult> {
    if (!args.text) {
      return { success: false, error: 'Text is required for storing memory' };
    }
    
    try {
      // First create embedding for the text
      const embedding = await secondBrainService.embedText(args.text);
      
      // Then store with insertOrMerge
      const result = await secondBrainService.insertOrMergeMemory(
        this.userPhone,
        args.text,
        embedding,
        {
          ...args.metadata,
          language: this.isHebrew(args.text) ? 'hebrew' : 'english',
        }
      );
      
      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to store memory',
      };
    }
  }
  
  private async searchMemory(secondBrainService: any, args: SecondBrainOperationArgs): Promise<SecondBrainOperationResult> {
    if (!args.query) {
      return { success: false, error: 'Query is required for searching memory' };
    }
    
    try {
      const results = await secondBrainService.searchMemory(
        this.userPhone,
        args.query,
        args.limit || 5
      );
      
      return {
        success: true,
        data: results,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to search memory',
      };
    }
  }
  
  /**
   * Detect if text is Hebrew
   */
  private isHebrew(text: string): boolean {
    return /[\u0590-\u05FF]/.test(text);
  }
}
