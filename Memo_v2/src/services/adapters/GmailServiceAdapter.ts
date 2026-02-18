/**
 * GmailServiceAdapter
 * 
 * Adapter for V1 GmailService.
 * Converts resolver args (gmailOperations) into GmailService method calls.
 */

import { getGmailService } from '../v1-services.js';
import type { AuthContext } from '../../types/index.js';
import type { RequestUserContext } from '../../legacy/types/UserContext.js';

export interface GmailOperationArgs {
  operation:
    | 'listEmails'
    | 'getLatestEmail'
    | 'getEmailById'
    | 'sendPreview'
    | 'sendConfirm'
    | 'replyPreview'
    | 'replyConfirm'
    | 'reply' // legacy alias
    | 'markAsRead'
    | 'markAsUnread';
  messageId?: string;
  threadId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  filters?: {
    from?: string;
    to?: string;
    subject?: string;
    subjectContains?: string;
    textContains?: string;
    after?: string;
    before?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    maxResults?: number;
    includeBody?: boolean;
    includeHeaders?: boolean;
    labelIds?: string[];
  };
  labelIds?: string[]; // kept for backward compatibility; prefer filters.labelIds
  language?: 'he' | 'en';
}

export interface GmailOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class GmailServiceAdapter {
  private authContext: AuthContext;

  constructor(authContext: AuthContext) {
    this.authContext = authContext;
  }

  /**
   * Build RequestUserContext directly from AuthContext (NO DB calls).
   * AuthContext was already hydrated by ContextAssemblyNode at graph start.
   */
  private buildRequestContext(): RequestUserContext {
    return {
      user: this.authContext.userRecord,
      planType: this.authContext.planTier,
      whatsappNumber: this.authContext.userRecord.whatsapp_number,
      capabilities: {
        database: this.authContext.capabilities.database,
        calendar: this.authContext.capabilities.calendar,
        gmail: this.authContext.capabilities.gmail,
      },
      googleTokens: this.authContext.googleTokens,
      googleConnected: this.authContext.googleConnected,
    };
  }
  
  /**
   * Execute a Gmail operation
   */
  async execute(args: GmailOperationArgs): Promise<GmailOperationResult> {
    const { operation } = args;
    const gmailService = getGmailService();
    
    if (!gmailService) {
      return { success: false, error: 'GmailService not available' };
    }

    // Build context from state (no DB calls — uses AuthContext from shared state)
    const context = this.buildRequestContext();
    
    try {
      switch (operation) {
        case 'listEmails':
          return await this.listEmails(gmailService, context, args);
          
        case 'getLatestEmail':
          return await this.getLatestEmail(gmailService, context, args);
          
        case 'getEmailById':
          return await this.getEmailById(gmailService, context, args);
          
        case 'sendPreview':
          return await this.sendPreview(gmailService, context, args);
          
        case 'sendConfirm':
          return await this.sendConfirm(gmailService, context, args);
          
        case 'replyPreview':
          return await this.replyPreview(gmailService, context, args);
          
        case 'replyConfirm':
        case 'reply': // alias
          return await this.replyConfirm(gmailService, context, args);
          
        case 'markAsRead':
          return await this.markAsRead(gmailService, context, args);
          
        case 'markAsUnread':
          return await this.markAsUnread(gmailService, context, args);
          
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      console.error(`[GmailServiceAdapter] Error in ${operation}:`, error);
      return { success: false, error: error.message || String(error) };
    }
  }
  
  // ========================================================================
  // OPERATION IMPLEMENTATIONS
  // ========================================================================
  
  private async listEmails(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    const filters = args.filters || {};
    const result = await gmailService.listEmails(context, {
      from: filters.from,
      to: filters.to,
      subjectContains: filters.subjectContains ?? filters.subject,
      textContains: filters.textContains,
      after: filters.after,
      before: filters.before,
      labelIds: filters.labelIds ?? args.labelIds,
      maxResults: filters.maxResults || 10,
      includeBody: filters.includeBody ?? true,
      includeHeaders: filters.includeHeaders ?? true,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async getEmailById(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required' };
    }
    
    const result = await gmailService.getEmailById(context, args.messageId, {
      includeBody: true,
      includeHeaders: true,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async sendPreview(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.to || args.to.length === 0) {
      return { success: false, error: 'Recipients (to) are required' };
    }
    
    const result = await gmailService.sendEmail(
      context,
      {
        to: args.to,
        subject: args.subject || '',
        body: args.body,
        cc: args.cc,
        bcc: args.bcc,
      },
      { previewOnly: true }
    );
    
    return {
      success: result.success,
      data: { ...result.data, preview: true },
      error: result.error,
    };
  }
  
  private async sendConfirm(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.to || args.to.length === 0) {
      return { success: false, error: 'Recipients (to) are required' };
    }
    
    const result = await gmailService.sendEmail(context, {
      to: args.to,
      subject: args.subject || '',
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async replyPreview(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required for reply' };
    }
    
    const result = await gmailService.replyToEmail(context, {
      messageId: args.messageId,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    }, { previewOnly: true });
    
    return {
      success: result.success,
      data: { ...result.data, preview: true },
      error: result.error,
    };
  }

  private async replyConfirm(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required for reply' };
    }

    const result = await gmailService.replyToEmail(context, {
      messageId: args.messageId,
      body: args.body,
      cc: args.cc,
      bcc: args.bcc,
    }, { previewOnly: false });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  private async getLatestEmail(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    const filters = args.filters || {};
    const list = await gmailService.listEmails(context, {
      from: filters.from,
      to: filters.to,
      subjectContains: filters.subjectContains ?? filters.subject,
      textContains: filters.textContains,
      after: filters.after,
      before: filters.before,
      labelIds: filters.labelIds ?? args.labelIds,
      maxResults: 1,
      includeBody: filters.includeBody ?? true,
      includeHeaders: filters.includeHeaders ?? true,
    });

    if (!list.success) {
      return { success: false, error: list.error || 'Failed to list emails' };
    }

    const emails = list.data?.emails;
    const latest = Array.isArray(emails) && emails.length > 0 ? emails[0] : null;

    return {
      success: true,
      data: {
        email: latest,
        query: list.data?.query,
        count: list.data?.count ?? (Array.isArray(emails) ? emails.length : 0),
      },
    };
  }

  private async markAsRead(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required' };
    }
    const result = await gmailService.markAsRead(context, args.messageId);
    return { success: result.success, data: result.data, error: result.error };
  }

  private async markAsUnread(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required' };
    }
    const result = await gmailService.markAsUnread(context, args.messageId);
    return { success: result.success, data: result.data, error: result.error };
  }
}
