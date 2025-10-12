import { openai } from '../config/openai';
import { calendar } from '../config/google';
import { logger } from '../utils/logger';
import { CalendarEvent } from '../types';

const CALENDAR_SYSTEM_PROMPT = `# Role  
You are a calendar agent. Your tasks include creating, retrieving, and deleting events in the user's calendar.  

# Available Functions

1. **createEvent** - Create a new calendar event
   Parameters: { summary: string, start: string (ISO), end: string (ISO), attendees?: string[] }

2. **getEvents** - Get calendar events
   Parameters: { timeMin: string (ISO), timeMax: string (ISO) }

3. **updateEvent** - Update an existing event
   Parameters: { eventId: string, summary?: string, start?: string (ISO), end?: string (ISO) }

4. **deleteEvent** - Delete an event
   Parameters: { eventId: string }

Current date/time: {{NOW}}

When the user asks about their schedule, use getEvents.
When they want to create an appointment, use createEvent.
When modifying or deleting, first get events to find the correct ID.

Always respond in the same language as the user.`;

interface FunctionCall {
  name: string;
  arguments: string;
}

export async function handleCalendarRequest(
  message: string,
  userPhone: string
): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: CALENDAR_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
        },
        {
          role: 'user',
          content: message
        }
      ],
      functions: [
        {
          name: 'createEvent',
          description: 'Create a new calendar event',
          parameters: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'Event title' },
              start: { type: 'string', description: 'Start time in ISO format' },
              end: { type: 'string', description: 'End time in ISO format' },
              attendees: { type: 'array', items: { type: 'string' }, description: 'Email addresses of attendees' }
            },
            required: ['summary', 'start', 'end']
          }
        },
        {
          name: 'getEvents',
          description: 'Get calendar events',
          parameters: {
            type: 'object',
            properties: {
              timeMin: { type: 'string', description: 'Start time in ISO format' },
              timeMax: { type: 'string', description: 'End time in ISO format' }
            },
            required: ['timeMin', 'timeMax']
          }
        },
        {
          name: 'updateEvent',
          description: 'Update an existing calendar event',
          parameters: {
            type: 'object',
            properties: {
              eventId: { type: 'string', description: 'Event ID' },
              summary: { type: 'string', description: 'New event title' },
              start: { type: 'string', description: 'New start time in ISO format' },
              end: { type: 'string', description: 'New end time in ISO format' }
            },
            required: ['eventId']
          }
        },
        {
          name: 'deleteEvent',
          description: 'Delete a calendar event',
          parameters: {
            type: 'object',
            properties: {
              eventId: { type: 'string', description: 'Event ID to delete' }
            },
            required: ['eventId']
          }
        }
      ],
      function_call: 'auto'
    });

    const responseMessage = completion.choices[0]?.message;

    if (responseMessage?.function_call) {
      const functionCall = responseMessage.function_call;
      const args = JSON.parse(functionCall.arguments);

      let result: any;
      switch (functionCall.name) {
        case 'createEvent':
          result = await createEvent(args);
          break;
        case 'getEvents':
          result = await getEvents(args);
          break;
        case 'updateEvent':
          result = await updateEvent(args);
          break;
        case 'deleteEvent':
          result = await deleteEvent(args);
          break;
        default:
          result = { error: 'Unknown function' };
      }

      // Get final response with function result
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: CALENDAR_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
          },
          {
            role: 'user',
            content: message
          },
          responseMessage,
          {
            role: 'function',
            name: functionCall.name,
            content: JSON.stringify(result)
          }
        ]
      });

      return finalCompletion.choices[0]?.message?.content || 'Calendar action completed.';
    }

    return responseMessage?.content || 'Unable to process calendar request.';
  } catch (error) {
    logger.error('Calendar agent error:', error);
    return 'Sorry, I encountered an error with your calendar request.';
  }
}

async function createEvent(params: any) {
  try {
    const event = {
      summary: params.summary,
      start: {
        dateTime: params.start,
        timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
      },
      end: {
        dateTime: params.end,
        timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
      },
      attendees: params.attendees?.map((email: string) => ({ email }))
    };

    const response = await calendar.events.insert({
      calendarId: process.env.GOOGLE_CALENDAR_EMAIL,
      requestBody: event
    });

    return { success: true, eventId: response.data.id, event: response.data };
  } catch (error) {
    logger.error('Error creating event:', error);
    return { success: false, error: 'Failed to create event' };
  }
}

async function getEvents(params: any) {
  try {
    const response = await calendar.events.list({
      calendarId: process.env.GOOGLE_CALENDAR_EMAIL,
      timeMin: params.timeMin,
      timeMax: params.timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return {
      success: true,
      events: response.data.items?.map(event => ({
        id: event.id,
        summary: event.summary,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date
      }))
    };
  } catch (error) {
    logger.error('Error getting events:', error);
    return { success: false, error: 'Failed to get events' };
  }
}

async function updateEvent(params: any) {
  try {
    const updates: any = {};
    if (params.summary) updates.summary = params.summary;
    if (params.start) {
      updates.start = {
        dateTime: params.start,
        timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
      };
    }
    if (params.end) {
      updates.end = {
        dateTime: params.end,
        timeZone: process.env.DEFAULT_TIMEZONE || 'Asia/Jerusalem'
      };
    }

    const response = await calendar.events.patch({
      calendarId: process.env.GOOGLE_CALENDAR_EMAIL,
      eventId: params.eventId,
      requestBody: updates
    });

    return { success: true, event: response.data };
  } catch (error) {
    logger.error('Error updating event:', error);
    return { success: false, error: 'Failed to update event' };
  }
}

async function deleteEvent(params: any) {
  try {
    await calendar.events.delete({
      calendarId: process.env.GOOGLE_CALENDAR_EMAIL,
      eventId: params.eventId
    });

    return { success: true, message: 'Event deleted' };
  } catch (error) {
    logger.error('Error deleting event:', error);
    return { success: false, error: 'Failed to delete event' };
  }
}