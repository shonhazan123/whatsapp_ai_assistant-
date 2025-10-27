import { openai } from '../../config/openai';
import { AgentName } from '../../core/interfaces/IAgent';
import { FunctionDefinition } from '../../core/types/AgentTypes';

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

CALENDAR - User EXPLICITLY mentions calendar/יומן OR scheduling meetings with others
- ONLY use this when user explicitly says: "calendar", "יומן", "schedule a meeting", "תזמן פגישה"
- Context clues: "add to calendar", "what's on my calendar", "schedule meeting with [person]"
- Even short responses like "yes" if the previous message asked about adding to calendar
- IMPORTANT: "Remind me" or "תזכיר לי" with date/time should go to DATABASE, not CALENDAR
- IMPORTANT: Tasks with due dates are DATABASE by default, not CALENDAR

GMAIL - User is working with email communication
- Context clues: discussing emails, sending messages, checking inbox, email management
- Even short responses like "ok" if the previous message was about email operations

DATABASE - User is working with reminders, lists , tasks, personal data management
- THIS IS THE DEFAULT for reminders/tasks with dates and times
- Context clues: "remind me", "תזכיר לי", "task", "משימה", "create a reminder"
- Time/date references for reminders/tasks ("tomorrow at 6pm", "next Monday") go here
- This includes ALL reminders with specific times, even if they have dates
- Personal data: contacts, lists, notes, task management
- Even short responses like "sure" if the previous message was about tasks/reminders

MULTI-TASK - User wants to accomplish multiple different things that require different agents
- Context clues: mentioning multiple different types of operations in one request

GENERAL - Everything else: greetings, questions, casual conversation, unclear requests

CRITICAL RULES:
1. REMINDERS WITH DATES/TIMES → DATABASE (this is the DEFAULT behavior)
2. TASKS WITH DUE DATES → DATABASE (unless user explicitly says "calendar")
3. EXPLICIT CALENDAR REQUESTS → CALENDAR (only when user says calendar/יומן)
4. If assistant asked "Would you like to add to calendar?" and user says yes → CALENDAR
5. Base your decision on CONVERSATION FLOW, not individual words

Examples:
- "Remind me tomorrow at 6pm to buy groceries" → DATABASE
- "תזכיר לי מחר ב6 לקנות חלב" → DATABASE  
- "תזכיר לי מחר ב-6:30 משחק פאדל" → DATABASE
- "Add meeting with John tomorrow at 2pm to my calendar" → CALENDAR
- "תוסיף ליומן פגישה עם ג'ון מחר ב2" → CALENDAR
- "What's on my calendar this week?" → CALENDAR
- "מה יש לי ביומן השבוע?" → CALENDAR
- After asking "Would you like to add to calendar?":
  "yes" → CALENDAR
  "כן" → CALENDAR

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
