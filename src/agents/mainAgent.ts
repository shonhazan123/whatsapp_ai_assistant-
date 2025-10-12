import { openai } from '../config/openai';
import { ConversationMessage } from '../types';
import { getConversationHistory, saveMessage, estimateTokens } from '../services/memory';
import { handleCalendarRequest } from './calanderAgent';
import { handleGmailRequest } from './gmailAgent';
import { handleDatabaseRequest } from './databaseAgent';
import { logger } from '../utils/logger';

// Token limits for different models
const MAX_CONTEXT_TOKENS = 8000; // Leave room for response (gpt-4o-mini has 128k context)
const SYSTEM_PROMPT_TOKENS = 500; // Approximate

const SYSTEM_PROMPT = `Role

You are AI Assistant, a personal scheduling agent. You turn free-form user requests into precise task actions and synchronize them with Google Calendar tool named as Calendar_Agent and use all the Email queries with the Gmail_agent.

Core Objectives

- Understand user intent from plain text or voice-to-text.
- Break requests into one or more actionable tasks with sensible times.
- Write updates to Google Calendar (create/update/complete).
- Add reminders only if explicitly requested.
- If time/date is vague (e.g., "tomorrow morning"), infer sensible defaults.

Current Date and Time: {{NOW}}

Mirror the user's language in the final summary text.

Timezone & Language

Assume user timezone: Asia/Jerusalem (UTC+03:00) unless an explicit timezone is provided.
Detect the user's language from the latest message. Use that language for responses.

Natural-Language Time Defaults (if user does not specify exact time)

- Morning → 09:00–12:00 (default start: 09:00)
- Afternoon → 13:00–17:00 (default start: 14:00)
- Evening → 18:00–21:00 (default start: 19:00)
- Tonight → 20:00–23:00 (default start: 20:00)
- This weekend → Saturday 10:00
- If only a date is given (no time) → default start 10:00
- Duration default: 30 minutes unless clearly implied otherwise

Tools:

Gmail_Agent: Use for all Email requests, get email send email etc.
Calendar_Agent: Use for all calendar requests. Make sure the user asked for calendar calls before using this tool.

In your response use a nice hard working assistant tone.`;

/**
 * Process incoming message with intelligent context management
 * 
 * Best Practices Implemented:
 * 1. Sliding window for conversation history
 * 2. Token counting and optimization
 * 3. Graceful degradation if DB fails
 * 4. Async saves for better performance
 * 5. Intent-based routing
 */
export async function processMessage(
  userPhone: string,
  messageText: string
): Promise<string> {
  try {
    // Step 1: Get conversation history with fallback
    let history = await getConversationHistory(userPhone).catch((err) => {
      logger.warn('Database unavailable, continuing without conversation history:', err.message);
      return [];
    });
    
    // Step 2: Token management - ensure we don't exceed limits
    let historyTokens = estimateTokens(history);
    const messageTokens = estimateTokens([{ role: 'user', content: messageText }]);
    const availableTokens = MAX_CONTEXT_TOKENS - SYSTEM_PROMPT_TOKENS - messageTokens;

    // If history is too long, trim it (keep most recent messages)
    while (historyTokens > availableTokens && history.length > 0) {
      history.shift(); // Remove oldest message
      historyTokens = estimateTokens(history);
    }

    logger.info(`Context: ${history.length} messages, ~${historyTokens + messageTokens} tokens`);
    
    // Step 3: Save user message (async, non-blocking)
    saveMessage(userPhone, 'user', messageText).catch(err => 
      logger.warn('Could not save user message:', err.message)
    );

    // Step 4: Build context for AI
    const systemMessage = SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString());
    const messages: ConversationMessage[] = [
      {
        role: 'system',
        content: systemMessage
      },
      ...history,
      {
        role: 'user',
        content: messageText
      }
    ];

    // Step 5: Determine intent and route to appropriate agent
    const intent = await detectIntent(messageText);
    logger.info(`Detected intent: ${intent}`);
    
    let response: string;

    // Route to specialized agents or general conversation
    if (intent === 'calendar') {
      response = await handleCalendarRequest(messageText, userPhone);
    } else if (intent === 'email') {
      response = await handleGmailRequest(messageText, userPhone);
    } else if (intent === 'database') {
      response = await handleDatabaseRequest(messageText, userPhone);
    } else {
      // General conversation with full context
      response = await getGeneralResponse(messages);
    }

    // Step 6: Save assistant response (async, non-blocking)
    saveMessage(userPhone, 'assistant', response).catch(err =>
      logger.warn('Could not save assistant response:', err.message)
    );

    return response;
  } catch (error) {
    logger.error('Error processing message:', error);
    return 'Sorry, I encountered an error processing your request. Please try again.';
  }
}

async function detectIntent(message: string): Promise<'calendar' | 'email' | 'database' | 'general'> {
  const calendarKeywords = ['calendar', 'schedule', 'meeting', 'appointment', 'event', 'לוח שנה', 'פגישה', 'תזמן', 'אירוע','יומן'];
  const emailKeywords = ['email', 'mail', 'send', 'inbox', 'message', 'אימייל', 'מייל', 'שלח', 'הודעה'];
  const databaseKeywords = ['task', 'משימה', 'תזכיר', 'contact', 'איש קשר', 'list', 'רשימה', 'subtask', 'תת משימה', 'note', 'פתק'];
  
  const lowerMessage = message.toLowerCase();
  
  const hasCalendar = calendarKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  const hasEmail = emailKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  const hasDatabase = databaseKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  
  if (hasCalendar) return 'calendar';
  if (hasEmail) return 'email';
  if (hasDatabase) return 'database';
  return 'general';
}

async function getGeneralResponse(messages: ConversationMessage[]): Promise<string> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: messages as any,
    temperature: 0.7,
    max_tokens: 500
  });

  return completion.choices[0]?.message?.content || 'I could not generate a response.';
}