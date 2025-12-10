import { DEFAULT_MODEL, openai } from '../../config/openai';
import { SystemPrompts } from '../../config/system-prompts';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { CachedMessage } from '../../types/CacheTypes';
import { ImageAnalysisResult } from '../../types/imageAnalysis';
import { prependTimeContext } from '../../utils/timeContext';
import { ImageCache } from '../image/ImageCache';
import { ImageProcessor } from '../image/ImageProcessor';
import { PerformanceTracker } from '../performance/PerformanceTracker';
import { setAgentNameForTracking } from '../performance/performanceUtils';
import { OpenAIFunctionHelper, type IntentDecision } from './OpenAIFunctionHelper';
import { PromptCacheService } from './PromptCacheService';

export interface CompletionRequest {
  messages: Array<CachedMessage>;
  functions?: FunctionDefinition[];
  functionCall?: 'auto' | 'none' | { name: string };
  tools?: Array<{
    type: 'function';
    function: FunctionDefinition;
    cache_control?: { type: 'ephemeral' };
  }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface CompletionResponse {
  choices: Array<{
    message?: {
      content?: string | null;
      function_call?: {
        name: string;
        arguments: string;
      };
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

// Re-export types from helper for backward compatibility
export type { IntentCategory, IntentDecision } from './OpenAIFunctionHelper';

export class OpenAIService {
  private imageCache: ImageCache;
  private performanceTracker: PerformanceTracker;
  private promptCacheService: PromptCacheService;

  constructor(private logger: any = logger) {
    this.imageCache = ImageCache.getInstance();
    this.performanceTracker = PerformanceTracker.getInstance();
    this.promptCacheService = PromptCacheService.getInstance();
  }

  async createCompletion(request: CompletionRequest, requestId?: string): Promise<CompletionResponse> {
    const startTime = Date.now();
    let completion: any;
    let error: Error | null = null;

    try {
      const model = request.model || DEFAULT_MODEL;
      
      // Determine if we should use tools format (for newer models) or functions format (for older models)
      // Models that support tools: gpt-4o, gpt-4-turbo, gpt-3.5-turbo (newer versions), gpt-5.1
      // Models that only support functions: older gpt-3.5-turbo versions
      const useToolsFormat = request.tools !== undefined || 
                            (request.functions && OpenAIFunctionHelper.shouldUseToolsFormat(model));
      
      // Apply prompt caching to messages
      const messagesWithCache = this.promptCacheService.addCacheControl(
        request.messages,
        true, // cache system prompt
        true  // cache function definitions
      );
      
      // Build the API request
      const apiRequest: any = {
        model,
        messages: messagesWithCache as any,
      };

      // Add functions or tools based on format
      if (useToolsFormat) {
        // Convert functions to tools format if needed
        if (request.functions && !request.tools) {
          const tools = request.functions.map(fn => ({
            type: 'function',
            function: fn
          }));
          // Add cache control to tools if eligible
          apiRequest.tools = this.promptCacheService.addCacheControlToTools(tools);
        } else if (request.tools) {
          // Add cache control to tools if eligible
          apiRequest.tools = this.promptCacheService.addCacheControlToTools(request.tools);
        }
        
        // Convert functionCall to tool_choice
        if (request.functionCall) {
          if (request.functionCall === 'auto') {
            apiRequest.tool_choice = 'auto';
          } else if (request.functionCall === 'none') {
            apiRequest.tool_choice = 'none';
          } else if (typeof request.functionCall === 'object') {
            apiRequest.tool_choice = {
              type: 'function',
              function: { name: request.functionCall.name }
            };
          }
        } else if (request.tool_choice) {
          apiRequest.tool_choice = request.tool_choice;
        }
      } else {
        // Use legacy functions format
        if (request.functions) {
          apiRequest.functions = request.functions;
        }
        if (request.functionCall) {
          apiRequest.function_call = request.functionCall;
        }
      }

      // Add optional parameters
      if (request.temperature !== undefined) {
        apiRequest.temperature = request.temperature;
      }
      if (request.maxTokens !== undefined) {
        // Newer models (gpt-5.x, newer gpt-4o versions) require max_completion_tokens instead of max_tokens
        if (OpenAIFunctionHelper.requiresMaxCompletionTokens(model)) {
          apiRequest.max_completion_tokens = request.maxTokens;
        } else {
          apiRequest.max_tokens = request.maxTokens;
        }
      }

      completion = await openai.chat.completions.create(apiRequest);

      // Track successful completion
      if (requestId) {
        const usage = (completion as any).usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        
        // Log cache information from API response
        const cachedTokens = usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
        const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens || 0;
        
        // Calculate token breakdown for debugging
        const nonCachedInputTokens = usage.prompt_tokens - cachedTokens;
        const systemPromptTokens = messagesWithCache[0]?.content ? Math.ceil((messagesWithCache[0].content?.length || 0) / 4) : 0;
        const contextTokens = messagesWithCache.length > 1 ? Math.ceil(
          messagesWithCache.slice(1, -1).reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4
        ) : 0;
        const lastMessage = messagesWithCache[messagesWithCache.length - 1];
        const userMessageTokens = lastMessage?.content ? 
          Math.ceil((lastMessage.content.length || 0) / 4) : 0;
        
        if (cachedTokens > 0) {
          this.logger.info(`✅ Cache HIT: ${cachedTokens.toLocaleString()} tokens served from cache (${((cachedTokens / usage.prompt_tokens) * 100).toFixed(1)}% of input)`);
          this.logger.debug(`📊 Token Breakdown: System: ~${systemPromptTokens.toLocaleString()}, Context: ~${contextTokens.toLocaleString()}, User: ~${userMessageTokens.toLocaleString()}, Cached: ${cachedTokens.toLocaleString()}`);
          // Warn if cache is much less than system prompt (context likely broke cache)
          if (cachedTokens < systemPromptTokens * 0.5) {
            this.logger.warn(`⚠️  Cache hit is only ${((cachedTokens / systemPromptTokens) * 100).toFixed(1)}% of system prompt - context messages likely broke cache prefix match`);
          }
        } else if (cacheCreationTokens > 0) {
          this.logger.info(`📝 Cache WRITE: ${cacheCreationTokens.toLocaleString()} tokens written to cache (next request will use this cache)`);
          this.logger.debug(`📊 Token Breakdown: System: ~${systemPromptTokens.toLocaleString()}, Context: ~${contextTokens.toLocaleString()}, User: ~${userMessageTokens.toLocaleString()}`);
        } else {
          // No cache hit or write - this shouldn't happen for cached prompts
          this.logger.warn(`⚠️  No cache activity (neither hit nor write) - system prompt may not be marked for caching or cache was invalidated`);
        }
        
        // Detailed usage logging
        this.logger.debug('API Usage:', {
          model: request.model || DEFAULT_MODEL,
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens,
          cached_tokens: cachedTokens,
          cache_creation_tokens: cacheCreationTokens,
          non_cached_input: nonCachedInputTokens,
          estimated_breakdown: {
            system_prompt: systemPromptTokens,
            context_messages: contextTokens,
            user_message: userMessageTokens
          }
        });
        
        // Record cache usage for monitoring (with model for accurate pricing)
        this.promptCacheService.recordCacheUsage(usage, model);
        
        const responseMessage = completion.choices[0]?.message;
        const functionCall = responseMessage?.function_call;
        const toolCalls = responseMessage?.tool_calls;

        // Calculate actual paid tokens
        const actualRequestTokens = usage.prompt_tokens - cachedTokens;
        const actualTotalTokens = usage.total_tokens - cachedTokens;

        const aiCallInfo = {
          model: request.model || DEFAULT_MODEL,
          requestTokens: usage.prompt_tokens || 0,
          responseTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          cachedTokens: cachedTokens,
          actualRequestTokens: actualRequestTokens,
          actualTotalTokens: actualTotalTokens,
        };

        // Store last AI call info for function tracking
        this.performanceTracker['requestContext'].setLastAICall(requestId, aiCallInfo);

        await this.performanceTracker.logAICall(requestId, {
          callType: 'completion',
          ...aiCallInfo,
          startTime,
          endTime: Date.now(),
          messages: request.messages.map(msg => ({
            role: msg.role,
            content: msg.content || ''
          })),
          responseContent: responseMessage?.content || undefined,
          functionCall: functionCall ? {
            name: functionCall.name,
            arguments: functionCall.arguments
          } : (toolCalls && toolCalls.length > 0 ? {
            name: toolCalls[0].function.name,
            arguments: toolCalls[0].function.arguments
          } : undefined),
          success: true,
          error: null,
          // Cache metrics (Phase 1)
          cachedTokens: cachedTokens,
          cacheHit: cachedTokens > 0,
          cacheWriteTokens: cacheCreationTokens,
          metadata: {
            method: 'createCompletion',
            hasFunctions: !!request.functions || !!request.tools,
            functionCall: request.functionCall || 'auto',
            useToolsFormat,
            cachedTokens,
            cacheCreationTokens,
          },
        });
      }

      return completion as CompletionResponse;
    } catch (err) {
      error = err instanceof Error ? err : new Error('Unknown error');
      this.logger.error('OpenAI API error:', error);

      // Track failed completion
      if (requestId) {
        await this.performanceTracker.logAICall(requestId, {
          callType: 'completion',
          model: request.model || DEFAULT_MODEL,
          requestTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          startTime,
          endTime: Date.now(),
          messages: request.messages.map(msg => ({
            role: msg.role,
            content: msg.content || ''
          })),
          success: false,
          error: error.message,
          metadata: {
            method: 'createCompletion',
            hasFunctions: !!request.functions || !!request.tools,
          },
        });
      }

      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }


  async generateResponse(message: string, requestId?: string, agentName?: string): Promise<string> {
    try {
      // Set agent name - use provided name or default to 'response-generator'
      const trackingRequestId = requestId || setAgentNameForTracking(agentName || 'message-enhancer');

      const response = await this.createCompletion({
        messages: [
          { role: 'system', content: SystemPrompts.getMessageEnhancementPrompt() },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        maxTokens: 500,
        model: 'gpt-4o-mini'
      }, trackingRequestId);

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      this.logger.error('Error generating response:', error);
      throw new Error(`Error generating response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async detectIntent(message: string, context: any[] = []): Promise<IntentDecision> {
    try {
      const trackingRequestId = setAgentNameForTracking('intent');

      // Build context-aware messages for intent detection
      const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [
        {
          role: 'system',
          content: SystemPrompts.getIntentClassifierPrompt()
        }
      ];

      // Add conversation context (last 4 messages for better context)
      const recentContext = context.slice(-4);
      recentContext.forEach((msg: any) => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });

      // Add current message with time context for accurate time interpretation
      // This allows the intent classifier to understand "tomorrow", "at 6pm", etc.
      messages.push({
        role: 'user',
        content: prependTimeContext(message)
      });

      const completion = await this.createCompletion({
        messages,
        temperature: 0.1,
        maxTokens: 200,
        model: DEFAULT_MODEL // Keep gpt-5 as is (not gpt-5.1, so not using DEFAULT_MODEL)
      }, trackingRequestId);

      const rawContent = completion.choices[0]?.message?.content?.trim();
      if (!rawContent) {
        this.logger.warn('Intent detection returned empty content, defaulting to general.');
        return OpenAIFunctionHelper.defaultIntentDecision();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch (parseError) {
        this.logger.warn('Intent detection returned invalid JSON, attempting to coerce.', parseError);
        parsed = OpenAIFunctionHelper.tryFixJson(rawContent, this.logger);
      }

      const decision = OpenAIFunctionHelper.normalizeIntentDecision(parsed);
      this.logger.info(
        `🎯 Intent detected: ${decision.primaryIntent} (plan: ${decision.requiresPlan}, agents: ${decision.involvedAgents.join(', ') || 'none'})`
      );
      return decision;
    } catch (error) {
      this.logger.error('Error detecting intent:', error);
      return OpenAIFunctionHelper.defaultIntentDecision();
    }
  }

  async detectLanguage(message: string): Promise<'hebrew' | 'english' | 'other'> {
    try {
      // Simple heuristic - if message contains Hebrew characters, it's Hebrew
      const hebrewRegex = /[\u0590-\u05FF]/;
      if (hebrewRegex.test(message)) {
        return 'hebrew';
      }
      
      // Simple English detection
      const englishRegex = /[a-zA-Z]/;
      if (englishRegex.test(message)) {
        return 'english';
      }
      
      return 'other';
    } catch (error) {
      this.logger.error('Error detecting language:', error);
      return 'other';
    }
  }

  /**
   * Analyze an image using GPT-4 Vision
   * Extracts structured data from images (events, tasks, etc.)
   */
  async analyzeImage(imageBuffer: Buffer, userCaption?: string, requestId?: string): Promise<ImageAnalysisResult> {
    try {
      this.logger.info('🔍 Starting image analysis...');
      
      // Step 1: Check cache first
      const cachedResult = this.imageCache.get(imageBuffer);
      if (cachedResult) {
        this.logger.info('✅ Using cached image analysis result');
        return cachedResult;
      }
      
      // Step 2: Validate image
      const validation = ImageProcessor.validateImage(imageBuffer);
      if (!validation.valid) {
        this.logger.error(`Image validation failed: ${validation.error}`);
        return {
          imageType: 'random',
          description: validation.error || 'Invalid image',
          confidence: 'low',
          formattedMessage: `Sorry, I couldn't process your image. ${validation.error || 'The image format is not supported or the image is corrupted.'}`
        };
      }
      
      // Step 3: Compress if needed
      let processedBuffer = imageBuffer;
      if (validation.needsCompression) {
        try {
          const compressionResult = await ImageProcessor.compressImage(imageBuffer);
          processedBuffer = compressionResult.buffer;
          if (compressionResult.compressed) {
            this.logger.info(`Image compressed: ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressionResult.compressedSize / 1024 / 1024).toFixed(2)}MB`);
          }
        } catch (compressionError) {
          this.logger.error('Image compression failed:', compressionError);
          return {
            imageType: 'random',
            description: 'Image is too large to process',
            confidence: 'low',
            formattedMessage: 'Sorry, your image is too large to process. Please send a smaller image (under 4MB).'
          };
        }
      }
      
      // Step 4: Get MIME type and convert to base64
      const mimeType = ImageProcessor.getMimeType(validation.format || 'jpeg');
      const base64Image = processedBuffer.toString('base64');
      
      // Step 5: Build the prompt with optional user caption
      let userPrompt = SystemPrompts.getImageAnalysisPrompt();
      if (userCaption) {
        userPrompt += `\n\nUser's caption: "${userCaption}"\nUse this caption to help understand the context of the image.`;
      }
      
      // Step 6: Create vision API request with retry logic
      let completion;
      let retries = 2;
      let lastError: any;
      const visionStartTime = Date.now();
      
      const trackingRequestId = requestId || setAgentNameForTracking('image-analyzer');
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Use Promise.race to implement timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 60000); // 60 second timeout
          });

          // Apply prompt caching to system message (Phase 1)
          const messagesWithCache = this.promptCacheService.addCacheControl([
            {
              role: 'system',
              content: userPrompt
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: userCaption 
                    ? `Analyze this image. The user provided this caption: "${userCaption}". Extract structured data if possible.`
                    : 'Analyze this image and extract structured data if possible.'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ] as any
            }
          ], true, false); // Cache system prompt, not tools

          completion = await Promise.race([
            openai.chat.completions.create({
              model: 'gpt-4o', // gpt-4o supports vision
              messages: messagesWithCache as any,
              temperature: 0.3, // Lower temperature for more consistent extraction
              max_tokens: 2000 // Allow enough tokens for detailed extraction
            }),
            timeoutPromise
          ]) as any;
          
          // Track successful vision call
          if (trackingRequestId) {
            const usage = (completion as any).usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            const responseContent = completion.choices[0]?.message?.content?.trim() || '';
            
            // Extract cache information (Phase 1)
            const cachedTokens = usage.cached_tokens || usage.prompt_tokens_details?.cached_tokens || 0;
            const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_tokens || 0;
            
            // Record cache usage (vision model: gpt-4o)
            this.promptCacheService.recordCacheUsage(usage, 'gpt-4o');
            
            if (cachedTokens > 0) {
              this.logger.info(`✅ Cache HIT (Vision): ${cachedTokens} tokens served from cache`);
            } else if (cacheCreationTokens > 0) {
              this.logger.info(`📝 Cache WRITE (Vision): ${cacheCreationTokens} tokens written to cache`);
            }
            
            // Calculate actual paid tokens
            const actualRequestTokens = usage.prompt_tokens - cachedTokens;
            const actualTotalTokens = usage.total_tokens - cachedTokens;
            
            const aiCallInfo = {
              model: 'gpt-4o',
              requestTokens: usage.prompt_tokens || 0,
              responseTokens: usage.completion_tokens || 0,
              totalTokens: usage.total_tokens || 0,
              cachedTokens: cachedTokens,
              actualRequestTokens: actualRequestTokens,
              actualTotalTokens: actualTotalTokens,
            };
            
            // Store last AI call info
            this.performanceTracker['requestContext'].setLastAICall(trackingRequestId, aiCallInfo);
            
            await this.performanceTracker.logAICall(trackingRequestId, {
              callType: 'vision',
              ...aiCallInfo,
              startTime: visionStartTime,
              endTime: Date.now(),
              messages: [
                { role: 'system', content: userPrompt },
                { role: 'user', content: userCaption || '[Image]' }
              ],
              responseContent: responseContent.substring(0, 1000),
              success: true,
              error: null,
              // Cache metrics (Phase 1)
              cachedTokens: cachedTokens,
              cacheHit: cachedTokens > 0,
              cacheWriteTokens: cacheCreationTokens,
              metadata: {
                method: 'analyzeImage',
                hasImage: true,
                imageSize: imageBuffer.length,
                retryAttempt: attempt,
                cachedTokens,
                cacheCreationTokens,
              },
            });
          }
          
          break; // Success, exit retry loop
        } catch (apiError: any) {
          lastError = apiError;
          
          // Handle rate limiting
          if (apiError.status === 429) {
            const retryAfter = apiError.response?.headers?.['retry-after'] || 5;
            if (attempt < retries) {
              this.logger.warn(`Rate limited, retrying after ${retryAfter} seconds...`);
              await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
              continue;
            } else {
              throw new Error('OpenAI API rate limit exceeded. Please try again in a few moments.');
            }
          }
          
          // Handle timeout
          if (apiError.code === 'ECONNABORTED' || apiError.message?.includes('timeout')) {
            if (attempt < retries) {
              this.logger.warn(`Request timeout, retrying... (attempt ${attempt + 1}/${retries + 1})`);
              await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
              continue;
            } else {
              throw new Error('Request timed out. The image may be too large or the service is busy. Please try again.');
            }
          }
          
          // Don't retry on other errors
          throw apiError;
        }
      }
      
      if (!completion) {
        // Track failed vision call
        if (trackingRequestId) {
          await this.performanceTracker.logAICall(trackingRequestId, {
            callType: 'vision',
            model: 'gpt-4o',
            requestTokens: 0,
            responseTokens: 0,
            totalTokens: 0,
            startTime: visionStartTime,
            endTime: Date.now(),
            success: false,
            error: lastError?.message || 'Failed to get completion from OpenAI',
            metadata: {
              method: 'analyzeImage',
              hasImage: true,
              imageSize: imageBuffer.length,
            },
          });
        }
        throw lastError || new Error('Failed to get completion from OpenAI');
      }

      const responseContent = completion.choices[0]?.message?.content?.trim();
      if (!responseContent) {
        this.logger.warn('Image analysis returned empty content');
        return OpenAIFunctionHelper.getDefaultImageAnalysisResult();
      }

      // Parse JSON response
      let analysisResult: ImageAnalysisResult;
      try {
        // Try to parse as JSON first
        analysisResult = JSON.parse(responseContent);
      } catch (parseError) {
        // If not JSON, try to extract JSON from text
        this.logger.warn('Image analysis response is not pure JSON, attempting extraction');
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysisResult = JSON.parse(jsonMatch[0]);
        } else {
          // Fallback: treat as random image description
          this.logger.warn('Could not extract JSON from image analysis, using description fallback');
          return {
            imageType: 'random',
            description: responseContent,
            confidence: 'low',
            language: OpenAIFunctionHelper.detectLanguageFromText(responseContent),
            formattedMessage: `I analyzed your image: ${responseContent}\n\nIs there anything you'd like me to help you with?`
          };
        }
      }

      // Validate and normalize the result
      analysisResult = OpenAIFunctionHelper.normalizeImageAnalysisResult(analysisResult);
      
      // Ensure formattedMessage exists
      if (!analysisResult.formattedMessage) {
        analysisResult.formattedMessage = OpenAIFunctionHelper.generateFallbackFormattedMessage(analysisResult);
      }
      
      // Step 7: Cache the result
      this.imageCache.set(imageBuffer, analysisResult);
      
      this.logger.info(`✅ Image analysis complete: ${analysisResult.imageType} (confidence: ${analysisResult.confidence})`);
      return analysisResult;
      
    } catch (error: any) {
      this.logger.error('Error analyzing image:', error);
      
      // Provide more specific error messages
      let errorMessage = 'Sorry, I encountered an error analyzing your image.';
      
      if (error.message?.includes('rate limit')) {
        errorMessage = 'The image analysis service is currently busy. Please try again in a few moments.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'The image took too long to process. Please try with a smaller or simpler image.';
      } else if (error.message?.includes('too large')) {
        errorMessage = 'Your image is too large to process. Please send a smaller image (under 4MB).';
      } else if (error.message?.includes('invalid') || error.message?.includes('format')) {
        errorMessage = 'I couldn\'t process this image format. Please send a JPEG, PNG, or WebP image.';
      }
      
      // Return fallback result
      return {
        imageType: 'random',
        description: error.message || 'Error analyzing image',
        confidence: 'low',
        formattedMessage: `${errorMessage} You can also describe what you see and I'll help you with it.`
      };
    }
  }


  /**
   * Create embedding vector for text using OpenAI embeddings API
   * @param text The text to embed
   * @param model The embedding model to use (default: text-embedding-3-small)
   * @returns Array of 1536 numbers representing the embedding vector
   */
  async createEmbedding(
    text: string,
    model: string = 'text-embedding-3-small',
    requestId?: string,
    agentName?: string
  ): Promise<number[]> {
    const embeddingStartTime = Date.now();
    
    const trackingRequestId = requestId || setAgentNameForTracking('embedding');
    
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Text cannot be empty');
      }

      this.logger.info(`Creating embedding for text (length: ${text.length}, model: ${model})`);

      const response = await openai.embeddings.create({
        model,
        input: text.trim(),
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data returned from OpenAI');
      }

      const embedding = response.data[0].embedding;
      
      // Validate embedding dimensions
      if (model === 'text-embedding-3-small' && embedding.length !== 1536) {
        this.logger.warn(`Unexpected embedding dimension: ${embedding.length}, expected 1536`);
      }

      // Track successful embedding call
      if (trackingRequestId) {
        // Embeddings API doesn't return usage in the same format, estimate tokens
        // Rough estimate: ~1 token per 4 characters for embeddings
        // Embeddings don't support caching, so actual = total
        const estimatedTokens = Math.ceil(text.trim().length / 4);
        
        const aiCallInfo = {
          model,
          requestTokens: estimatedTokens,
          responseTokens: 0, // Embeddings don't have response tokens
          totalTokens: estimatedTokens,
          cachedTokens: 0, // No caching support
          actualRequestTokens: estimatedTokens, // actual = total (no cache)
          actualTotalTokens: estimatedTokens,
        };
        
        // Store last AI call info
        this.performanceTracker['requestContext'].setLastAICall(trackingRequestId, aiCallInfo);
        
        await this.performanceTracker.logAICall(trackingRequestId, {
          callType: 'embedding',
          ...aiCallInfo,
          startTime: embeddingStartTime,
          endTime: Date.now(),
          messages: [{ role: 'user', content: text.trim().substring(0, 1000) }],
          success: true,
          error: null,
          metadata: {
            method: 'createEmbedding',
            textLength: text.length,
            embeddingDimensions: embedding.length,
          },
        });
      }

      this.logger.debug(`Embedding created successfully (dimensions: ${embedding.length})`);
      return embedding;
    } catch (error: any) {
      this.logger.error('Error creating embedding:', error);
      
      // Track failed embedding call
      if (trackingRequestId) {
        await this.performanceTracker.logAICall(trackingRequestId, {
          callType: 'embedding',
          model,
          requestTokens: 0,
          responseTokens: 0,
          totalTokens: 0,
          startTime: embeddingStartTime,
          endTime: Date.now(),
          success: false,
          error: error.message || 'Unknown error',
          metadata: {
            method: 'createEmbedding',
            textLength: text.length,
          },
        });
      }
      
      // Handle rate limiting
      if (error.status === 429) {
        throw new Error('OpenAI API rate limit exceeded. Please try again in a few moments.');
      }
      
      // Handle invalid input
      if (error.status === 400) {
        throw new Error(`Invalid input for embedding: ${error.message || 'Bad request'}`);
      }
      
      throw new Error(`Failed to create embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
