import { AgentName } from '../../core/interfaces/IAgent';
import { ImageAnalysisResult } from '../../types/imageAnalysis';

export type IntentCategory = AgentName | 'general';

export interface IntentDecision {
  primaryIntent: IntentCategory;
  requiresPlan: boolean;
  involvedAgents: AgentName[];
  confidence?: 'high' | 'medium' | 'low';
}

/**
 * Helper class for OpenAI service utility functions
 * Contains helper methods for model detection, data normalization, and formatting
 */
export class OpenAIFunctionHelper {
  /**
   * Determine if a model should use tools format instead of functions format
   * Newer models (gpt-4o, gpt-4-turbo, gpt-5.x) support tools format
   * Older models only support functions format
   */
  static shouldUseToolsFormat(model: string): boolean {
    // Models that support tools format
    const toolsFormatModels = [
      'gpt-4o',
      'gpt-4-turbo',
      'gpt-4o-mini',
      'gpt-5',
      'gpt-5.1',
      'gpt-3.5-turbo' // Newer versions support tools
    ];
    
    // Check if model starts with any of the tools format model prefixes
    return toolsFormatModels.some(toolsModel => model.startsWith(toolsModel));
  }

  /**
   * Determine if a model requires max_completion_tokens instead of max_tokens
   * Newer models (gpt-5.x) require max_completion_tokens
   */
  static requiresMaxCompletionTokens(model: string): boolean {
    // Models that require max_completion_tokens
    const maxCompletionTokensModels = [
      'gpt-5',
      'gpt-5.1',
      'gpt-5.' // All gpt-5.x versions
    ];
    
    // Check if model starts with any of the models that require max_completion_tokens
    return maxCompletionTokensModels.some(requiredModel => model.startsWith(requiredModel));
  }

  /**
   * Normalize intent decision to ensure it matches the expected format
   */
  static normalizeIntentDecision(candidate: any): IntentDecision {
    const validIntents: IntentCategory[] = [
      AgentName.CALENDAR,
      AgentName.GMAIL,
      AgentName.DATABASE,
      AgentName.SECOND_BRAIN,
      AgentName.MULTI_TASK,
      'general'
    ];

    let primaryIntent: IntentCategory = OpenAIFunctionHelper.defaultIntentDecision().primaryIntent;
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

  /**
   * Default intent decision when detection fails
   */
  static defaultIntentDecision(): IntentDecision {
    return {
      primaryIntent: 'general',
      requiresPlan: false,
      involvedAgents: [],
      confidence: 'medium'
    };
  }

  /**
   * Try to fix malformed JSON by extracting JSON from text
   */
  static tryFixJson(raw: string, logger?: any): any {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        if (logger) logger.error('Failed to coerce intent JSON.', error);
        return {};
      }
    }

    // Attempt to extract JSON from text
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (error) {
        if (logger) logger.error('Failed to parse extracted intent JSON.', error);
      }
    }

    return {};
  }

  /**
   * Normalize image analysis result to ensure it matches the expected format
   */
  static normalizeImageAnalysisResult(result: any): ImageAnalysisResult {
    // Determine image type
    const imageType: 'structured' | 'random' = 
      result.imageType === 'structured' || result.structuredData ? 'structured' : 'random';

    // Build normalized result
    const normalized: ImageAnalysisResult = {
      imageType,
      confidence: OpenAIFunctionHelper.normalizeConfidence(result.confidence),
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
      normalized.suggestedActions = OpenAIFunctionHelper.generateSuggestedActions(normalized.structuredData);
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
  static generateSuggestedActions(structuredData: any): string[] {
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
  static normalizeConfidence(confidence: any): 'high' | 'medium' | 'low' {
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
  static detectLanguageFromText(text: string): 'hebrew' | 'english' | 'other' {
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
  static getDefaultImageAnalysisResult(): ImageAnalysisResult {
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
  static generateFallbackFormattedMessage(result: ImageAnalysisResult): string {
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
}

