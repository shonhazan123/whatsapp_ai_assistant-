/**
 * SecondBrain Resolver
 * 
 * Converts memory-related PlanSteps into secondBrain operation arguments.
 * 
 * Uses its OWN LLM call with domain-specific prompts to:
 * 1. Determine the specific operation (store, search, update, delete)
 * 2. Extract the content to store or search for
 * 
 * Based on V1: src/agents/functions/SecondBrainFunction.ts
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// SECOND BRAIN RESOLVER
// ============================================================================

/**
 * SecondBrainResolver - Memory/knowledge operations
 * 
 * Uses LLM to determine operation and extract content.
 */
export class SecondBrainResolver extends LLMResolver {
  readonly name = 'secondbrain_resolver';
  readonly capability: Capability = 'second-brain';
  readonly actions = [
    'memory_operation',  // Generic - LLM will determine specific operation
    'store_memory',
    'search_memory',
    'update_memory',
    'delete_memory',
    'list_memories',
    'get_memory',
  ];
  
  getSystemPrompt(): string {
    return `YOU ARE A KNOWLEDGE MANAGEMENT ASSISTANT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into memory operation parameters.
You handle storing facts, notes, personal knowledge, and retrieving saved information.

## OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to SAVE/REMEMBER something → "storeMemory"
- User says "תזכור ש..."/"remember that..." → "storeMemory"
- User says "שמור ש..."/"save that..." → "storeMemory"
- User asks "מה אמרתי על..."/"what did I say about..." → "searchMemory"
- User asks "מה שמרתי..."/"what did I save..." → "searchMemory" or "getAllMemory"
- User wants to FIND saved info → "searchMemory"
- User wants to UPDATE saved info → "updateMemory"
- User wants to DELETE saved info → "deleteMemory"
- User wants to SEE ALL saved info → "getAllMemory"

## AVAILABLE OPERATIONS:
- **storeMemory**: Store a new memory/note/fact
- **searchMemory**: Search memories by semantic similarity
- **updateMemory**: Update an existing memory
- **deleteMemory**: Delete a memory
- **getAllMemory**: List all memories (paginated)
- **getMemoryById**: Get a specific memory

## CRITICAL RULES:

### For Store Operations:
- Extract the KEY INFORMATION the user wants to remember
- Remove filler words like "תזכור ש", "remember that"
- Keep the essential fact/note

### For Search Operations:
- Convert natural language to semantic search query
- Focus on the topic/subject being searched

### Defaults:
- limit: 5 results
- minSimilarity: 0.7

## OUTPUT FORMAT for storeMemory:
{
  "operation": "storeMemory",
  "text": "The information to remember",
  "metadata": {
    "tags": ["tag1", "tag2"],
    "category": "work | personal | health | etc",
    "language": "hebrew | english | other"
  }
}

## OUTPUT FORMAT for searchMemory:
{
  "operation": "searchMemory",
  "query": "What to search for",
  "limit": 5,
  "minSimilarity": 0.7
}

## EXAMPLES:

Example 1 - Store a fact:
User: "תזכור שדני אוהב פיצה"
→ { "operation": "storeMemory", "text": "דני אוהב פיצה", "metadata": { "language": "hebrew", "tags": ["דני", "אוכל"] } }

Example 2 - Store a note:
User: "remember that the project deadline is January 15th"
→ { "operation": "storeMemory", "text": "Project deadline is January 15th", "metadata": { "language": "english", "category": "work", "tags": ["deadline", "project"] } }

Example 3 - Search for info:
User: "מה אמרתי על דני?"
→ { "operation": "searchMemory", "query": "דני", "limit": 5 }

Example 4 - Search for topic:
User: "what did I save about the meeting?"
→ { "operation": "searchMemory", "query": "meeting", "limit": 5 }

Example 5 - List all:
User: "מה שמרתי?"
→ { "operation": "getAllMemory", "limit": 20 }

Example 6 - Store with category:
User: "save that my doctor's name is Dr. Cohen"
→ { "operation": "storeMemory", "text": "My doctor's name is Dr. Cohen", "metadata": { "language": "english", "category": "health", "tags": ["doctor", "medical"] } }

Example 7 - Delete memory:
User: "תמחק את מה ששמרתי על דני"
→ { "operation": "deleteMemory", "searchText": "דני" }

Example 8 - Update memory:
User: "update what I saved about the deadline - it's now January 20th"
→ { "operation": "updateMemory", "searchText": "deadline", "newText": "Project deadline is January 20th" }

Output only the JSON, no explanation.`;
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
          text: { type: 'string', description: 'Memory content to store' },
          query: { type: 'string', description: 'Search query' },
          searchText: { type: 'string', description: 'Text to find memory for update/delete' },
          newText: { type: 'string', description: 'New text for update' },
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
    // Use LLM to extract operation and parameters
    try {
      console.log(`[${this.name}] Calling LLM to extract memory operation`);
      
      const args = await this.callLLM(step, state);
      
      // Validate operation
      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'searchMemory'`);
        args.operation = 'searchMemory';
      }
      
      // Apply defaults for search
      if (args.operation === 'searchMemory') {
        args.limit = args.limit ?? 5;
        args.minSimilarity = args.minSimilarity ?? 0.7;
      }
      
      // Apply defaults for getAll
      if (args.operation === 'getAllMemory') {
        args.limit = args.limit ?? 20;
        args.offset = args.offset ?? 0;
      }
      
      // Auto-detect language for store
      if (args.operation === 'storeMemory') {
        args.metadata = args.metadata || {};
        if (!args.metadata.language) {
          args.metadata.language = state.user.language === 'he' ? 'hebrew' : 'english';
        }
      }
      
      // Mark for resolution if update/delete needs lookup
      if (['updateMemory', 'deleteMemory', 'getMemoryById'].includes(args.operation) && !args.memoryId) {
        args._needsResolution = true;
        args._searchQuery = args.searchText || args.query;
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback: try to infer from keywords
      const message = step.constraints.rawMessage || state.input.message || '';
      
      let operation = 'searchMemory';
      if (/תזכור|זכור|שמור|remember|save|store/i.test(message)) {
        operation = 'storeMemory';
      }
      
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation,
          text: operation === 'storeMemory' ? message : undefined,
          query: operation === 'searchMemory' ? message : undefined,
          metadata: { language: state.user.language === 'he' ? 'hebrew' : 'english' },
          _fallback: true,
        },
      };
    }
  }
  
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
