import { openai } from '../../config/openai';
import { logger } from '../../utils/logger';
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

  async detectIntent(message: string): Promise<'calendar' | 'gmail' | 'database' | 'planning' | 'study-planning' | 'multi-task' | 'general'> {
    try {
      const completion = await this.createCompletion({
        messages: [
          {
            role: 'system',
            content: `You are an intent classifier. Analyze the user's message and classify it into ONE of these categories:

CALENDAR - For scheduling, appointments, meetings, events, calendar queries
Examples: "Schedule a meeting", "What's on my calendar?", "תקבע פגישה מחר", "Book appointment","תוסיף ליומן"

GMAIL - For sending emails, checking inbox, email-related tasks
Examples: "Send an email to John", "Check my inbox", "שלח מייל", "Reply to Sarah"

DATABASE - For tasks, todos, contacts, lists, notes, reminders, retrieving existing data
Examples: "Add task", "Create contact", "Make a list", "תזכורת", "Save note", "אילו רשימות יש לי", "מה המשימות שלי", "הצג לי הכל"

PLANNING - For complex planning, organizing, project management
Examples: "Plan my week", "Organize my schedule", "תכנן לי את השבוע", "Help me plan a project"

STUDY-PLANNING - For academic planning, study schedules, learning plans
Examples: "Plan my study schedule", "Help me study for exams", "תכנן לי לוח זמנים ללימודים", "Create study plan"

MULTI-TASK - For complex requests involving multiple agents/operations
Examples: "Schedule meeting and send email", "Create task and add to calendar", "תקבע פגישה ותשלח מייל", "תתאם לי פגישה מחר עם שון חזן בשעה עשר בבוקר ותשלח לו מייל"

GENERAL - For conversations, questions, chitchat, anything else
Examples: "Hello", "How are you?", "מה קורה", "Tell me a joke"

Respond with ONLY ONE WORD: calendar, gmail, database, planning, study-planning, multi-task, or general`
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0,
        maxTokens: 10
      });

      const intent = completion.choices[0]?.message?.content?.trim().toLowerCase() || 'general';
      
      const validIntents = ['calendar', 'gmail', 'database', 'general','multi-task','planning','study-planning'];
      const detectedIntent = validIntents.includes(intent) ? intent : 'general';
      
      this.logger.info(`🎯 Intent detected: ${detectedIntent}`);
      return detectedIntent as 'calendar' | 'gmail' | 'database' | 'general' | 'planning' | 'study-planning' | 'multi-task';
      
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
