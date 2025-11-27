import { openai } from '../../config/openai';
import { SystemPrompts } from '../../config/system-prompts';
import { AgentName } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { ImageAnalysisResult } from '../../types/imageAnalysis';
import { ImageCache } from '../image/ImageCache';
import { ImageProcessor } from '../image/ImageProcessor';

export interface CompletionRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
  }>;
  functions?: FunctionDefinition[];
  functionCall?: 'auto' | 'none' | { name: string };
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface CompletionResponse {
  choices: Array<{
    message?: {
      content?: string;
      function_call?: {
        name: string;
        arguments: string;
      };
    };
  }>;
}

export type IntentCategory = AgentName | 'general';

export interface IntentDecision {
  primaryIntent: IntentCategory;
  requiresPlan: boolean;
  involvedAgents: AgentName[];
  confidence?: 'high' | 'medium' | 'low';
}

export class OpenAIService {
  private imageCache: ImageCache;

  constructor(private logger: any = logger) {
    this.imageCache = ImageCache.getInstance();
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const completion = await openai.chat.completions.create({
        model: request.model || 'gpt-4o',
        messages: request.messages as any,
        functions: request.functions as any,
        function_call: request.functionCall as any,
        // temperature: request.temperature || 0.7,
        // max_tokens: request.maxTokens || 500
      });

      return completion as CompletionResponse;
    } catch (error) {
      this.logger.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        model: 'gpt-5'
      });

      const rawContent = completion.choices[0]?.message?.content?.trim();
      if (!rawContent) {
        this.logger.warn('Intent detection returned empty content, defaulting to general.');
        return this.defaultIntentDecision();
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawContent);
      } catch (parseError) {
        this.logger.warn('Intent detection returned invalid JSON, attempting to coerce.', parseError);
        parsed = this.tryFixJson(rawContent);
      }

      const decision = this.normalizeIntentDecision(parsed);
      this.logger.info(
        `🎯 Intent detected: ${decision.primaryIntent} (plan: ${decision.requiresPlan}, agents: ${decision.involvedAgents.join(', ') || 'none'})`
      );
      return decision;
    } catch (error) {
      this.logger.error('Error detecting intent:', error);
      return this.defaultIntentDecision();
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
  private normalizeIntentDecision(candidate: any): IntentDecision {
    const validIntents: IntentCategory[] = [
      AgentName.CALENDAR,
      AgentName.GMAIL,
      AgentName.DATABASE,
      AgentName.SECOND_BRAIN,
      AgentName.MULTI_TASK,
      'general'
    ];

    let primaryIntent: IntentCategory = this.defaultIntentDecision().primaryIntent;
    if (candidate && typeof candidate === 'object' && typeof candidate.primaryIntent === 'string') {
      const normalized = candidate.primaryIntent.toLowerCase();
      if (validIntents.includes(normalized as IntentCategory)) {
        primaryIntent = normalized as IntentCategory;
      }
    }

    let requiresPlan = false;
    if (candidate && typeof candidate.requiresPlan === 'boolean') {
      requiresPlan = candidate.requiresPlan;
    } else if (primaryIntent === AgentName.MULTI_TASK) {
      requiresPlan = true;
    }

    let involvedAgents: AgentName[] = [];
    if (Array.isArray(candidate?.involvedAgents)) {
      involvedAgents = candidate.involvedAgents
        .map((value: any) => (typeof value === 'string' ? value.toLowerCase() : ''))
        .filter((value: string): value is AgentName =>
          [AgentName.CALENDAR, AgentName.GMAIL, AgentName.DATABASE, AgentName.SECOND_BRAIN, AgentName.MULTI_TASK].includes(value as AgentName)
        )
        .filter((agent: AgentName) => agent !== AgentName.MULTI_TASK);
    }

    if (primaryIntent !== 'general' && involvedAgents.length === 0 && primaryIntent !== AgentName.MULTI_TASK) {
      involvedAgents = [primaryIntent];
    }

    const confidence: 'high' | 'medium' | 'low' =
      candidate && typeof candidate.confidence === 'string'
        ? (['high', 'medium', 'low'].includes(candidate.confidence.toLowerCase())
            ? candidate.confidence.toLowerCase()
            : 'medium')
        : 'medium';

    return {
      primaryIntent,
      requiresPlan,
      involvedAgents,
      confidence
    };
  }

  private defaultIntentDecision(): IntentDecision {
    return {
      primaryIntent: 'general',
      requiresPlan: false,
      involvedAgents: [],
      confidence: 'medium'
    };
  }

  private tryFixJson(raw: string): any {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        this.logger.error('Failed to coerce intent JSON.', error);
        return {};
      }
    }

    // Attempt to extract JSON from text
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (error) {
        this.logger.error('Failed to parse extracted intent JSON.', error);
      }
    }

    return {};
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
        return this.getDefaultImageAnalysisResult();
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
            language: this.detectLanguageFromText(responseContent),
            formattedMessage: `I analyzed your image: ${responseContent}\n\nIs there anything you'd like me to help you with?`
          };
        }
      }

      // Validate and normalize the result
      analysisResult = this.normalizeImageAnalysisResult(analysisResult);
      
      // Ensure formattedMessage exists
      if (!analysisResult.formattedMessage) {
        analysisResult.formattedMessage = this.generateFallbackFormattedMessage(analysisResult);
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
   * Normalize image analysis result to ensure it matches the expected format
   */
  private normalizeImageAnalysisResult(result: any): ImageAnalysisResult {
    // Determine image type
    const imageType: 'structured' | 'random' = 
      result.imageType === 'structured' || result.structuredData ? 'structured' : 'random';

    // Build normalized result
    const normalized: ImageAnalysisResult = {
      imageType,
      confidence: this.normalizeConfidence(result.confidence),
      language: result.language || 'other',
      formattedMessage: result.formattedMessage || '' // Will be set by caller if missing
    };

    // Add structured data if present
    if (result.structuredData && imageType === 'structured') {
      normalized.structuredData = {
        type: result.structuredData.type || 'other',
        extractedData: {
          events: result.structuredData.extractedData?.events || [],
          tasks: result.structuredData.extractedData?.tasks || [],
          contacts: result.structuredData.extractedData?.contacts || [],
          notes: result.structuredData.extractedData?.notes || [],
          dates: result.structuredData.extractedData?.dates || [],
          locations: result.structuredData.extractedData?.locations || []
        }
      };
      
      // Generate suggested actions based on extracted data
      normalized.suggestedActions = this.generateSuggestedActions(normalized.structuredData);
    }

    // Add description for random images
    if (imageType === 'random' && result.description) {
      normalized.description = result.description;
    }

    return normalized;
  }

  /**
   * Generate suggested actions based on extracted structured data
   */
  private generateSuggestedActions(structuredData: any): string[] {
    const actions: string[] = [];
    
    if (structuredData.extractedData.events?.length > 0) {
      actions.push('Add event(s) to calendar');
      actions.push('Set reminder for event(s)');
    }
    
    if (structuredData.extractedData.tasks?.length > 0) {
      actions.push('Create task(s) in my task list');
      actions.push('Set reminder for task(s)');
    }
    
    if (structuredData.extractedData.contacts?.length > 0) {
      actions.push('Save contact(s) to my contact list');
    }
    
    if (structuredData.type === 'wedding_invitation' || structuredData.type === 'event_poster') {
      actions.push('Add to calendar');
      actions.push('Set reminder');
    }
    
    if (structuredData.type === 'calendar') {
      actions.push('Extract tasks and add to my task list');
      actions.push('Set reminders for tasks');
    }
    
    if (structuredData.type === 'todo_list') {
      actions.push('Add all items to my task list');
      actions.push('Create tasks with due dates');
    }
    
    return actions.length > 0 ? actions : ['Tell me more about this image'];
  }

  /**
   * Normalize confidence value
   */
  private normalizeConfidence(confidence: any): 'high' | 'medium' | 'low' {
    if (typeof confidence === 'string') {
      const normalized = confidence.toLowerCase();
      if (['high', 'medium', 'low'].includes(normalized)) {
        return normalized as 'high' | 'medium' | 'low';
      }
    }
    return 'medium';
  }

  /**
   * Detect language from text (simple heuristic)
   */
  private detectLanguageFromText(text: string): 'hebrew' | 'english' | 'other' {
    const hebrewRegex = /[\u0590-\u05FF]/;
    const englishRegex = /[a-zA-Z]/;
    
    if (hebrewRegex.test(text)) {
      return 'hebrew';
    }

    if (englishRegex.test(text)) {
      return 'english';
    }
    return 'other';
  }

  /**
   * Default image analysis result for fallback
   */
  private getDefaultImageAnalysisResult(): ImageAnalysisResult {
    return {
      imageType: 'random',
      description: 'I was unable to analyze this image. Please describe what you see or what you would like me to do with it.',
      confidence: 'low',
      formattedMessage: 'I was unable to analyze this image. Please describe what you see or what you would like me to do with it.'
    };
  }

  /**
   * Generate fallback formatted message if LLM didn't provide one
   */
  private generateFallbackFormattedMessage(result: ImageAnalysisResult): string {
    if (result.imageType === 'structured' && result.structuredData) {
      const data = result.structuredData.extractedData;
      const isHebrew = result.language === 'hebrew';
      
      let message = isHebrew 
        ? 'מצאתי מידע מובנה בתמונה:\n\n'
        : 'I found structured information in the image:\n\n';
      
      if (data.events && data.events.length > 0) {
        message += isHebrew ? '📅 אירועים:\n' : '📅 Events:\n';
        data.events.forEach(event => {
          message += `- ${event.title}`;
          if (event.date) message += ` (${event.date})`;
          if (event.time) message += ` at ${event.time}`;
          message += '\n';
        });
        message += '\n';
      }
      
      if (data.tasks && data.tasks.length > 0) {
        message += isHebrew ? '✅ משימות:\n' : '✅ Tasks:\n';
        data.tasks.forEach(task => {
          message += `- ${task.text}`;
          if (task.dueDate) message += ` (${task.dueDate})`;
          message += '\n';
        });
        message += '\n';
      }
      
      if (data.contacts && data.contacts.length > 0) {
        message += isHebrew ? '📞 אנשי קשר:\n' : '📞 Contacts:\n';
        data.contacts.forEach(contact => {
          message += `- ${contact.name}`;
          if (contact.phone) message += ` (${contact.phone})`;
          message += '\n';
        });
        message += '\n';
      }
      
      message += isHebrew
        ? 'תרצה שאוסיף את זה ליומן או לרשימת המשימות?'
        : 'Would you like me to add this to your calendar or task list?';
      
      return message;
    } else {
      return result.description || 'I analyzed your image. Is there anything you\'d like me to help you with?';
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
