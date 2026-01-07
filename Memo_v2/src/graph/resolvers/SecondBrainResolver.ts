/**
 * SecondBrain Resolver
 * 
 * Converts memory-related PlanSteps into secondBrain operation arguments.
 * 
 * Based on V1: src/agents/functions/SecondBrainFunction.ts
 */

import { LLMResolver, type ResolverOutput } from './BaseResolver.js';
import type { MemoState } from '../state/MemoState.js';
import type { PlanStep, Capability } from '../../types/index.js';

// ============================================================================
// SECOND BRAIN RESOLVER
// ============================================================================

/**
 * SecondBrainResolver - Memory/knowledge operations
 * 
 * Actions: store_memory, search_memory, update_memory, delete_memory, list_memories
 */
export class SecondBrainResolver extends LLMResolver {
  readonly name = 'secondbrain_resolver';
  readonly capability: Capability = 'second-brain';
  readonly actions = [
    'store_memory',
    'search_memory',
    'update_memory',
    'delete_memory',
    'list_memories',
    'get_memory',
  ];
  
  getSystemPrompt(): string {
    return `You are a knowledge management assistant. Convert user requests into memory operation parameters.

Your job is to output JSON arguments for the secondBrainOperations function.

AVAILABLE OPERATIONS:
- storeMemory: Store a new memory/note
- searchMemory: Search memories by semantic similarity
- updateMemory: Update an existing memory
- deleteMemory: Delete a memory
- getAllMemory: List all memories (paginated)
- getMemoryById: Get a specific memory

OUTPUT FORMAT for storeMemory:
{
  "operation": "storeMemory",
  "text": "The information to remember",
  "metadata": {
    "tags": ["tag1", "tag2"],
    "category": "work | personal | etc",
    "language": "hebrew | english | other"
  }
}

OUTPUT FORMAT for searchMemory:
{
  "operation": "searchMemory",
  "query": "What to search for",
  "limit": 5,
  "minSimilarity": 0.7
}

RULES:
1. For store operations, extract the key information from user's message
2. For search, convert natural language to semantic query
3. Default limit is 5, minSimilarity is 0.7
4. Output only the JSON, no explanation`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'secondBrainOperations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: ['storeMemory', 'searchMemory', 'updateMemory', 'deleteMemory', 'getAllMemory', 'getMemoryById'],
          },
          text: { type: 'string', description: 'Memory content' },
          query: { type: 'string', description: 'Search query' },
          memoryId: { type: 'string', description: 'Memory ID' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
          minSimilarity: { type: 'number', description: 'Min similarity 0-1 (default: 0.7)' },
          offset: { type: 'number', description: 'Pagination offset' },
          metadata: {
            type: 'object',
            properties: {
              tags: { type: 'array', items: { type: 'string' } },
              category: { type: 'string' },
              language: { type: 'string', enum: ['hebrew', 'english', 'other'] },
            },
          },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action, constraints, changes } = step;
    
    // Map semantic action to operation
    const operationMap: Record<string, string> = {
      'store_memory': 'storeMemory',
      'search_memory': 'searchMemory',
      'update_memory': 'updateMemory',
      'delete_memory': 'deleteMemory',
      'list_memories': 'getAllMemory',
      'get_memory': 'getMemoryById',
    };
    
    const operation = operationMap[action] || 'searchMemory';
    
    // Build args based on operation
    const args: Record<string, any> = { operation };
    
    switch (operation) {
      case 'storeMemory':
        args.text = constraints.text;
        if (constraints.metadata) {
          args.metadata = constraints.metadata;
        } else {
          // Auto-detect language from user context
          args.metadata = {
            language: state.user.language === 'he' ? 'hebrew' : 'english',
          };
        }
        if (constraints.tags) args.metadata = { ...args.metadata, tags: constraints.tags };
        if (constraints.category) args.metadata = { ...args.metadata, category: constraints.category };
        break;
        
      case 'searchMemory':
        args.query = constraints.query || constraints.text;
        args.limit = constraints.limit ?? 5;
        args.minSimilarity = constraints.minSimilarity ?? 0.7;
        break;
        
      case 'updateMemory':
        args.memoryId = constraints.memoryId;
        args.text = changes.text || constraints.text;
        if (changes.metadata) args.metadata = changes.metadata;
        break;
        
      case 'deleteMemory':
        args.memoryId = constraints.memoryId;
        break;
        
      case 'getAllMemory':
        args.limit = constraints.limit ?? 20;
        args.offset = constraints.offset ?? 0;
        break;
        
      case 'getMemoryById':
        args.memoryId = constraints.memoryId;
        break;
    }
    
    // Handle disambiguation for update/delete without memoryId
    if (['updateMemory', 'deleteMemory', 'getMemoryById'].includes(operation) && !args.memoryId) {
      if (constraints.searchText || constraints.query) {
        args._needsResolution = true;
        args._searchQuery = constraints.searchText || constraints.query;
      }
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
  }
  
  // Override - uses second-brain domain type
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'second-brain';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createSecondBrainResolver() {
  const resolver = new SecondBrainResolver();
  return resolver.asNodeFunction();
}


