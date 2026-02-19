/**
 * SecondBrain Resolver
 *
 * Converts memory-related PlanSteps into secondBrain operation arguments.
 *
 * Uses its OWN LLM call with a comprehensive domain-specific prompt to:
 * 1. Classify the memory type (note | contact | kv)
 * 2. Extract structured fields per type
 * 3. Determine the specific operation (storeMemory, searchMemory, etc.)
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// SECOND BRAIN RESOLVER
// ============================================================================

export class SecondBrainResolver extends LLMResolver {
  readonly name = 'secondbrain_resolver';
  readonly capability: Capability = 'second-brain';
  readonly actions = [
    'memory_operation',
    'store_memory',
    'search_memory',
    'update_memory',
    'delete_memory',
    'list_memories',
    'get_memory',
  ];

  getSystemPrompt(): string {
    return `YOU ARE A SEMANTIC MEMORY CLASSIFIER AND EXTRACTOR.

## YOUR ROLE
Analyze the user's natural language request and:
1. Determine the OPERATION (store vs search vs delete vs list)
2. If storing: CLASSIFY the memory into exactly one TYPE (note | contact | kv)
3. EXTRACT structured fields based on the type
4. Output a single JSON object following the exact schema below

## MEMORY TYPES — CLASSIFICATION RULES

### Type: "note"
Used for: ideas, brain dumps, meeting summaries, observations, general context, reflections.
Detection signals:
- User wants to REMEMBER or SAVE general information
- No structured key-value pair pattern
- No contact info (name + phone/email)
- Narrative, descriptive, or reflective content
- Default type when content doesn't clearly match contact or kv

### Type: "contact"
Used for: people/business contacts with identifying details.
Detection signals:
- Contains a person or business NAME combined with at least one of:
  - Phone number (any format: 050-xxx, +972-xxx, etc.)
  - Email address (contains @)
  - Role/description (e.g., "HVAC contractor", "dentist", "plumber")
- MUST extract into metadata: name, phone, email, description (all optional except name)

### Type: "kv" (Key-Value)
Used for: factual data points that pair a SUBJECT with a VALUE.
Detection signals:
- Pattern: "<subject> is/costs/equals <value>"
- Examples: "electricity bill is 500", "WiFi password is 1234", "gym membership costs 300"
- The user is storing a FACT that can be looked up by subject later
- MUST extract into metadata: subject, value

## OPERATIONS

### storeMemory
User wants to SAVE/REMEMBER something.
Trigger phrases: "תזכור ש", "remember that", "שמור ש", "save that", "note that"
Or the user is simply providing information to be stored.

### searchMemory
User wants to FIND/RECALL saved information.
Trigger phrases: "מה אמרתי על", "what did I say about", "מה שמרתי", "what did I save", "find"

### deleteMemory
User wants to DELETE saved information.
Trigger phrases: "תמחק", "delete", "forget", "remove"

### updateMemory
User wants to UPDATE saved information.
Trigger phrases: "עדכן", "update", "change what I saved"

### getAllMemory
User wants to SEE ALL saved information.
Trigger phrases: "מה שמרתי?", "what did I save?", "show all memories", "list everything"

### getMemoryById
User wants a specific memory by ID (rare).

## OUTPUT SCHEMA

### For storeMemory:
{
  "operation": "storeMemory",
  "memory": {
    "type": "note" | "contact" | "kv",
    "content": "<full text content to store>",
    "summary": "<1-sentence summary of the content>",
    "tags": ["<relevant>", "<keywords>"],
    "metadata": { <type-specific fields — see below> }
  }
}

Type-specific metadata:
- note:    { "source": "text", "entities": ["<extracted names/topics>"] }
- contact: { "name": "<name>", "phone": "<phone>", "email": "<email>", "description": "<role/context>" }
- kv:      { "subject": "<the key>", "value": "<the value>" }

### For searchMemory:
{
  "operation": "searchMemory",
  "query": "<what to search for>",
  "type": "note" | "contact" | "kv" | null,
  "limit": 5
}

### For deleteMemory:
{
  "operation": "deleteMemory",
  "searchText": "<description of memory to delete>",
  "type": "note" | "contact" | "kv" | null
}

### For updateMemory:
{
  "operation": "updateMemory",
  "searchText": "<description of memory to update>",
  "memory": {
    "type": "note" | "contact" | "kv",
    "content": "<new full content>",
    "summary": "<new summary>",
    "tags": ["<updated>", "<tags>"],
    "metadata": { <type-specific fields> }
  }
}

### For getAllMemory:
{
  "operation": "getAllMemory",
  "type": "note" | "contact" | "kv" | null,
  "limit": 20,
  "offset": 0
}

## CRITICAL RULES

1. Output ONLY the JSON object. No explanation, no markdown.
2. NEVER invent IDs — you do not have access to the database.
3. NEVER silently merge or overwrite. Each store is a new insert.
4. If unsure about the type, default to "note" — it is the safest.
5. For "content", keep the essential information. Remove filler like "remember that" / "תזכור ש".
6. For "summary", write a concise 1-sentence description.
7. "tags" should be 1-5 relevant lowercase keywords.
8. For contacts: ALWAYS extract "name" into metadata even if phone/email are missing.
9. For kv: ALWAYS extract "subject" and "value" into metadata.
10. When searching, infer the type filter if the user says "find contact Jones" → type="contact".

## EXAMPLES

### Example 1 — Store a note (idea):
User: "תזכור שיש לי רעיון למכור את Focus עם תוכניות פרימיום של AI"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "note",
    "content": "יש לי רעיון למכור את Focus עם תוכניות פרימיום של AI",
    "summary": "רעיון למונטיזציה של Focus עם תוכניות AI פרימיום",
    "tags": ["focus", "monetization", "ai", "premium"],
    "metadata": { "source": "text", "entities": ["Focus"] }
  }
}

### Example 2 — Store a contact:
User: "Jones - phone 050-1234567, email jones@email.com, HVAC contractor"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "contact",
    "content": "Jones - Phone: 050-1234567, Email: jones@email.com, HVAC contractor",
    "summary": "Contact information for Jones",
    "tags": ["contact", "jones", "hvac"],
    "metadata": {
      "name": "Jones",
      "phone": "050-1234567",
      "email": "jones@email.com",
      "description": "HVAC contractor"
    }
  }
}

### Example 3 — Store a key-value (bill):
User: "electricity bill is 500"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "kv",
    "content": "Electricity bill is 500",
    "summary": "Electricity bill value",
    "tags": ["electricity", "bill"],
    "metadata": { "subject": "electricity bill", "value": "500" }
  }
}

### Example 4 — Store a key-value (password):
User: "הסיסמא של הוויי פיי היא 1234"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "kv",
    "content": "הסיסמא של הוויי פיי היא 1234",
    "summary": "WiFi password",
    "tags": ["wifi", "password"],
    "metadata": { "subject": "wifi password", "value": "1234" }
  }
}

### Example 5 — Store a meeting summary:
User: "remember that in the meeting with the bank we discussed refinancing at 4.2%"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "note",
    "content": "In the meeting with the bank we discussed refinancing at 4.2%",
    "summary": "Bank meeting about refinancing at 4.2% interest rate",
    "tags": ["bank", "refinancing", "mortgage"],
    "metadata": { "source": "text", "entities": ["bank"] }
  }
}

### Example 6 — Search for a contact:
User: "find Jones contact"
→
{
  "operation": "searchMemory",
  "query": "Jones",
  "type": "contact",
  "limit": 5
}

### Example 7 — Search general:
User: "מה אמרתי על הפרויקט?"
→
{
  "operation": "searchMemory",
  "query": "הפרויקט",
  "type": null,
  "limit": 5
}

### Example 8 — Search kv:
User: "what's my wifi password?"
→
{
  "operation": "searchMemory",
  "query": "wifi password",
  "type": "kv",
  "limit": 5
}

### Example 9 — Delete memory:
User: "תמחק את מה ששמרתי על דני"
→
{
  "operation": "deleteMemory",
  "searchText": "דני",
  "type": null
}

### Example 10 — List all:
User: "מה שמרתי?"
→
{
  "operation": "getAllMemory",
  "type": null,
  "limit": 20,
  "offset": 0
}

### Example 11 — Store contact (Hebrew):
User: "שמור את הטלפון של דני: 052-9876543, הוא אינסטלטור"
→
{
  "operation": "storeMemory",
  "memory": {
    "type": "contact",
    "content": "דני - טלפון: 052-9876543, אינסטלטור",
    "summary": "פרטי יצירת קשר של דני",
    "tags": ["contact", "דני", "אינסטלטור"],
    "metadata": {
      "name": "דני",
      "phone": "052-9876543",
      "email": "",
      "description": "אינסטלטור"
    }
  }
}

### Example 12 — Update memory:
User: "update what I saved about the deadline - it's now January 20th"
→
{
  "operation": "updateMemory",
  "searchText": "deadline",
  "memory": {
    "type": "note",
    "content": "Project deadline is January 20th",
    "summary": "Updated project deadline to January 20th",
    "tags": ["deadline", "project"],
    "metadata": { "source": "text", "entities": ["project"] }
  }
}

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
          memory: {
            type: 'object',
            description: 'Memory object for store/update operations',
            properties: {
              type: { type: 'string', enum: ['note', 'contact', 'kv'] },
              content: { type: 'string' },
              summary: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              metadata: { type: 'object' },
            },
          },
          query: { type: 'string', description: 'Search query' },
          searchText: { type: 'string', description: 'Text to find memory for update/delete' },
          type: { type: 'string', enum: ['note', 'contact', 'kv'], description: 'Filter by memory type' },
          memoryId: { type: 'string', description: 'Memory ID' },
          limit: { type: 'number', description: 'Max results (default: 5)' },
          offset: { type: 'number', description: 'Pagination offset' },
        },
        required: ['operation'],
      },
    };
  }

  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    try {
      console.log(`[${this.name}] Calling LLM to extract memory operation`);

      const args = await this.callLLM(step, state);

      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'searchMemory'`);
        args.operation = 'searchMemory';
      }

      // Apply defaults for search
      if (args.operation === 'searchMemory') {
        args.limit = args.limit ?? 5;
      }

      // Apply defaults for getAll
      if (args.operation === 'getAllMemory') {
        args.limit = args.limit ?? 20;
        args.offset = args.offset ?? 0;
      }

      // For store, ensure memory object has a type
      if (args.operation === 'storeMemory' && args.memory) {
        args.memory.type = args.memory.type || 'note';
      }

      // Mark for entity resolution if update/delete needs lookup
      if (['updateMemory', 'deleteMemory', 'getMemoryById'].includes(args.operation) && !args.memoryId) {
        args._needsResolution = true;
        args._searchQuery = args.searchText || args.query;
      }

      // Mark storeMemory for conflict detection (contact/kv only)
      if (args.operation === 'storeMemory' && args.memory && ['contact', 'kv'].includes(args.memory.type)) {
        args._needsConflictCheck = true;
      }

      console.log(`[${this.name}] LLM determined: operation=${args.operation}, type=${args.memory?.type || args.type || 'N/A'}`);

      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);

      const message = step.constraints.rawMessage || state.input.message || '';

      let operation = 'searchMemory';
      if (/תזכור|זכור|שמור|remember|save|store|note/i.test(message)) {
        operation = 'storeMemory';
      }

      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation,
          ...(operation === 'storeMemory'
            ? {
                memory: {
                  type: 'note' as const,
                  content: message,
                  summary: message.substring(0, 80),
                  tags: [],
                  metadata: { source: 'text', entities: [] },
                },
              }
            : { query: message }),
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
