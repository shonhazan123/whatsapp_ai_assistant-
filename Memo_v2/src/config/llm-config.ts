/**
 * LLM Configuration for Memo V2
 * 
 * Extends V1 model-pricing.ts with node-specific model assignments
 * and capability flags for function calling, caching, streaming.
 */

/**
 * Re-export V1 pricing utilities
 * 
 * Note: These imports use relative paths to the V1 source.
 * In production, consider:
 * 1. Symlink: npm link the V1 package
 * 2. Monorepo: Use workspace packages
 * 3. Copy: Duplicate the pricing logic here
 */

// For now, we duplicate the essential pricing functions here
// to avoid path resolution issues during development.
// TODO: Set up proper V1 linking

import OpenAI from 'openai';

// V1 model constants (duplicated for development)
export const GPT_5_1_MODEL = 'gpt-5.1';
export const GPT_4O_MINI_MODEL = 'gpt-4o-mini';
export const GPT_5_MINI_MODEL = 'gpt-5-mini';
export const GPT_5_NANO_MODEL = 'gpt-5-nano';
export const DEFAULT_MODEL = GPT_5_1_MODEL;

// OpenAI client - lazy initialized to avoid errors during testing
let _openai: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder-for-testing',
    });
  }
  return _openai;
}

// For backward compatibility
export const openai = {
  get chat() {
    return getOpenAI().chat;
  },
};

// Model pricing (from V1 model-pricing.ts)
export interface ModelPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  supportsCaching: boolean;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5.1': { inputPer1M: 1.25, cachedInputPer1M: 0.125, outputPer1M: 10.00, supportsCaching: true },
  'gpt-5-mini': { inputPer1M: 0.25, cachedInputPer1M: 0.025, outputPer1M: 2.00, supportsCaching: true },
  'gpt-5-nano': { inputPer1M: 0.05, cachedInputPer1M: 0.005, outputPer1M: 0.40, supportsCaching: true },
  'gpt-4o': { inputPer1M: 2.50, cachedInputPer1M: 1.25, outputPer1M: 10.00, supportsCaching: true },
  'gpt-4o-mini': { inputPer1M: 0.15, cachedInputPer1M: 0.075, outputPer1M: 0.60, supportsCaching: true },
  'gpt-4.1-nano': { inputPer1M: 0.10, cachedInputPer1M: 0.025, outputPer1M: 0.40, supportsCaching: true },
};

export function getModelPricing(model: string): ModelPricing {
  return MODEL_PRICING[model] || MODEL_PRICING['gpt-4o-mini'];
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number = 0
): number {
  const pricing = getModelPricing(model);
  const nonCachedInputTokens = inputTokens - cachedTokens;
  const inputCost = (nonCachedInputTokens / 1_000_000) * pricing.inputPer1M;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cachedInputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + cachedCost + outputCost;
}

// ============================================================================
// LLM Model Capabilities (extends V1 pricing with runtime flags)
// ============================================================================

export interface LLMModelConfig {
  model: string;
  maxTokens?: number;
  temperature?: number;
  
  // Capability flags
  supportsCaching: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  supportsVision: boolean;
  
  // Function calling format
  functionFormat: 'tools' | 'functions' | 'none';
}

/**
 * Model capability registry
 * Pricing comes from V1 model-pricing.ts, capabilities defined here
 */
export const LLM_CAPABILITIES: Record<string, LLMModelConfig> = {
  // GPT-5 Series
  'gpt-5.1': {
    model: 'gpt-5.1',
    maxTokens: 16384,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: true,
    functionFormat: 'tools',
  },
  'gpt-5-mini': {
    model: 'gpt-5-mini',
    maxTokens: 16384,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: true,
    functionFormat: 'tools',
  },
  'gpt-5-nano': {
    model: 'gpt-5-nano',
    maxTokens: 8192,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    functionFormat: 'tools',
  },
  
  // GPT-4 Series
  'gpt-4o': {
    model: 'gpt-4o',
    maxTokens: 16384,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: true,
    functionFormat: 'tools',
  },
  'gpt-4o-mini': {
    model: 'gpt-4o-mini',
    maxTokens: 16384,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: true,
    functionFormat: 'tools',
  },
  'gpt-4.1-nano': {
    model: 'gpt-4.1-nano',
    maxTokens: 8192,
    temperature: 0.7,
    supportsCaching: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    functionFormat: 'tools',
  },
  
  // O1/O3 Series (reasoning models)
  'o1': {
    model: 'o1',
    maxTokens: 100000,
    temperature: 1, // o1 uses fixed temperature
    supportsCaching: false,
    supportsFunctionCalling: false,
    supportsStreaming: false,
    supportsVision: false,
    functionFormat: 'none',
  },
  'o1-mini': {
    model: 'o1-mini',
    maxTokens: 65536,
    temperature: 1,
    supportsCaching: false,
    supportsFunctionCalling: false,
    supportsStreaming: false,
    supportsVision: false,
    functionFormat: 'none',
  },
};

// ============================================================================
// Per-Node Model Configuration
// ============================================================================

export interface NodeModelAssignment {
  planner: string;
  resolvers: {
    calendar: string;
    database: string;
    gmail: string;
    secondBrain: string;
    general: string;
    meta: string;
  };
  responseWriter: string;
  imageAnalysis: string;
  errorExplainer: string;  // Lightweight model for contextual error explanations
}

/**
 * Default model assignments per node
 * Can be overridden via environment variables
 */
export const DEFAULT_NODE_MODELS: NodeModelAssignment = {
  // Planner: needs good reasoning
  planner: process.env.LLM_PLANNER_MODEL || 'gpt-4o-mini',
  
  // Resolvers: need function calling
  resolvers: {
    calendar: process.env.LLM_RESOLVER_CALENDAR_MODEL || 'gpt-4o-mini',
    database: process.env.LLM_RESOLVER_DATABASE_MODEL || 'gpt-4o-mini',
    gmail: process.env.LLM_RESOLVER_GMAIL_MODEL || 'gpt-4o-mini',
    secondBrain: process.env.LLM_RESOLVER_SECONDBRAIN_MODEL || 'gpt-4o-mini',
    general: process.env.LLM_RESOLVER_GENERAL_MODEL || 'gpt-4o-mini',
    meta: process.env.LLM_RESOLVER_META_MODEL || 'gpt-4o-mini',
  },
  
  // Response writer: cheap, fast
  responseWriter: process.env.LLM_RESPONSE_WRITER_MODEL || 'gpt-4o-mini',
  
  // Image analysis: needs vision
  imageAnalysis: process.env.LLM_IMAGE_ANALYSIS_MODEL || 'gpt-4o',
  
  // Error explainer: cheap model for contextual error explanations
  errorExplainer: process.env.LLM_ERROR_EXPLAINER_MODEL || 'gpt-4o-mini',
};

// ============================================================================
// LLM Service
// ============================================================================

export function getModelConfig(model: string): LLMModelConfig {
  return LLM_CAPABILITIES[model] || LLM_CAPABILITIES['gpt-4o-mini'];
}

export function getNodeModel(
  nodeType: 'planner' | 'responseWriter' | 'imageAnalysis' | 'errorExplainer' | keyof NodeModelAssignment['resolvers'],
  isResolver: boolean = false
): LLMModelConfig {
  let modelName: string;
  
  if (isResolver) {
    modelName = DEFAULT_NODE_MODELS.resolvers[nodeType as keyof NodeModelAssignment['resolvers']];
  } else {
    modelName = DEFAULT_NODE_MODELS[nodeType as keyof Omit<NodeModelAssignment, 'resolvers'>];
  }
  
  return getModelConfig(modelName);
}

/**
 * Validate model can be used for a specific purpose
 */
export function validateModelForNode(
  model: string,
  requirements: { needsFunctionCalling?: boolean; needsVision?: boolean }
): { valid: boolean; reason?: string } {
  const config = getModelConfig(model);
  
  if (requirements.needsFunctionCalling && !config.supportsFunctionCalling) {
    return { valid: false, reason: `Model ${model} does not support function calling` };
  }
  
  if (requirements.needsVision && !config.supportsVision) {
    return { valid: false, reason: `Model ${model} does not support vision` };
  }
  
  return { valid: true };
}

