import { openai } from '../../config/openai';
import { logger } from '../../utils/logger';
import { FunctionDefinition } from '../../core/types/AgentTypes';
import { AgentName } from '../../core/interfaces/IAgent';

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

export class OpenAIService {
  constructor(private logger: any = logger) {}

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const completion = await openai.chat.completions.create({
        model: request.model || 'gpt-4o',
        messages: request.messages as any,
        functions: request.functions as any,
        function_call: request.functionCall as any,
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens || 500
      });

      return completion as CompletionResponse;
    } catch (error) {
      this.logger.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async detectIntent(message: string, context: any[] = []): Promise<'calendar' | 'gmail' | 'database' | 'multi-task' | 'general'> {
    try {
      // Build context-aware messages for intent detection
      const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [
        {
          role: 'system',
          content: `You are an intelligent conversation analyzer. Your job is to understand the CONVERSATION FLOW and determine what the user is trying to accomplish based on the ENTIRE conversation context, not just individual words.

ANALYSIS APPROACH:
1. Look at the conversation flow and context
2. Understand what the user is trying to achieve
3. Consider the most recent assistant message and how the user is responding
4. Focus on the CONVERSATION INTENT, not specific keywords

INTENT CATEGORIES:

CALENDAR - User is working with scheduling, time management, appointments, events
- Context clues: discussing time, dates, meetings, appointments, scheduling conflicts
- Even short responses like "yes" if the previous message was about calendar operations

GMAIL - User is working with email communication
- Context clues: discussing emails, sending messages, checking inbox, email management
- Even short responses like "ok" if the previous message was about email operations

DATABASE - User is working with personal data management (tasks, contacts, lists, notes)
- Context clues: discussing data storage, retrieval, organization, personal information
- Even short responses like "sure" if the previous message was about data operations
- This includes confirmations to delete/update/create personal data items

MULTI-TASK - User wants to accomplish multiple different things that require different agents
- Context clues: mentioning multiple different types of operations in one request

GENERAL - Everything else: greetings, questions, casual conversation, unclear requests

CRITICAL: Base your decision on CONVERSATION FLOW, not individual words. A simple "yes" can be calendar, database, or gmail depending on what the conversation was about.

Respond with ONLY ONE WORD: calendar, gmail, database, multi-task, or general`
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
        temperature: 0.1, // Slightly higher for more nuanced understanding
        maxTokens: 10
      });

      const intent = completion.choices[0]?.message?.content?.trim().toLowerCase() || 'general';
      
      const validIntents = [AgentName.CALENDAR, AgentName.GMAIL, AgentName.DATABASE, AgentName.MULTI_TASK, 'general'];
      const detectedIntent = validIntents.includes(intent) ? intent : 'general';
      
      this.logger.info(`🎯 Intent detected: ${detectedIntent} (conversation-based with ${context.length} context messages)`);
      return detectedIntent as AgentName.CALENDAR | AgentName.GMAIL | AgentName.DATABASE | AgentName.MULTI_TASK | 'general';
      
    } catch (error) {
      this.logger.error('Error detecting intent:', error);
      return 'general';
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
}
