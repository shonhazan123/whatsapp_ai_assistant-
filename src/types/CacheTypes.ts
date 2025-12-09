/**
 * Cache Types for OpenAI Prompt Caching
 * 
 * OpenAI's prompt caching allows marking messages with cache_control
 * to cache them on OpenAI's servers, reducing input token costs by 50-90%
 * for repeated prompts.
 * 
 * Cached content must be:
 * - At least 1024 tokens
 * - At the beginning of the message array (prefix)
 * - Deterministic (same content = same cache)
 */

/**
 * Cache control directive for OpenAI API
 * Type "ephemeral" caches content for ~5 minutes
 */
export interface CacheControl {
  type: 'ephemeral';
}

/**
 * Message with optional cache control
 * Compatible with OpenAI's message format
 */
export interface CachedMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string | null;
  cache_control?: CacheControl;
  
  // Optional fields for function/tool messages
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  function_call?: {
    name: string;
    arguments: string;
  };
}

/**
 * Cache statistics for monitoring
 */
export interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  tokensSaved: number;
  costSaved: number;
}

/**
 * Cache configuration options
 */
export interface CacheConfig {
  enabled: boolean;
  minTokensForCache: number; // Minimum tokens to enable caching (1024+)
  cacheTTLMinutes: number; // Time-to-live for cached content
  autoCache: boolean; // Automatically cache system prompts
}

