import { gmail } from '../../config/google';
import { logger } from '../../utils/logger';
import { IResponse } from '../../core/types/AgentTypes';

export interface EmailMessage {
  id?: string;
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: string[];
}

export interface SendEmailRequest {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  attachments?: string[];
}

export interface GetEmailsRequest {
  query?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface ReplyEmailRequest {
  messageId: string;
  body: string;
}

export class GmailService {
  constructor(private logger: any = logger) {}

  async sendEmail(request: SendEmailRequest): Promise<IResponse> {
    try {
      this.logger.info(`📧 Sending email to: ${request.to.join(', ')}`);
      
      // Create email message
      const emailLines = [];
      emailLines.push(`To: ${request.to.join(', ')}`);
      
      if (request.cc && request.cc.length > 0) {
        emailLines.push(`Cc: ${request.cc.join(', ')}`);
      }
      
      if (request.bcc && request.bcc.length > 0) {
        emailLines.push(`Bcc: ${request.bcc.join(', ')}`);
      }
      
      emailLines.push(`Subject: ${request.subject}`);
      emailLines.push('Content-Type: text/html; charset=utf-8');
      emailLines.push('');
      emailLines.push(request.body);

      const email = emailLines.join('\n');
      
      // Encode email in base64
      const encodedEmail = Buffer.from(email).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail
        }
      });

      this.logger.info(`✅ Email sent successfully: ${response.data.id}`);
      
      return {
        success: true,
        data: {
          messageId: response.data.id,
          to: request.to,
          subject: request.subject
        },
        message: 'Email sent successfully'
      };
    } catch (error) {
      this.logger.error('Error sending email:', error);
      return {
        success: false,
        error: 'Failed to send email'
      };
    }
  }

  async getEmails(request: GetEmailsRequest = {}): Promise<IResponse> {
    try {
      this.logger.info(`📧 Getting emails with query: ${request.query || 'all'}`);
      
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: request.query || '',
        maxResults: request.maxResults || 10,
        pageToken: request.pageToken
      });

      const messageIds = response.data.messages?.map(msg => msg.id) || [];
      const emails = [];

      // Get full message details for each email
      for (const messageId of messageIds) {
        if (!messageId) continue;
        try {
          const messageResponse = await gmail.users.messages.get({
            userId: 'me',
            id: messageId
          }) as any;

          const headers = messageResponse.data.payload?.headers || [];
          const getHeader = (name: string) => 
            headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

          const email = {
            id: messageId,
            subject: getHeader('Subject'),
            from: getHeader('From'),
            to: getHeader('To'),
            date: getHeader('Date'),
            snippet: messageResponse.data.snippet,
            threadId: messageResponse.data.threadId
          };

          emails.push(email);
        } catch (error) {
          this.logger.warn(`Failed to get email details for ${messageId}:`, error);
        }
      }

      this.logger.info(`✅ Retrieved ${emails.length} emails`);
      
      return {
        success: true,
        data: {
          emails,
          count: emails.length,
          nextPageToken: response.data.nextPageToken
        }
      };
    } catch (error) {
      this.logger.error('Error getting emails:', error);
      return {
        success: false,
        error: 'Failed to get emails'
      };
    }
  }

  async getUnreadEmails(maxResults: number = 10): Promise<IResponse> {
    return this.getEmails({
      query: 'is:unread',
      maxResults
    });
  }

  async searchEmails(query: string, maxResults: number = 10): Promise<IResponse> {
    return this.getEmails({
      query,
      maxResults
    });
  }

  async getEmailById(messageId: string): Promise<IResponse> {
    try {
      this.logger.info(`📧 Getting email: ${messageId}`);
      
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const headers = response.data.payload?.headers || [];
      const getHeader = (name: string) => 
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      // Extract email body
      let body = '';
      if (response.data.payload?.body?.data) {
        body = Buffer.from(response.data.payload.body.data, 'base64').toString();
      } else if (response.data.payload?.parts) {
        // Handle multipart emails
        for (const part of response.data.payload.parts) {
          if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            if (part.body?.data) {
              body += Buffer.from(part.body.data, 'base64').toString();
            }
          }
        }
      }

      const email = {
        id: messageId,
        subject: getHeader('Subject'),
        from: getHeader('From'),
        to: getHeader('To'),
        cc: getHeader('Cc'),
        bcc: getHeader('Bcc'),
        date: getHeader('Date'),
        body: body,
        snippet: response.data.snippet,
        threadId: response.data.threadId
      };

      this.logger.info(`✅ Retrieved email: ${messageId}`);
      
      return {
        success: true,
        data: email
      };
    } catch (error) {
      this.logger.error('Error getting email by ID:', error);
      return {
        success: false,
        error: 'Failed to get email'
      };
    }
  }

  async replyToEmail(request: ReplyEmailRequest): Promise<IResponse> {
    try {
      this.logger.info(`📧 Replying to email: ${request.messageId}`);
      
      // Get original message to get thread ID and subject
      const originalResponse = await gmail.users.messages.get({
        userId: 'me',
        id: request.messageId
      });

      const headers = originalResponse.data.payload?.headers || [];
      const getHeader = (name: string) => 
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const originalSubject = getHeader('Subject');
      const originalFrom = getHeader('From');
      const threadId = originalResponse.data.threadId;

      // Create reply message
      const replyLines = [];
      replyLines.push(`To: ${originalFrom}`);
      replyLines.push(`Subject: Re: ${originalSubject}`);
      replyLines.push('Content-Type: text/html; charset=utf-8');
      replyLines.push('');
      replyLines.push(request.body);

      const replyEmail = replyLines.join('\n');
      
      // Encode reply in base64
      const encodedReply = Buffer.from(replyEmail).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedReply,
          threadId: threadId
        }
      });

      this.logger.info(`✅ Reply sent successfully: ${response.data.id}`);
      
      return {
        success: true,
        data: {
          messageId: response.data.id,
          threadId: threadId,
          to: originalFrom,
          subject: `Re: ${originalSubject}`
        },
        message: 'Reply sent successfully'
      };
    } catch (error) {
      this.logger.error('Error replying to email:', error);
      return {
        success: false,
        error: 'Failed to reply to email'
      };
    }
  }

  async markAsRead(messageId: string): Promise<IResponse> {
    try {
      this.logger.info(`📧 Marking email as read: ${messageId}`);
      
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });

      this.logger.info(`✅ Email marked as read: ${messageId}`);
      
      return {
        success: true,
        message: 'Email marked as read'
      };
    } catch (error) {
      this.logger.error('Error marking email as read:', error);
      return {
        success: false,
        error: 'Failed to mark email as read'
      };
    }
  }

  async markAsUnread(messageId: string): Promise<IResponse> {
    try {
      this.logger.info(`📧 Marking email as unread: ${messageId}`);
      
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: ['UNREAD']
        }
      });

      this.logger.info(`✅ Email marked as unread: ${messageId}`);
      
      return {
        success: true,
        message: 'Email marked as unread'
      };
    } catch (error) {
      this.logger.error('Error marking email as unread:', error);
      return {
        success: false,
        error: 'Failed to mark email as unread'
      };
    }
  }
}
