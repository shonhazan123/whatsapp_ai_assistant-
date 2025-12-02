import { DEFAULT_MODEL, openai } from '../../config/openai';
import { SystemPrompts } from '../../config/system-prompts';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { ImageAnalysisResult } from '../../types/imageAnalysis';
import { ImageCache } from '../image/ImageCache';
import { ImageProcessor } from '../image/ImageProcessor';
import { PerformanceTracker } from '../performance/PerformanceTracker';
import { OpenAIFunctionHelper, type IntentDecision } from './OpenAIFunctionHelper';

export interface CompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
    content: string | null;
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
  }>;
  functions?: FunctionDefinition[];
  functionCall?: 'auto' | 'none' | { name: string };
  tools?: Array<{
    type: 'function';
    function: FunctionDefinition;
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

  constructor(private logger: any = logger) {
    this.imageCache = ImageCache.getInstance();
    this.performanceTracker = PerformanceTracker.getInstance();
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
      
      // Build the API request
      const apiRequest: any = {
        model,
        messages: request.messages as any,
      };

      // Add functions or tools based on format
      if (useToolsFormat) {
        // Convert functions to tools format if needed
        if (request.functions && !request.tools) {
          apiRequest.tools = request.functions.map(fn => ({
            type: 'function',
            function: fn
          }));
        } else if (request.tools) {
          apiRequest.tools = request.tools;
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
        const responseMessage = completion.choices[0]?.message;
        const functionCall = responseMessage?.function_call;
        const toolCalls = responseMessage?.tool_calls;

        await this.performanceTracker.logAICall(requestId, {
          callType: 'completion',
          model: request.model || DEFAULT_MODEL,
          requestTokens: usage.prompt_tokens || 0,
          responseTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0,
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
          metadata: {
            method: 'createCompletion',
            hasFunctions: !!request.functions || !!request.tools,
            functionCall: request.functionCall || 'auto',
            useToolsFormat,
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


  async generateResponse(message: string): Promise<string> {
    try {
      const response = await this.createCompletion({
        messages: [
          { role: 'system', content: SystemPrompts.getMessageEnhancementPrompt() },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        maxTokens: 500,
        model: 'gpt-4o-mini'
      });

      return response.choices[0]?.message?.content?.trim() || '';
    } catch (error) {
      this.logger.error('Error generating response:', error);
      throw new Error(`Error generating response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async detectIntent(message: string, context: any[] = []): Promise<IntentDecision> {
    try {
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

      // Add current message
      messages.push({
        role: 'user',
        content: message
      });

      const completion = await this.createCompletion({
        messages,
        temperature: 0.1,
        maxTokens: 200,
        model: DEFAULT_MODEL // Keep gpt-5 as is (not gpt-5.1, so not using DEFAULT_MODEL)
      });

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
   * Extracts structured data from images (events, tasks, contacts, etc.)
   */
  async analyzeImage(imageBuffer: Buffer, userCaption?: string): Promise<ImageAnalysisResult> {
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
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          // Use Promise.race to implement timeout
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 60000); // 60 second timeout
          });

          completion = await Promise.race([
            openai.chat.completions.create({
              model: 'gpt-4o', // gpt-4o supports vision
              messages: [
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
              ],
              temperature: 0.3, // Lower temperature for more consistent extraction
              max_tokens: 2000 // Allow enough tokens for detailed extraction
            }),
            timeoutPromise
          ]) as any;
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
    model: string = 'text-embedding-3-small'
  ): Promise<number[]> {
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

      this.logger.debug(`Embedding created successfully (dimensions: ${embedding.length})`);
      return embedding;
    } catch (error: any) {
      this.logger.error('Error creating embedding:', error);
      
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
