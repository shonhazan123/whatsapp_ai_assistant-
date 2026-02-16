import { gmail_v1, google } from 'googleapis';
import { RequestContext } from '../../core/context/RequestContext';
import { IResponse } from '../../core/types/AgentTypes';
import { RequestUserContext } from '../../types/UserContext';
import { UpsertGoogleTokenPayload, UserService } from '../database/UserService';
import { logger } from '../../utils/logger';

export interface EmailAttachment {
  filename: string;
  mimeType?: string;
  size?: number;
  attachmentId?: string;
}

export interface EmailBody {
  textPlain?: string;
  textHtml?: string;
}

export interface EmailHeadersMap {
  [key: string]: string;
}

export interface EmailSummary {
  id: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string[];
  toHeader?: string;
  cc?: string[];
  ccHeader?: string;
  bcc?: string[];
  bccHeader?: string;
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  labelIds?: string[];
  headers?: EmailHeadersMap;
  body?: EmailBody;
  attachments?: EmailAttachment[];
}

export interface EmailDetail extends EmailSummary {
  headers: EmailHeadersMap;
}

export interface EmailListOptions {
  query?: string;
  from?: string;
  to?: string;
  subjectContains?: string;
  textContains?: string;
  labelIds?: string[];
  maxResults?: number;
  pageToken?: string;
  includeBody?: boolean;
  includeHeaders?: boolean;
}

export interface EmailListData {
  emails: EmailSummary[];
  count: number;
  nextPageToken?: string;
  query?: string;
}

export interface GetEmailsRequest {
  query?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface SendEmailRequest {
  to: string[];
  subject: string;
  body?: string;
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: EmailAttachment[];
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface SendEmailOptions {
  previewOnly?: boolean;
}

export interface ReplyEmailRequest {
  messageId: string;
  body?: string;
  bodyHtml?: string;
  bodyText?: string;
  cc?: string[];
  bcc?: string[];
  toOverride?: string[];
  subjectOverride?: string;
}

export interface ReplyEmailOptions extends SendEmailOptions {}

export interface ThreadMessagesOptions {
  limit?: number;
  includeBody?: boolean;
  includeHeaders?: boolean;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  (process.env.APP_PUBLIC_URL ? `${process.env.APP_PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback` : undefined);

export class GmailService {
  private userService: UserService;

  constructor(private logger: any = logger) {
    this.userService = new UserService(logger);
  }

  // getRequestContext() removed - context is now passed as parameter to all methods

  private buildOAuthClient(context: RequestUserContext) {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth client is not configured properly.');
    }
    if (!context.googleTokens) {
      throw new Error('Google account is not connected for this user.');
    }

    const oauthClient = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );

    const credentials: {
      access_token?: string;
      refresh_token?: string;
      expiry_date?: number;
      token_type?: string;
    } = {};

    if (context.googleTokens.access_token) {
      credentials.access_token = context.googleTokens.access_token;
    }
    if (context.googleTokens.refresh_token) {
      credentials.refresh_token = context.googleTokens.refresh_token;
    }
    if (context.googleTokens.expires_at) {
      credentials.expiry_date = new Date(context.googleTokens.expires_at).getTime();
    }
    if (context.googleTokens.token_type) {
      credentials.token_type = context.googleTokens.token_type;
    }

    oauthClient.setCredentials(credentials);
    oauthClient.on('tokens', tokens => {
      this.persistTokens(tokens, context).catch(error =>
        this.logger.error('Failed to persist Gmail tokens after refresh', error)
      );
    });

    return oauthClient;
  }

  private buildGmail(context: RequestUserContext): gmail_v1.Gmail {
    const oauthClient = this.buildOAuthClient(context);
    return google.gmail({ version: 'v1', auth: oauthClient });
  }

  private async persistTokens(tokens: any, context: RequestUserContext): Promise<void> {
    const payload: UpsertGoogleTokenPayload = {
      accessToken: tokens.access_token ?? context.googleTokens?.access_token ?? null,
      refreshToken: tokens.refresh_token ?? context.googleTokens?.refresh_token ?? null,
      expiresAt: tokens.expiry_date ?? context.googleTokens?.expires_at ?? null,
      scope: tokens.scope
        ? Array.isArray(tokens.scope)
          ? tokens.scope
          : tokens.scope.split(' ')
        : context.googleTokens?.scope ?? null,
      tokenType: tokens.token_type ?? context.googleTokens?.token_type ?? null
    };

    const updatedTokens = await this.userService.upsertGoogleTokens(context.user.id, payload);
    context.googleTokens = updatedTokens;
  }

  async listEmails(context: RequestUserContext, options: EmailListOptions = {}): Promise<IResponse> {
    try {
      const { maxResults = 10, pageToken, includeBody = false, includeHeaders = false } = options;
      const query = options.query ?? this.buildSearchQuery(options);

      this.logger.info(`📧 Listing emails with query: ${query || 'all'} | maxResults=${maxResults}`);

      const gmailClient = this.buildGmail(context);

      const response = await gmailClient.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
        pageToken
      });

      const messages = response.data.messages ?? [];
      if (messages.length === 0) {
        return {
          success: true,
          data: {
            emails: [],
            count: 0,
            nextPageToken: response.data.nextPageToken,
            query
          }
        };
      }

      const parsed = await Promise.all(
        messages.map(async (message) => {
          if (!message.id) return null;
          return this.fetchAndParseMessage(gmailClient, message.id, {
            includeBody,
            includeHeaders
          });
        })
      );

      const emails = parsed.filter((item): item is EmailSummary => Boolean(item));

      return {
        success: true,
        data: {
          emails,
          count: emails.length,
          nextPageToken: response.data.nextPageToken,
          query
        }
      };
    } catch (error) {
      this.logger.error('Error listing emails:', error);
      return {
        success: false,
        error: 'Failed to list emails'
      };
    }
  }

  async getLatestEmail(context: RequestUserContext, options: EmailListOptions = {}): Promise<IResponse> {
    try {
      const listResponse = await this.listEmails(context, {
        ...options,
        maxResults: 1,
        includeBody: true,
        includeHeaders: true
      });

      if (!listResponse.success) {
        return listResponse;
      }

      const listData = listResponse.data as EmailListData;
      const email = listData.emails[0];

      if (!email) {
        return {
          success: false,
          error: 'No emails found'
        };
      }

      return {
        success: true,
        data: {
          email
        }
      };
    } catch (error) {
      this.logger.error('Error getting latest email:', error);
      return {
        success: false,
        error: 'Failed to get latest email'
      };
    }
  }

  async getEmails(context: RequestUserContext, request: GetEmailsRequest = {}): Promise<IResponse> {
    return this.listEmails(context, {
      query: request.query,
      maxResults: request.maxResults,
      pageToken: request.pageToken
    });
  }

  async getUnreadEmails(context: RequestUserContext, maxResults: number = 10): Promise<IResponse> {
    return this.listEmails(context, {
      query: 'is:unread',
      maxResults,
      includeBody: true,
      includeHeaders: true
    });
  }

  async searchEmails(context: RequestUserContext, query: string, maxResults: number = 10): Promise<IResponse> {
    return this.listEmails(context, {
      query,
      maxResults,
      includeBody: true,
      includeHeaders: true
    });
  }

  async getEmailById(context: RequestUserContext, messageId: string, options: { includeBody?: boolean; includeHeaders?: boolean } = {}): Promise<IResponse> {
    try {
      this.logger.info(`📧 Fetching email by id: ${messageId}`);

      const gmailClient = this.buildGmail(context);

      const email = await this.fetchAndParseMessage(gmailClient, messageId, {
        includeBody: options.includeBody ?? true,
        includeHeaders: options.includeHeaders ?? true
      });

      if (!email) {
        return {
          success: false,
          error: 'Email not found'
        };
      }

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

  async getThreadMessages(context: RequestUserContext, threadId: string, options: ThreadMessagesOptions = {}): Promise<IResponse> {
    try {
      this.logger.info(`📧 Fetching thread messages for thread: ${threadId}`);

      const gmailClient = this.buildGmail(context);

      const response = await gmailClient.users.threads.get({
        userId: 'me',
        id: threadId,
        format: options.includeBody || options.includeHeaders ? 'full' : 'metadata'
      });

      const messages = response.data.messages ?? [];
      const sorted = [...messages].sort((a, b) => {
        const aDate = Number(a.internalDate || 0);
        const bDate = Number(b.internalDate || 0);
        return aDate - bDate;
      });

      const parsedMessages: EmailSummary[] = [];
      for (const message of sorted) {
        if (!message.id) {
          continue;
        }
        const parsed = this.parseMessage(message as gmail_v1.Schema$Message, {
          includeBody: options.includeBody,
          includeHeaders: options.includeHeaders
        });
        parsedMessages.push(parsed);
      }

      const limited = typeof options.limit === 'number' ? parsedMessages.slice(-options.limit) : parsedMessages;

      return {
        success: true,
        data: {
          threadId,
          messages: limited,
          count: limited.length
        }
      };
    } catch (error) {
      this.logger.error('Error fetching thread messages:', error);
      return {
        success: false,
        error: 'Failed to get thread messages'
      };
    }
  }

  async sendEmail(context: RequestUserContext, request: SendEmailRequest, options: SendEmailOptions = {}): Promise<IResponse> {
    try {
      const { previewOnly = false } = options;

      if (!request.to || request.to.length === 0) {
        return {
          success: false,
          error: 'At least one recipient is required'
        };
      }

      this.logger.info(`📧 Preparing email to: ${request.to.join(', ')}`);

      const bodyHtml = request.bodyHtml ?? request.body;
      if (!bodyHtml) {
        return {
          success: false,
          error: 'Email body is required'
        };
      }

      const payload = this.composeEmailPayload({
        ...request,
        bodyHtml
      });

      if (previewOnly) {
        this.logger.info('ℹ️ Returning email preview (no send)');
        return {
          success: true,
          data: {
            preview: {
              to: request.to,
              cc: request.cc,
              bcc: request.bcc,
              subject: request.subject,
              bodyHtml,
              bodyText: request.bodyText,
              threadId: request.threadId,
              inReplyTo: request.inReplyTo,
              references: request.references
            },
            raw: payload.encoded
          },
          message: 'Email draft prepared'
        };
      }

      const gmailClient = this.buildGmail(context);

      const response = await gmailClient.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: payload.encoded,
          threadId: request.threadId
        }
      });

      this.logger.info(`✅ Email sent successfully: ${response.data.id}`);

      return {
        success: true,
        data: {
          messageId: response.data.id,
          threadId: response.data.threadId ?? request.threadId,
          to: request.to,
          cc: request.cc,
          bcc: request.bcc,
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

  async replyToEmail(context: RequestUserContext, request: ReplyEmailRequest, options: ReplyEmailOptions = {}): Promise<IResponse> {
    try {
      const { previewOnly = false } = options;

      this.logger.info(`📧 Preparing reply for message: ${request.messageId}`);

      const gmailClient = this.buildGmail(context);

      const original = await gmailClient.users.messages.get({
        userId: 'me',
        id: request.messageId,
        format: 'metadata'
      });

      const headersArray = original.data.payload?.headers ?? [];
      const headersMap = this.headersArrayToMap(headersArray);

      const replyTo = request.toOverride && request.toOverride.length > 0
        ? request.toOverride
        : this.parseAddressList(headersMap['reply-to'] || headersMap.from);

      if (!replyTo || replyTo.length === 0) {
        return {
          success: false,
          error: 'Unable to determine reply recipient'
        };
      }

      const originalSubject = headersMap.subject ?? '';
      const subject = request.subjectOverride ?? this.formatReplySubject(originalSubject);
      const originalMessageId = headersMap['message-id'];
      const referencesHeader = headersMap.references;
      const references = [
        ...(referencesHeader ? referencesHeader.split(' ') : []),
        originalMessageId
      ].filter(Boolean);

      const sendRequest: SendEmailRequest = {
        to: replyTo,
        cc: request.cc ?? this.parseAddressList(headersMap.cc),
        bcc: request.bcc ?? this.parseAddressList(headersMap.bcc),
        subject,
        bodyHtml: request.bodyHtml ?? request.body,
        bodyText: request.bodyText,
        threadId: original.data.threadId ?? undefined,
        inReplyTo: originalMessageId,
        references
      };

      return this.sendEmail(context, sendRequest, { previewOnly });
    } catch (error) {
      this.logger.error('Error preparing reply email:', error);
      return {
        success: false,
        error: 'Failed to reply to email'
      };
    }
  }

  async markAsRead(context: RequestUserContext, messageId: string): Promise<IResponse> {
    try {
      this.logger.info(`📧 Marking email as read: ${messageId}`);

      const gmailClient = this.buildGmail(context);

      await gmailClient.users.messages.modify({
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

  async markAsUnread(context: RequestUserContext, messageId: string): Promise<IResponse> {
    try {
      this.logger.info(`📧 Marking email as unread: ${messageId}`);

      const gmailClient = this.buildGmail(context);

      await gmailClient.users.messages.modify({
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

  private async fetchAndParseMessage(
    gmailClient: gmail_v1.Gmail,
    messageId: string,
    options: { includeBody?: boolean; includeHeaders?: boolean } = {}
  ): Promise<EmailSummary | null> {
    try {
      const response = await gmailClient.users.messages.get({
        userId: 'me',
        id: messageId,
        format: options.includeBody || options.includeHeaders ? 'full' : 'metadata'
      });

      return this.parseMessage(response.data, options);
    } catch (error) {
      this.logger.warn(`Failed to fetch message ${messageId}:`, error);
      return null;
    }
  }

  private parseMessage(
    message: gmail_v1.Schema$Message,
    options: { includeBody?: boolean; includeHeaders?: boolean } = {}
  ): EmailSummary {
    const headersArray = message.payload?.headers ?? [];
    const headersMap = this.headersArrayToMap(headersArray);

    const summary: EmailSummary = {
      id: message.id ?? '',
      threadId: message.threadId ?? undefined,
      subject: headersMap.subject,
      from: headersMap.from,
      to: this.parseAddressList(headersMap.to),
      toHeader: headersMap.to,
      cc: this.parseAddressList(headersMap.cc),
      ccHeader: headersMap.cc,
      bcc: this.parseAddressList(headersMap.bcc),
      bccHeader: headersMap.bcc,
      snippet: message.snippet ?? undefined,
      historyId: message.historyId ?? undefined,
      internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : undefined,
      labelIds: message.labelIds ?? undefined
    };

    if (options.includeHeaders) {
      summary.headers = headersMap;
    }

    if (options.includeBody) {
      const { body, attachments } = this.extractBodyAndAttachments(message.payload);
      summary.body = body;
      if (attachments.length > 0) {
        summary.attachments = attachments;
      }
    }

    return summary;
  }

  private buildSearchQuery(options: EmailListOptions): string {
    const tokens: string[] = [];

    if (options.from) {
      tokens.push(`from:(${options.from})`);
    }

    if (options.to) {
      tokens.push(`to:(${options.to})`);
    }

    if (options.subjectContains) {
      tokens.push(`subject:(${options.subjectContains})`);
    }

    if (options.textContains) {
      tokens.push(options.textContains);
    }

    if (options.labelIds && options.labelIds.length > 0) {
      tokens.push(options.labelIds.map((label) => `label:${label}`).join(' '));
    }

    return tokens.join(' ').trim();
  }

  private headersArrayToMap(headers: gmail_v1.Schema$MessagePartHeader[] = []): EmailHeadersMap {
    const map: EmailHeadersMap = {};
    for (const header of headers) {
      if (!header.name) continue;
      map[header.name.toLowerCase()] = header.value ?? '';
    }
    return map;
  }

  private parseAddressList(value?: string): string[] | undefined {
    if (!value) return undefined;
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private extractBodyAndAttachments(
    payload?: gmail_v1.Schema$MessagePart
  ): { body: EmailBody; attachments: EmailAttachment[] } {
    const body: EmailBody = {};
    const attachments: EmailAttachment[] = [];

    if (!payload) {
      return { body, attachments };
    }

    const walk = (part?: gmail_v1.Schema$MessagePart) => {
      if (!part) return;
      const mimeType = (part.mimeType || '').toLowerCase();

      if (part.body?.attachmentId) {
        attachments.push({
          filename: part.filename || 'attachment',
          mimeType: mimeType || undefined,
          size: typeof part.body.size === 'number' ? part.body.size : undefined,
          attachmentId: part.body.attachmentId ?? undefined
        });
      }

      if (part.body?.data) {
        const decoded = this.decodeBase64(part.body.data);
        if (mimeType === 'text/plain') {
          body.textPlain = (body.textPlain || '') + decoded;
        } else if (mimeType === 'text/html') {
          body.textHtml = (body.textHtml || '') + decoded;
        } else if (!mimeType && !part.filename) {
          // Fallback for simple emails
          body.textPlain = (body.textPlain || '') + decoded;
        }
      }

      if (part.parts && part.parts.length > 0) {
        part.parts.forEach(walk);
      }
    };

    walk(payload);
    return { body, attachments };
  }

  private composeEmailPayload(request: SendEmailRequest & { bodyHtml: string }): { encoded: string } {
    const lines: string[] = [];

    lines.push(`To: ${request.to.join(', ')}`);

    if (request.cc && request.cc.length > 0) {
      lines.push(`Cc: ${request.cc.join(', ')}`);
    }

    if (request.bcc && request.bcc.length > 0) {
      lines.push(`Bcc: ${request.bcc.join(', ')}`);
    }

    if (request.inReplyTo) {
      lines.push(`In-Reply-To: ${request.inReplyTo}`);
    }

    if (request.references && request.references.length > 0) {
      lines.push(`References: ${request.references.join(' ')}`);
    }

    lines.push(`Subject: ${this.encodeSubject(request.subject)}`);
    lines.push('MIME-Version: 1.0');

    if (request.bodyText) {
      const boundary = `=_mixed_${Date.now()}`;
      lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      lines.push('');
      lines.push(`--${boundary}`);
      lines.push('Content-Type: text/plain; charset="UTF-8"');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(request.bodyText);
      lines.push('');
      lines.push(`--${boundary}`);
      lines.push('Content-Type: text/html; charset="UTF-8"');
      lines.push('Content-Transfer-Encoding: 7bit');
      lines.push('');
      lines.push(request.bodyHtml);
      lines.push('');
      lines.push(`--${boundary}--`);
    } else {
      lines.push('Content-Type: text/html; charset="UTF-8"');
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(this.encodeBodyToBase64(request.bodyHtml));
    }

    const email = lines.join('\r\n');
    const encoded = this.encodeToBase64Url(email);

    return { encoded };
  }

  private encodeSubject(subject: string): string {
    const needsEncoding = /[^\u0000-\u007f]/.test(subject);
    if (!needsEncoding) {
      return subject;
    }
    return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  }

  private encodeBodyToBase64(body: string): string {
    return Buffer.from(body, 'utf8').toString('base64');
  }

  private encodeToBase64Url(value: string): string {
    return Buffer.from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private decodeBase64(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4;
    const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  private formatReplySubject(subject: string): string {
    const trimmed = subject.trim();
    if (/^re:/i.test(trimmed)) {
      return trimmed;
    }
    return `Re: ${trimmed}`;
  }
}

