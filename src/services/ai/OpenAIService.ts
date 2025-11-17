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

export type IntentCategory = AgentName | 'general';

export interface IntentDecision {
  primaryIntent: IntentCategory;
  requiresPlan: boolean;
  involvedAgents: AgentName[];
  confidence?: 'high' | 'medium' | 'low';
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

  async detectIntent(message: string, context: any[] = []): Promise<IntentDecision> {
    try {
      // Build context-aware messages for intent detection
      const messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}> = [
        {
          role: 'system',
      content: `You are an advanced intent classifier for an AI assistant that coordinates specialist agents. Understand the COMPLETE conversation context, including follow-ups and confirmations, and determine HOW the orchestrator should proceed.

AGENT CAPABILITIES (assume prerequisites like Google connection and plan entitlements must be satisfied):
- calendar: create/update/cancel single or recurring events; reschedule meetings; manage attendees and RSVPs; add conference links; attach notes; add/update event reminders; list agendas for specific time ranges; answer availability/what's-on-calendar questions.
- gmail: draft/send/reply/forward emails; generate follow-ups; search mailbox by sender, subject, labels, time ranges; read email bodies and metadata; archive/delete/label messages; handle attachments (summaries, downloads, uploads via provided methods).
- database: manage reminders, tasks, sub-tasks, checklists, shopping lists, notes, and contacts; create/update/delete/list items; mark tasks complete; set due dates, priorities, tags, categories; convert natural language times into structured reminders; look up stored personal information; batch operations across lists.

CLASSIFICATION GOALS:
1. Identify which agents must be involved for the user’s most recent request (include all that execute work).
2. Decide if a coordinated multi-step plan is required. IMPORTANT: Each single agent can already create, update, or delete multiple items in one call:
   - CalendarAgent accepts complex schedules, recurring patterns, and bulk event operations in a single request.
   - GmailAgent can send and manage batches of emails within one operation.
   - DatabaseAgent can batch-create/update/delete lists, tasks, reminders, contacts, etc.
   Therefore, set requiresPlan=true only when the request spans more than one agent, or when previous steps explicitly failed and need a multi-stage recovery. Single-agent bulk operations must have requiresPlan=false.
3. Distinguish general chit-chat or unclear instructions that should use the general conversational model.

FOLLOW-UP HANDLING:
- Pay close attention to the assistant’s most recent messages describing completed steps or asking for confirmation.
- Always connect the user’s follow-up to the latest agent interaction:
  - If the last assistant message was from the calendar agent (or proposing calendar actions) and the user replies "כן", "לא", "תבטל", "תוסיף", etc., treat it as calendar intent.
  - If the last assistant message dealt with tasks/reminders (database agent) and the user responds with confirmation, cancellation, or adjustments, route to database.
  - If the last assistant message was an email preview or Gmail action, confirmations or edits (e.g., "שלח", "תתקן את הנושא") must route back to the Gmail agent.
  - Corrections (e.g., "תעדכן לשעה אחרת") should return to the same agent that produced the previous action rather than starting a new flow.

COMPLEX EXAMPLES:
- "Create a shopping list called Trip Prep, add towels and sunscreen, and remind me tomorrow evening" → primaryIntent: "database", requiresPlan: false, involvedAgents: ["database"] (single agent handles bulk create).
- "Find Tal's phone number and schedule a meeting with her Thursday afternoon" → primaryIntent: "multi-task", requiresPlan: true, involvedAgents: ["database","calendar"].
- "Email Dana the agenda we discussed and add the meeting to my calendar with a 1-hour reminder" → primaryIntent: "multi-task", requiresPlan: true, involvedAgents: ["gmail","calendar"].
- "What's on my calendar this Friday?" → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"].
- "Please reply to the latest email from Ben confirming the shipment" → primaryIntent: "gmail", requiresPlan: false, involvedAgents: ["gmail"].
- Assistant: "The meeting is on your calendar and a draft email is ready. Should I send it?" → User: "כן תשלח" → primaryIntent: "gmail", requiresPlan: false, involvedAgents: ["gmail"].
- Assistant: "האם תרצה שאוסיף את המשימות האלו ליומן שלך?" → User: "כן" → primaryIntent: "calendar", requiresPlan: false, involvedAgents: ["calendar"].
- Assistant: "המשימה הוגדרה. להוסיף אותה ליומן?" → User: "כן" → primaryIntent: "calendar".
- Assistant: "הנה טיוטת המייל. תרצה לשנות משהו?" → User: "תעדכן את הנושא" → primaryIntent: "gmail".
- User: "תזכיר לי מחר בבוקר ביומן לשלם חשבון" → primaryIntent: "calendar".

OUTPUT INSTRUCTIONS:
- Respond with a single JSON object.
- Shape: {"primaryIntent": "<calendar|gmail|database|multi-task|general>", "requiresPlan": <true|false>, "involvedAgents": ["calendar","gmail"], "confidence": "<high|medium|low>"}
- "involvedAgents" must list every agent that must execute work. Use [] for general/no agents.
- Set "requiresPlan": true when the orchestrator should generate or execute a plan (multi-step or multi-agent). Set to false when a single direct agent call is sufficient.
- Use primaryIntent "multi-task" only when the work requires multiple agents or the user explicitly asks for multiple domains. Otherwise use the single agent name.
- Treat reminders/tasks with dates and times as calendar when the user explicitly mentions the calendar (words like "calendar", "יומן", "ביומן", "ליומן") or when the assistant just offered to add them to the calendar and the user agreed. Otherwise use database.
- If unsure or the conversation is casual, set primaryIntent to "general" and requiresPlan to false.`
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
        model: 'gpt-4o-mini'
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
          [AgentName.CALENDAR, AgentName.GMAIL, AgentName.DATABASE, AgentName.MULTI_TASK].includes(value as AgentName)
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
}
