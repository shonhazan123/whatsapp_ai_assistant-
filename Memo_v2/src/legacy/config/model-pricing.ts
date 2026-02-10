/**
 * OpenAI Model Pricing Configuration
 * 
 * Prices are per 1M tokens (1,000,000 tokens)
 * Last updated: December 2025
 * 
 * Source: OpenAI Pricing Documentation
 */

export interface ModelPricing {
  /** Price per 1M input tokens (non-cached) */
  inputPer1M: number;
  /** Price per 1M input tokens (cached - 90% discount) */
  cachedInputPer1M: number;
  /** Price per 1M output tokens */
  outputPer1M: number;
  /** Whether this model supports prompt caching */
  supportsCaching: boolean;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // GPT-5 Series
  'gpt-5.1': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5-mini': {
    inputPer1M: 0.25,
    cachedInputPer1M: 0.025,
    outputPer1M: 2.00,
    supportsCaching: true,
  },
  'gpt-5-nano': {
    inputPer1M: 0.05,
    cachedInputPer1M: 0.005,
    outputPer1M: 0.40,
    supportsCaching: true,
  },
  'gpt-5.1-chat-latest': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5-chat-latest': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5.1-codex-max': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5.1-codex': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5-codex': {
    inputPer1M: 1.25,
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-5-pro': {
    inputPer1M: 15.00,
    cachedInputPer1M: 15.00, // No caching support
    outputPer1M: 120.00,
    supportsCaching: false,
  },
  
  // GPT-4.1 Series
  'gpt-4.1': {
    inputPer1M: 2.00,
    cachedInputPer1M: 0.50,
    outputPer1M: 8.00,
    supportsCaching: true,
  },
  'gpt-4.1-mini': {
    inputPer1M: 0.40,
    cachedInputPer1M: 0.10,
    outputPer1M: 1.60,
    supportsCaching: true,
  },
  'gpt-4.1-nano': {
    inputPer1M: 0.10,
    cachedInputPer1M: 0.025,
    outputPer1M: 0.40,
    supportsCaching: true,
  },
  
  // GPT-4o Series
  'gpt-4o': {
    inputPer1M: 2.50,
    cachedInputPer1M: 1.25,
    outputPer1M: 10.00,
    supportsCaching: true,
  },
  'gpt-4o-2024-05-13': {
    inputPer1M: 5.00,
    cachedInputPer1M: 5.00, // No caching support
    outputPer1M: 15.00,
    supportsCaching: false,
  },
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    cachedInputPer1M: 0.075,
    outputPer1M: 0.60,
    supportsCaching: true,
  },
};

/**
 * Get pricing for a model
 * Returns default pricing if model not found
 */
export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || {
    inputPer1M: 1.25, // Default to gpt-5.1 pricing
    cachedInputPer1M: 0.125,
    outputPer1M: 10.00,
    supportsCaching: true,
  };
}

/**
 * Calculate cost for tokens
 * 
 * @param model - Model name
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param cachedTokens - Number of cached input tokens (default: 0)
 * @returns Total cost in USD
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): number {
  const pricing = getModelPricing(model);
  
  const nonCachedInputTokens = inputTokens - cachedTokens;
  
  // Calculate input cost
  const inputCost = (nonCachedInputTokens / 1_000_000) * pricing.inputPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cachedInputPer1M;
  
  // Calculate output cost
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  
  return inputCost + cachedCost + outputCost;
}

/**
 * Calculate cache savings
 * 
 * @param model - Model name
 * @param cachedTokens - Number of cached tokens
 * @returns Savings in USD
 */
export function calculateCacheSavings(model: string, cachedTokens: number): number {
  if (cachedTokens === 0) return 0;
  
  const pricing = getModelPricing(model);
  if (!pricing.supportsCaching) return 0;
  
  const normalCost = (cachedTokens / 1_000_000) * pricing.inputPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cachedInputPer1M;
  
  return normalCost - cachedCost;
}

