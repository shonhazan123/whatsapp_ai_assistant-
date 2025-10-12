import { openai } from '../config/openai';
import { gmail } from '../config/google';
import { logger } from '../utils/logger';

const GMAIL_SYSTEM_PROMPT = `# ROLE  
You are an EMAIL AGENT. You help users read, reply, filter, organize, and create emails intelligently.

# Available Functions

1. **getEmails** - Retrieve emails with filters
   Parameters: { limit?: number, sender?: string, after?: string (ISO), before?: string (ISO), search?: string }

2. **sendEmail** - Send a new email
   Parameters: { to: string, subject: string, message: string }

3. **replyToEmail** - Reply to an email
   Parameters: { messageId: string, message: string }

4. **markAsRead** - Mark email as read
   Parameters: { messageId: string }

5. **markAsUnread** - Mark email as unread
   Parameters: { messageId: string }

Current time: {{NOW}}

When user asks about emails, use getEmails with appropriate filters.
Always present emails in a numbered list format.
Be concise and helpful.
Respond in the user's language.`;

export async function handleGmailRequest(
  message: string,
  userPhone: string
): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: GMAIL_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
        },
        {
          role: 'user',
          content: message
        }
      ],
      functions: [
        {
          name: 'getEmails',
          description: 'Get emails with optional filters',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max emails to return', default: 10 },
              sender: { type: 'string', description: 'Filter by sender email' },
              after: { type: 'string', description: 'Received after date (ISO)' },
              before: { type: 'string', description: 'Received before date (ISO)' },
              search: { type: 'string', description: 'Search query' }
            }
          }
        },
        {
          name: 'sendEmail',
          description: 'Send a new email',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              message: { type: 'string', description: 'Email body' }
            },
            required: ['to', 'subject', 'message']
          }
        },
        {
          name: 'replyToEmail',
          description: 'Reply to an email',
          parameters: {
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'Message ID to reply to' },
              message: { type: 'string', description: 'Reply content' }
            },
            required: ['messageId', 'message']
          }
        },
        {
          name: 'markAsRead',
          description: 'Mark email as read',
          parameters: {
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'Message ID' }
            },
            required: ['messageId']
          }
        },
        {
          name: 'markAsUnread',
          description: 'Mark email as unread',
          parameters: {
            type: 'object',
            properties: {
              messageId: { type: 'string', description: 'Message ID' }
            },
            required: ['messageId']
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
        case 'getEmails':
          result = await getEmails(args);
          break;
        case 'sendEmail':
          result = await sendEmail(args);
          break;
        case 'replyToEmail':
          result = await replyToEmail(args);
          break;
        case 'markAsRead':
          result = await markAsRead(args);
          break;
        case 'markAsUnread':
          result = await markAsUnread(args);
          break;
        default:
          result = { error: 'Unknown function' };
      }

      // Get final response
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: GMAIL_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
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

      return finalCompletion.choices[0]?.message?.content || 'Email action completed.';
    }

    return responseMessage?.content || 'Unable to process email request.';
  } catch (error) {
    logger.error('Gmail agent error:', error);
    return 'Sorry, I encountered an error with your email request.';
  }
}

async function getEmails(params: any) {
  try {
    let query = '';
    if (params.sender) query += `from:${params.sender} `;
    if (params.after) query += `after:${params.after.split('T')[0]} `;
    if (params.before) query += `before:${params.before.split('T')[0]} `;
    if (params.search) query += params.search;

    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query.trim() || undefined,
      maxResults: params.limit || 10
    });

    if (!response.data.messages) {
      return { success: true, emails: [] };
    }

    const emails = await Promise.all(
      response.data.messages.map(async (msg) => {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });

        const headers = details.data.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        return {
          id: msg.id,
          from,
          subject,
          date,
          snippet: details.data.snippet
        };
      })
    );

    return { success: true, emails };
  } catch (error) {
    logger.error('Error getting emails:', error);
    return { success: false, error: 'Failed to get emails' };
  }
}

async function sendEmail(params: any) {
  try {
    const email = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      '',
      params.message
    ].join('\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    logger.error('Error sending email:', error);
    return { success: false, error: 'Failed to send email' };
  }
}

async function replyToEmail(params: any) {
  try {
    const originalMessage = await gmail.users.messages.get({
      userId: 'me',
      id: params.messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Message-ID']
    });

    const headers = originalMessage.data.payload?.headers || [];
    const to = headers.find(h => h.name === 'From')?.value || '';
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const threadId = originalMessage.data.threadId;

    const email = [
      `To: ${to}`,
      `Subject: Re: ${subject}`,
      '',
      params.message
    ].join('\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail,
        threadId: threadId || undefined
      }
    });

    return { success: true, message: 'Reply sent successfully' };
  } catch (error) {
    logger.error('Error replying to email:', error);
    return { success: false, error: 'Failed to send reply' };
  }
}

async function markAsRead(params: any) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: params.messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });

    return { success: true, message: 'Email marked as read' };
  } catch (error) {
    logger.error('Error marking as read:', error);
    return { success: false, error: 'Failed to mark as read' };
  }
}

async function markAsUnread(params: any) {
  try {
    await gmail.users.messages.modify({
      userId: 'me',
      id: params.messageId,
      requestBody: {
        addLabelIds: ['UNREAD']
      }
    });

    return { success: true, message: 'Email marked as unread' };
  } catch (error) {
    logger.error('Error marking as unread:', error);
    return { success: false, error: 'Failed to mark as unread' };
  }
}