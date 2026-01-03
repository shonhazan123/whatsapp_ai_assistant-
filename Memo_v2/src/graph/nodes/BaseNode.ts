/**
 * BaseNode - Abstract base class for all LangGraph nodes
 * 
 * Provides common functionality:
 * - Execution timing
 * - Error handling
 * - Metadata tracking
 */

import type { MemoState } from '../state/MemoState.js';

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
      
      // Add execution metadata
      const endTime = Date.now();
      const durationMs = endTime - startTime;
      
      return {
        ...result,
        metadata: {
          ...state.metadata,
          nodeExecutions: [
            ...state.metadata.nodeExecutions,
            {
              node: this.name,
              startTime,
              endTime,
              durationMs,
            },
          ],
        },
      };
    } catch (error) {
      const endTime = Date.now();
      console.error(`[${this.name}] Error:`, error);
      
      return {
        error: `Error in ${this.name}: ${error instanceof Error ? error.message : String(error)}`,
        metadata: {
          ...state.metadata,
          nodeExecutions: [
            ...state.metadata.nodeExecutions,
            {
              node: this.name,
              startTime,
              endTime,
              durationMs: endTime - startTime,
            },
          ],
        },
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
  
  /**
   * Track LLM call in metadata
   */
  protected trackLLMCall(
    state: MemoState,
    tokens: { input: number; output: number; cached?: number },
    cost: number
  ): Partial<MemoState['metadata']> {
    return {
      llmCalls: state.metadata.llmCalls + 1,
      totalTokens: state.metadata.totalTokens + tokens.input + tokens.output,
      totalCost: state.metadata.totalCost + cost,
    };
  }
}

