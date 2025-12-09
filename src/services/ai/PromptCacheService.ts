/**
 * PromptCacheService
 * 
 * Manages OpenAI prompt caching to reduce input token costs.
 * 
 * Key Features:
 * - Marks system prompts for caching with cache_control
 * - Tracks cache hit rates and savings
 * - Validates cache-eligible content
 * - Provides utilities for cache management
 * 
 * Cache Rules:
 * 1. Cached content must be at least 1024 tokens
 * 2. Cached content must be at the START of messages (prefix)
 * 3. Cached content must be deterministic (no timestamps, random values)
 * 4. Cache TTL is ~5 minutes (ephemeral)
 */

import { calculateCacheSavings } from '../../config/model-pricing';
import { CacheConfig, CachedMessage, CacheStats } from '../../types/CacheTypes';
import { logger } from '../../utils/logger';

export class PromptCacheService {
  private static instance: PromptCacheService;
  private config: CacheConfig;
  private stats: CacheStats;

  private constructor() {
    this.config = {
      enabled: process.env.ENABLE_PROMPT_CACHING !== 'false',
      minTokensForCache: 1024,
      cacheTTLMinutes: 5,
      autoCache: true
    };

    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      tokensSaved: 0,
      costSaved: 0
    };

    logger.info('✅ PromptCacheService initialized', {
      enabled: this.config.enabled,
      minTokens: this.config.minTokensForCache
    });
  }

  static getInstance(): PromptCacheService {
    if (!PromptCacheService.instance) {
      PromptCacheService.instance = new PromptCacheService();
    }
    return PromptCacheService.instance;
  }

  /**
   * Mark messages with cache control for OpenAI API
   * 
   * @param messages - Array of messages to process
   * @param cacheSystemPrompt - Whether to cache the system prompt (default: true)
   * @param cacheFunctionDefinitions - Whether to cache function definitions (default: true)
   * @returns Messages with cache_control added where appropriate
   */
  addCacheControl(
    messages: Array<any>,
    cacheSystemPrompt: boolean = true,
    cacheFunctionDefinitions: boolean = true
  ): CachedMessage[] {
    if (!this.config.enabled || messages.length === 0) {
      return messages as CachedMessage[];
    }

    const cachedMessages: CachedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = { ...messages[i] };

      // Cache system prompt (first message, typically largest and most static)
      if (i === 0 && message.role === 'system' && cacheSystemPrompt) {
        // Estimate tokens (rough: ~4 chars per token)
        const estimatedTokens = Math.ceil((message.content?.length || 0) / 4);
        
        if (estimatedTokens >= this.config.minTokensForCache) {
          message.cache_control = { type: 'ephemeral' as const };
          logger.debug('🔖 Marking system prompt for caching', {
            estimatedTokens,
            contentLength: message.content?.length
          });
        }
      }

      cachedMessages.push(message);
    }

    return cachedMessages;
  }

  /**
   * Add cache control to function/tool definitions
   * Function definitions can also be cached if they're large enough
   * 
   * @param tools - Array of tool definitions
   * @returns Tools with cache control where appropriate
   */
  addCacheControlToTools(tools: Array<any>): Array<any> {
    if (!this.config.enabled || !tools || tools.length === 0) {
      return tools;
    }

    // Estimate total size of tool definitions
    const toolsJson = JSON.stringify(tools);
    const estimatedTokens = Math.ceil(toolsJson.length / 4);

    // If tools are large enough, mark the last tool for caching
    // (OpenAI caches everything up to and including the marked item)
    if (estimatedTokens >= this.config.minTokensForCache && tools.length > 0) {
      const toolsWithCache = [...tools];
      const lastToolIndex = toolsWithCache.length - 1;
      
      toolsWithCache[lastToolIndex] = {
        ...toolsWithCache[lastToolIndex],
        cache_control: { type: 'ephemeral' as const }
      };

      logger.debug('🔖 Marking tool definitions for caching', {
        toolCount: tools.length,
        estimatedTokens
      });

      return toolsWithCache;
    }

    return tools;
  }

  /**
   * Validate that messages are cache-eligible
   * 
   * @param messages - Messages to validate
   * @returns Validation result with issues if any
   */
  validateCacheEligibility(messages: Array<any>): {
    eligible: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    if (messages.length === 0) {
      issues.push('No messages provided');
      return { eligible: false, issues };
    }

    // Check if system prompt exists and is first
    if (messages[0]?.role !== 'system') {
      issues.push('System prompt must be first message for caching');
    }

    // Check for dynamic content in system prompt
    const systemContent = messages[0]?.content || '';
    if (this.containsDynamicContent(systemContent)) {
      issues.push('System prompt contains dynamic content (timestamps, random values)');
    }

    // Check minimum token requirement
    const estimatedTokens = Math.ceil(systemContent.length / 4);
    if (estimatedTokens < this.config.minTokensForCache) {
      issues.push(`System prompt too small for caching (${estimatedTokens} tokens < ${this.config.minTokensForCache})`);
    }

    return {
      eligible: issues.length === 0,
      issues
    };
  }

  /**
   * Check if content contains dynamic elements that prevent caching
   * 
   * @param content - Content to check
   * @returns True if dynamic content detected
   */
  private containsDynamicContent(content: string): boolean {
    // Check for common dynamic patterns
    const dynamicPatterns = [
      /new Date\(\)/i,
      /Date\.now\(\)/i,
      /Math\.random\(\)/i,
      /timestamp:\s*\d+/i,
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/i, // ISO timestamp
    ];

    return dynamicPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Record cache usage from API response
   * 
   * @param usage - Usage data from OpenAI API response
   * @param model - Model name for pricing calculation
   */
  recordCacheUsage(usage: any, model: string = 'gpt-5.1'): void {
    this.stats.totalRequests++;

    // OpenAI returns cache-related fields in usage or usage.prompt_tokens_details
    const cachedTokens = usage.cached_tokens 
      || usage.prompt_tokens_cached 
      || usage.prompt_tokens_details?.cached_tokens 
      || 0;
    
    const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens || 0;

    if (cachedTokens > 0) {
      this.stats.cacheHits++;
      this.stats.tokensSaved += cachedTokens;
      
      // Calculate actual cache savings using model-specific pricing
      const savings = calculateCacheSavings(model, cachedTokens);
      this.stats.costSaved += savings;

      logger.info(`💰 Cache savings: ${cachedTokens.toLocaleString()} tokens = $${savings.toFixed(4)} saved`);
    } else {
      this.stats.cacheMisses++;
      
      // Log if this was a cache write
      if (cacheCreationTokens > 0) {
        logger.debug(`📝 Wrote ${cacheCreationTokens.toLocaleString()} tokens to cache (will be available for ~5 minutes)`);
      }
    }

    // Update hit rate
    this.stats.cacheHitRate = this.stats.cacheHits / this.stats.totalRequests;
  }

  /**
   * Get current cache statistics
   * 
   * @returns Current cache stats
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      tokensSaved: 0,
      costSaved: 0
    };
    logger.info('📊 Cache stats reset');
  }

  /**
   * Get cache configuration
   * 
   * @returns Current cache config
   */
  getConfig(): CacheConfig {
    return { ...this.config };
  }

  /**
   * Update cache configuration
   * 
   * @param config - Partial config to update
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('⚙️ Cache config updated', this.config);
  }

  /**
   * Enable or disable caching
   * 
   * @param enabled - Whether to enable caching
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    logger.info(`🔄 Prompt caching ${enabled ? 'enabled' : 'disabled'}`);
  }
}

