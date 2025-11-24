import { randomUUID } from 'crypto';
import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
import {
  EmailListData,
  EmailListOptions,
  EmailSummary,
  GmailService,
  ReplyEmailRequest,
  SendEmailRequest
} from '../../services/email/GmailService';

export class GmailFunction implements IFunction {
  name = 'gmailOperations';
  description = 'Handle all Gmail operations including send, receive, reply, and manage emails';
  private emailListCache: Map<string, EmailSummary[]> = new Map();
  private draftCache: Map<string, PendingDraft> = new Map();
  private lastDraftByType: Map<string, { send?: DraftMetadata; reply?: DraftMetadata }> = new Map();

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [
          'listEmails',
          'getLatestEmail',
          'getEmailById',
          'sendPreview',
          'sendConfirm',
          'replyPreview',
          'replyConfirm',
          'markAsRead',
          'markAsUnread'
        ],
        description: 'The operation to perform on emails'
      },
      filters: {
        type: 'object',
        description: 'Filter options for listing emails',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          subjectContains: { type: 'string' },
          textContains: { type: 'string' },
          labelIds: {
            type: 'array',
            items: { type: 'string' }
          },
          maxResults: { type: 'number' },
          includeBody: { type: 'boolean' },
          includeHeaders: { type: 'boolean' }
        }
      },
      messageId: {
        type: 'string',
        description: 'Message ID for getEmailById, reply, markAsRead, markAsUnread operations'
      },
      to: {
        type: 'array',
        items: { type: 'string' },
        description: 'Recipient email addresses for send operation'
      },
      cc: {
        type: 'array',
        items: { type: 'string' },
        description: 'CC email addresses'
      },
      bcc: {
        type: 'array',
        items: { type: 'string' },
        description: 'BCC email addresses'
      },
      subject: {
        type: 'string',
        description: 'Email subject line'
      },
      body: {
        type: 'string',
        description: 'Email body content'
      },
      bodyText: {
        type: 'string',
        description: 'Plain-text version of the email body'
      },
      previewOnly: {
        type: 'boolean',
        description: 'Return draft preview instead of sending immediately'
      },
      draftId: {
        type: 'string',
        description: 'Identifier of a previously prepared draft to confirm sending'
      },
      selectionIndex: {
        type: 'number',
        description: 'Index of email from last list response (1-based)'
      },
      query: {
        type: 'string',
        description: 'Search text used for disambiguation when messageId missing'
      },
      from: {
        type: 'string',
        description: 'Sender email used for disambiguation when messageId missing'
      },
      toHint: {
        type: 'string',
        description: 'Recipient hint used for disambiguation when messageId missing'
      },
      subjectHint: {
        type: 'string',
        description: 'Subject hint used for disambiguation when messageId missing'
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
      this.logger.info(`[GmailFunction] execute → operation=${operation} user=${userId}`);

      switch (operation) {
        case 'listEmails': {
          const listOptions = this.buildListOptions(params.filters);
          this.logger.debug(`[GmailFunction] listEmails filters=${JSON.stringify(listOptions)}`);
          const response = await this.gmailService.listEmails(listOptions);
          this.cacheEmailList(userId, response);
          return response;
        }

        case 'getLatestEmail': {
          const listOptions = this.buildListOptions(params.filters);
          const response = await this.gmailService.getLatestEmail(listOptions);
          if (response.success && response.data?.email) {
            this.emailListCache.set(userId, [response.data.email]);
          }
          return response;
        }

        case 'getEmailById': {
          const messageId = await this.resolveMessageId(params, userId, resolver);
          if (!messageId) {
            return { success: false, error: 'Unable to determine which email to read' };
          }
          return await this.gmailService.getEmailById(messageId, {
            includeBody: params.filters?.includeBody ?? true,
            includeHeaders: params.filters?.includeHeaders ?? true
          });
        }

        case 'sendPreview':
          return await this.handleSend(params, userId, true);

        case 'sendConfirm':
          return await this.handleSend(params, userId, false);

        case 'replyPreview':
          return await this.handleReply(params, userId, resolver, true);

        case 'replyConfirm':
          return await this.handleReply(params, userId, resolver, false);

        case 'markAsRead': {
          const messageId = await this.resolveMessageId(params, userId, resolver);
          if (!messageId) {
            return { success: false, error: 'Unable to determine which email to mark as read' };
          }
          return await this.gmailService.markAsRead(messageId);
        }

        case 'markAsUnread': {
          const messageId = await this.resolveMessageId(params, userId, resolver);
          if (!messageId) {
            return { success: false, error: 'Unable to determine which email to mark as unread' };
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

  private buildListOptions(filters: any = {}): EmailListOptions {
    const options: EmailListOptions = {};
    if (!filters || typeof filters !== 'object') {
      return options;
    }

    if (filters.from) options.from = filters.from;
    if (filters.to) options.to = filters.to;
    if (filters.subjectContains) options.subjectContains = filters.subjectContains;
    if (filters.textContains) options.textContains = filters.textContains;
    if (Array.isArray(filters.labelIds)) options.labelIds = filters.labelIds;
    if (typeof filters.maxResults === 'number') options.maxResults = filters.maxResults;
    if (typeof filters.includeBody === 'boolean') options.includeBody = filters.includeBody;
    if (typeof filters.includeHeaders === 'boolean') options.includeHeaders = filters.includeHeaders;

    return options;
  }

  private async resolveMessageId(params: any, userId: string, resolver: QueryResolver): Promise<string | null> {
    if (params.messageId) {
      this.logger.debug(`[GmailFunction] resolveMessageId using explicit messageId=${params.messageId}`);
      return params.messageId;
    }

    const selectionId = this.getMessageIdFromSelection(userId, params.selectionIndex);
    if (selectionId) {
      this.logger.debug(`[GmailFunction] resolveMessageId matched selectionIndex=${params.selectionIndex} -> ${selectionId}`);
      return selectionId;
    }

    const query = params.query || params.subjectHint || params.subject || params.from || params.toHint || params.to;
    if (!query) {
      this.logger.warn('[GmailFunction] resolveMessageId failed: no messageId, selectionIndex, or query hints provided');
      return null;
    }

    const result = await resolver.resolveOneOrAsk(query, userId, 'email');
    if (result.disambiguation) {
      this.logger.info('[GmailFunction] resolveMessageId returned disambiguation; awaiting user choice');
      return null;
    }
    const resolvedId = result.entity?.id ?? null;
    if (!resolvedId) {
      this.logger.warn('[GmailFunction] resolveMessageId found no matching email for query');
    } else {
      this.logger.debug(`[GmailFunction] resolveMessageId resolved query to id=${resolvedId}`);
    }
    return resolvedId;
  }

  private validateRecipients(recipients?: string[]): string[] | undefined {
    if (!recipients) return undefined;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalid = recipients.filter((email) => !emailRegex.test(email));
    if (invalid.length > 0) {
      throw new Error(`Invalid email addresses: ${invalid.join(', ')}`);
    }
    return recipients;
  }

  private async handleSend(params: any, userId: string, previewOnly: boolean): Promise<IResponse> {
    try {
      let request: SendEmailRequest | null = null;
      let draftId = typeof params.draftId === 'string' ? params.draftId : undefined;
      this.logger.debug(`[GmailFunction] handleSend previewOnly=${previewOnly} draftId=${draftId} user=${userId}`);

      if (!previewOnly) {
        if (!draftId) {
          draftId = this.lastDraftByType.get(userId)?.send?.id;
        }
        if (draftId) {
          this.logger.debug(`[GmailFunction] handleSend consuming stored draft ${draftId} for user ${userId}`);
          let stored = this.consumeDraft(userId, draftId, 'send');
          if (!stored) {
            const fallbackId = this.lastDraftByType.get(userId)?.send?.id;
            if (fallbackId && fallbackId !== draftId) {
              this.logger.warn(`[GmailFunction] handleSend draftId ${draftId} not found. Trying fallback ${fallbackId}.`);
              stored = this.consumeDraft(userId, fallbackId, 'send');
            }
          }
          if (!stored) {
            return { success: false, error: 'Draft not found or expired. Please create a new email draft.' };
          }
          request = stored.request;
        } else if (params.draftId) {
          return { success: false, error: 'Draft not found or expired. Please create a new email draft.' };
        }
      }
      if (!request) {
        this.logger.debug(`[GmailFunction] handleSend building new request for user ${userId}`);
        const to = this.validateRecipients(params.to);
        if (!to || to.length === 0) {
          return { success: false, error: 'Recipients (to) are required for send operation' };
        }

        if (!params.subject || !params.body) {
          return { success: false, error: 'Subject and body are required for send operation' };
        }

        const formatted = this.formatEmailByLanguage(params.subject, params.body);

        request = {
          to,
          cc: this.validateRecipients(params.cc),
          bcc: this.validateRecipients(params.bcc),
          subject: formatted.subject,
          bodyHtml: formatted.body,
          bodyText: params.bodyText
        };
      }

      const requestHash = this.hashSendRequest(request);
      this.logger.debug(`[GmailFunction] handleSend requestHash=${requestHash} previewOnly=${previewOnly}`);

      if (previewOnly) {
        const existingDraft = this.lastDraftByType.get(userId)?.send;
        if (existingDraft && existingDraft.requestHash === requestHash) {
          this.logger.info(`[GmailFunction] handleSend detected repeated preview, auto-sending draft ${existingDraft.id}`);
          const stored = this.consumeDraft(userId, existingDraft.id, 'send');
          if (stored) {
            return await this.gmailService.sendEmail(stored.request, { previewOnly: false });
          }
        }
      }

      const response = await this.gmailService.sendEmail(request, { previewOnly });

      if (previewOnly && response.success) {
        this.logger.info('[GmailFunction] handleSend draft created and cached');
        const draftIdCreated = this.storeDraft(
          userId,
          {
            type: 'send',
            request
          },
          requestHash
        );
        const data = response.data || {};
        const { raw, ...restData } = data as Record<string, any>;
        return {
          ...response,
          data: {
            ...restData,
            draftId: draftIdCreated
          }
        };
      }

      return response;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to prepare email' };
    }
  }

  private async handleReply(
    params: any,
    userId: string,
    resolver: QueryResolver,
    previewOnly: boolean
  ): Promise<IResponse> {
    try {
      let request: ReplyEmailRequest | null = null;
      let draftId = typeof params.draftId === 'string' ? params.draftId : undefined;
      this.logger.debug(`[GmailFunction] handleReply previewOnly=${previewOnly} draftId=${draftId} user=${userId}`);

      if (!previewOnly) {
        if (!draftId) {
          draftId = this.lastDraftByType.get(userId)?.reply?.id;
        }
        if (draftId) {
          this.logger.debug(`[GmailFunction] handleReply consuming stored draft ${draftId} for user ${userId}`);
          let stored = this.consumeDraft(userId, draftId, 'reply');
          if (!stored) {
            const fallbackId = this.lastDraftByType.get(userId)?.reply?.id;
            if (fallbackId && fallbackId !== draftId) {
              this.logger.warn(`[GmailFunction] handleReply draftId ${draftId} not found. Trying fallback ${fallbackId}.`);
              stored = this.consumeDraft(userId, fallbackId, 'reply');
            }
          }
          if (!stored) {
            return { success: false, error: 'Reply draft not found or expired. Please prepare the reply again.' };
          }
          request = stored.request;
        } else if (params.draftId) {
          return { success: false, error: 'Reply draft not found or expired. Please prepare the reply again.' };
        }
      }

      if (!request) {
        this.logger.debug(`[GmailFunction] handleReply building new request for user ${userId}`);
        if (!params.body) {
          return { success: false, error: 'Body is required for reply operation' };
        }

        const messageId = await this.resolveMessageId(params, userId, resolver);
        if (!messageId) {
          return { success: false, error: 'Unable to find the email to reply to' };
        }

        const formatted = this.formatEmailByLanguage(params.subject ?? '', params.body);

        request = {
          messageId,
          body: formatted.body,
          bodyHtml: formatted.body,
          bodyText: params.bodyText,
          toOverride: this.validateRecipients(params.to),
          cc: this.validateRecipients(params.cc),
          bcc: this.validateRecipients(params.bcc),
          subjectOverride: params.subject
        };
      }

      const requestHash = this.hashReplyRequest(request);
      this.logger.debug(`[GmailFunction] handleReply requestHash=${requestHash} previewOnly=${previewOnly}`);

      if (previewOnly) {
        const existingDraft = this.lastDraftByType.get(userId)?.reply;
        if (existingDraft && existingDraft.requestHash === requestHash) {
          this.logger.info(`[GmailFunction] handleReply detected repeated preview, auto-sending draft ${existingDraft.id}`);
          const stored = this.consumeDraft(userId, existingDraft.id, 'reply');
          if (stored) {
            return await this.gmailService.replyToEmail(stored.request, { previewOnly: false });
          }
        }
      }

      const response = await this.gmailService.replyToEmail(request, { previewOnly });

      if (previewOnly && response.success) {
        this.logger.info('[GmailFunction] handleReply draft created and cached');
        const draftIdCreated = this.storeDraft(
          userId,
          {
            type: 'reply',
            request
          },
          requestHash
        );
        const data = response.data || {};
        const { raw, ...restData } = data as Record<string, any>;
        return {
          ...response,
          data: {
            ...restData,
            draftId: draftIdCreated
          }
        };
      }

      return response;
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to prepare reply' };
    }
  }

  private cacheEmailList(userId: string, response: IResponse): void {
    if (!response.success) {
      return;
    }
    const data = response.data as EmailListData;
    if (data?.emails) {
      this.emailListCache.set(userId, data.emails);
    }
  }

  private getMessageIdFromSelection(userId: string, selectionIndex?: number): string | null {
    if (selectionIndex === undefined || selectionIndex === null) {
      return null;
    }

    const emails = this.emailListCache.get(userId);
    if (!emails || emails.length === 0) {
      return null;
    }

    const index = Number.isFinite(selectionIndex) ? Number(selectionIndex) : NaN;
    if (Number.isNaN(index)) {
      return null;
    }

    const zeroBased = index > 0 ? index - 1 : index;
    if (zeroBased < 0 || zeroBased >= emails.length) {
      return null;
    }

    return emails[zeroBased]?.id ?? null;
  }

  private storeDraft(userId: string, draft: PendingDraft, requestHash: string): string {
    const draftId = randomUUID();
    this.logger.debug(`[GmailFunction] storeDraft user=${userId} draftId=${draftId} type=${draft.type}`);
    this.draftCache.set(this.getDraftKey(userId, draftId), {
      ...draft,
      createdAt: Date.now()
    });
    const current = this.lastDraftByType.get(userId) || {};
    current[draft.type] = {
      id: draftId,
      requestHash,
      createdAt: Date.now()
    };
    this.lastDraftByType.set(userId, current);
    return draftId;
  }

  private consumeDraft<T extends PendingDraft['type']>(userId: string, draftId: string, expectedType: T): DraftByType<T> | null {
    if (!draftId) return null;
    const key = this.getDraftKey(userId, draftId);
    const stored = this.draftCache.get(key);
    if (!stored || stored.type !== expectedType) {
      this.logger.warn(`[GmailFunction] consumeDraft failed for user=${userId} draftId=${draftId} expectedType=${expectedType}`);
      return null;
    }
    this.logger.debug(`[GmailFunction] consumeDraft success for user=${userId} draftId=${draftId} type=${expectedType}`);
    this.draftCache.delete(key);
    const current = this.lastDraftByType.get(userId);
    if (current) {
      if (expectedType === 'send' && current.send?.id === draftId) {
        delete current.send;
      } else if (expectedType === 'reply' && current.reply?.id === draftId) {
        delete current.reply;
      }
      if (!current.send && !current.reply) {
        this.lastDraftByType.delete(userId);
      } else {
        this.lastDraftByType.set(userId, current);
      }
    }
    return stored as DraftByType<T>;
  }

  private getDraftKey(userId: string, draftId: string): string {
    return `${userId}:${draftId}`;
  }

  private hashSendRequest(request: SendEmailRequest): string {
    return JSON.stringify({
      to: [...(request.to || [])].sort(),
      cc: request.cc ? [...request.cc].sort() : undefined,
      bcc: request.bcc ? [...request.bcc].sort() : undefined,
      subject: request.subject,
      bodyHtml: request.bodyHtml,
      bodyText: request.bodyText
    });
  }

  private hashReplyRequest(request: ReplyEmailRequest): string {
    return JSON.stringify({
      messageId: request.messageId,
      toOverride: request.toOverride ? [...request.toOverride].sort() : undefined,
      cc: request.cc ? [...request.cc].sort() : undefined,
      bcc: request.bcc ? [...request.bcc].sort() : undefined,
      subjectOverride: request.subjectOverride,
      bodyHtml: request.bodyHtml,
      bodyText: request.bodyText
    });
  }
}

type PendingDraft =
  | { type: 'send'; request: SendEmailRequest; createdAt?: number }
  | { type: 'reply'; request: ReplyEmailRequest; createdAt?: number };

type DraftByType<T extends PendingDraft['type']> = Extract<PendingDraft, { type: T }>;

type DraftMetadata = {
  id: string;
  requestHash: string;
  createdAt: number;
};

