/**
 * BaseNode - Abstract base class for all LangGraph nodes
 * 
 * Provides common functionality:
 * - Execution timing
 * - Error handling
 * - Metadata tracking
 * 
 * IMPORTANT: Does NOT catch GraphInterrupt - that's intentional control flow
 */

import { GraphInterrupt } from '@langchain/langgraph';
import type { MetadataDelta, MemoState } from '../state/MemoState.js';

export interface NodeExecutionResult<T = Partial<MemoState>> {
  output: T;
  durationMs: number;
  error?: string;
}

export abstract class BaseNode {
  abstract readonly name: string;
  
  /**
   * Main execution method - override in subclasses
   */
  protected abstract process(state: MemoState): Promise<Partial<MemoState>>;
  
  /**
   * Optional validation before execution
   */
  protected validate(state: MemoState): { valid: boolean; reason?: string } {
    return { valid: true };
  }
  
  /**
   * Execute the node with timing and error handling
   */
  async execute(state: MemoState): Promise<Partial<MemoState>> {
    const startTime = Date.now();
    
    try {
      // Validate
      const validation = this.validate(state);
      if (!validation.valid) {
        return {
          error: `Validation failed in ${this.name}: ${validation.reason}`,
        };
      }
      
      // Process
      const result = await this.process(state);
      
      const endTime = Date.now();
      
      const delta: MetadataDelta = {
        nodeExecutions: [
          { node: this.name, startTime, endTime, durationMs: endTime - startTime },
        ],
      };
      
      return { ...result, metadata: delta as any };
    } catch (error) {
      // CRITICAL: Re-throw GraphInterrupt - it's not an error, it's intentional HITL control flow
      // LangGraph needs to catch this to pause the graph and persist state
      if (error instanceof GraphInterrupt) {
        throw error;
      }
      
      const endTime = Date.now();
      console.error(`[${this.name}] Error:`, error);
      
      const delta: MetadataDelta = {
        nodeExecutions: [
          { node: this.name, startTime, endTime, durationMs: endTime - startTime },
        ],
      };
      
      return {
        error: `Error in ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        metadata: delta as any,
      };
    }
  }
  
  /**
   * Create a function compatible with LangGraph node registration
   */
  asNodeFunction(): (state: MemoState) => Promise<Partial<MemoState>> {
    return (state: MemoState) => this.execute(state);
  }
}

/**
 * CodeNode - For nodes that don't use LLM
 * Pure code execution, no AI calls
 */
export abstract class CodeNode extends BaseNode {
  readonly usesLLM = false;
}

/**
 * LLMNode - For nodes that use LLM
 * Tracks token usage and costs
 */
export abstract class LLMNode extends BaseNode {
  readonly usesLLM = true;
}

