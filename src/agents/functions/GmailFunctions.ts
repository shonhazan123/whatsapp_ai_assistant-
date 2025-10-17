import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { GmailService } from '../../services/email/GmailService';
import { logger } from '../../utils/logger';

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
          return await this.gmailService.sendEmail({
            to: params.to,
            cc: params.cc,
            bcc: params.bcc,
            subject: params.subject,
            body: params.body
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

        case 'getById':
          if (!params.messageId) {
            return { success: false, error: 'Message ID is required for getById operation' };
          }
          return await this.gmailService.getEmailById(params.messageId);

        case 'reply':
          if (!params.messageId || !params.body) {
            return { success: false, error: 'Message ID and body are required for reply operation' };
          }
          return await this.gmailService.replyToEmail({
            messageId: params.messageId,
            body: params.body
          });

        case 'markAsRead':
          if (!params.messageId) {
            return { success: false, error: 'Message ID is required for markAsRead operation' };
          }
          return await this.gmailService.markAsRead(params.messageId);

        case 'markAsUnread':
          if (!params.messageId) {
            return { success: false, error: 'Message ID is required for markAsUnread operation' };
          }
          return await this.gmailService.markAsUnread(params.messageId);

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in GmailFunction:', error);
      return { success: false, error: 'Failed to execute Gmail operation' };
    }
  }
}
