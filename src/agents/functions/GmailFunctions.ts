import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
import { GmailService } from '../../services/email/GmailService';

export class GmailFunction implements IFunction {
  name = 'gmailOperations';
  description = 'Handle all Gmail operations including send, receive, reply, and manage emails';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['send', 'getAll', 'getUnread', 'search', 'getById', 'reply', 'markAsRead', 'markAsUnread'],
        description: 'The operation to perform on emails'
      },
      messageId: {
        type: 'string',
        description: 'Message ID for getById, reply, markAsRead, markAsUnread operations'
      },
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipients email addresses for send operation'
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC email addresses for send operation'
      },
      bcc: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC email addresses for send operation'
      },
      subject: {
        type: 'string',
        description: 'Email subject for send operation'
      },
      body: {
        type: 'string',
        description: 'Email body content for send and reply operations'
      },
      query: {
        type: 'string',
        description: 'Search query for search operation'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results to return'
      }
    },
    required: ['operation']
  };

  constructor(
    private gmailService: GmailService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;
      const resolver = new QueryResolver();

      switch (operation) {
        case 'send':
          if (!params.to || !Array.isArray(params.to) || params.to.length === 0) {
            return { success: false, error: 'Recipients (to) are required for send operation' };
          }
          
          // Validate email addresses
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const invalidEmails = params.to.filter((email: string) => !emailRegex.test(email));
          if (invalidEmails.length > 0) {
            return { success: false, error: `Invalid email addresses: ${invalidEmails.join(', ')}` };
          }
          
          if (!params.subject || !params.body) {
            return { success: false, error: 'Subject and body are required for send operation' };
          }
          
          // Detect language and format email accordingly
          const { subject, body } = this.formatEmailByLanguage(params.subject, params.body);
          
          return await this.gmailService.sendEmail({
            to: params.to,
            cc: params.cc,
            bcc: params.bcc,
            subject: subject,
            body: body
          });

        case 'getAll':
          return await this.gmailService.getEmails({
            maxResults: params.maxResults || 10
          });

        case 'getUnread':
          return await this.gmailService.getUnreadEmails(params.maxResults || 10);

        case 'search':
          if (!params.query) {
            return { success: false, error: 'Search query is required for search operation' };
          }
          return await this.gmailService.searchEmails(params.query, params.maxResults || 10);

        case 'getById': {
          if (!params.messageId) {
            // Natural language: use query to find most relevant email
            const q = params.query || params.subject || params.from || params.to;
            if (!q) return { success: false, error: 'Provide a query/subject/from/to to locate the email' };
            const result = await resolver.resolveOneOrAsk(q, userId, 'email');
            if (result.disambiguation) {
              return { success: false, error: resolver.formatDisambiguation('email', result.disambiguation.candidates) };
            }
            if (!result.entity?.id) return { success: false, error: 'No matching emails found' };
            return await this.gmailService.getEmailById(result.entity.id);
          }
          return await this.gmailService.getEmailById(params.messageId);
        }

        case 'reply': {
          if (!params.body) return { success: false, error: 'Body is required for reply operation' };
          let messageId = params.messageId;
          if (!messageId) {
            const q = params.query || params.subject || params.from || params.to;
            if (!q) return { success: false, error: 'Provide a query/subject/from/to to locate the email to reply' };
            const result = await resolver.resolveOneOrAsk(q, userId, 'email');
            if (result.disambiguation) {
              return { success: false, error: resolver.formatDisambiguation('email', result.disambiguation.candidates) };
            }
            if (!result.entity?.id) return { success: false, error: 'No matching emails found' };
            messageId = result.entity.id;
          }
          return await this.gmailService.replyToEmail({ messageId, body: params.body });
        }

        case 'markAsRead': {
          let messageId = params.messageId;
          if (!messageId) {
            const q = params.query || params.subject || params.from || params.to;
            if (!q) return { success: false, error: 'Provide a query/subject/from/to to locate the email to mark' };
            const result = await resolver.resolveOneOrAsk(q, userId, 'email');
            if (result.disambiguation) {
              return { success: false, error: resolver.formatDisambiguation('email', result.disambiguation.candidates) };
            }
            if (!result.entity?.id) return { success: false, error: 'No matching emails found' };
            messageId = result.entity.id;
          }
          return await this.gmailService.markAsRead(messageId);
        }

        case 'markAsUnread': {
          let messageId = params.messageId;
          if (!messageId) {
            const q = params.query || params.subject || params.from || params.to;
            if (!q) return { success: false, error: 'Provide a query/subject/from/to to locate the email to mark' };
            const result = await resolver.resolveOneOrAsk(q, userId, 'email');
            if (result.disambiguation) {
              return { success: false, error: resolver.formatDisambiguation('email', result.disambiguation.candidates) };
            }
            if (!result.entity?.id) return { success: false, error: 'No matching emails found' };
            messageId = result.entity.id;
          }
          return await this.gmailService.markAsUnread(messageId);
        }

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in GmailFunction:', error);
      return { success: false, error: 'Failed to execute Gmail operation' };
    }
  }

  /**
   * Format email content by language detection
   */
  private formatEmailByLanguage(subject: string, body: string): { subject: string, body: string } {
    // Detect if content is in Hebrew
    const isHebrew = /[\u0590-\u05FF]/.test(subject + body);
    
    if (isHebrew) {
      // Format for Hebrew emails
      return {
        subject: subject,
        body: this.formatHebrewEmailBody(body)
      };
    } else {
      // Format for English emails
      return {
        subject: subject,
        body: this.formatEnglishEmailBody(body)
      };
    }
  }

  /**
   * Format Hebrew email body
   */
  private formatHebrewEmailBody(body: string): string {
    // Don't add extra formatting if body already contains proper structure
    if (body.includes('שלום') && body.includes('בברכה')) {
      return body;
    }
    
    return `שלום,

${body}

בברכה,
המערכת האוטומטית

---
הודעה זו נשלחה אוטומטית מהמערכת.`;
  }

  /**
   * Format English email body
   */
  private formatEnglishEmailBody(body: string): string {
    // Don't add extra formatting if body already contains proper structure
    if (body.includes('Hello') && body.includes('Best regards')) {
      return body;
    }
    
    return `Hello,

${body}

Best regards,
Automated System

---
This message was sent automatically from the system.`;
  }
}
