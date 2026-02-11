/**
 * GmailServiceAdapter
 * 
 * Adapter for V1 GmailService.
 * Converts resolver args (gmailOperations) into GmailService method calls.
 */

import { getGmailService } from '../v1-services.js';
import { UserService } from '../../legacy/services/database/UserService.js';
import type { UserContext } from '../../types/index.js';
import type { RequestUserContext } from '../../legacy/types/UserContext.js';

export interface GmailOperationArgs {
  operation: string;
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
    after?: string;
    before?: string;
    hasAttachment?: boolean;
    isUnread?: boolean;
    maxResults?: number;
  };
  labelIds?: string[];
  language?: 'he' | 'en';
}

export interface GmailOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class GmailServiceAdapter {
  private userPhone: string;
  private userContext: UserContext;
  private userService: UserService;
  
  constructor(userPhone: string, userContext: UserContext) {
    this.userPhone = userPhone;
    this.userContext = userContext;
    this.userService = new UserService();
  }

  /**
   * Build RequestUserContext from MemoState user context
   */
  private async buildRequestContext(): Promise<RequestUserContext> {
    const userRecord = await this.userService.findByWhatsappNumber(this.userPhone);
    if (!userRecord) {
      throw new Error(`User not found: ${this.userPhone}`);
    }

    const googleTokens = await this.userService.getGoogleTokens(userRecord.id);

    return {
      user: userRecord,
      planType: userRecord.plan_type,
      whatsappNumber: this.userPhone,
      capabilities: {
        database: this.userContext.capabilities.database,
        calendar: this.userContext.capabilities.calendar,
        gmail: this.userContext.capabilities.gmail,
      },
      googleTokens: googleTokens,
      googleConnected: this.userContext.googleConnected,
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

    // Build context from state
    const context = await this.buildRequestContext();
    
    try {
      switch (operation) {
        case 'listEmails':
          return await this.listEmails(gmailService, context, args);
          
        case 'getEmailById':
          return await this.getEmailById(gmailService, context, args);
          
        case 'sendPreview':
          return await this.sendPreview(gmailService, context, args);
          
        case 'sendConfirm':
          return await this.sendConfirm(gmailService, context, args);
          
        case 'reply':
          return await this.reply(gmailService, context, args);
          
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
    // Build query from filters
    const filters = args.filters || {};
    const queryParts: string[] = [];
    
    if (filters.from) queryParts.push(`from:${filters.from}`);
    if (filters.to) queryParts.push(`to:${filters.to}`);
    if (filters.subject) queryParts.push(`subject:${filters.subject}`);
    if (filters.after) queryParts.push(`after:${filters.after}`);
    if (filters.before) queryParts.push(`before:${filters.before}`);
    if (filters.hasAttachment) queryParts.push('has:attachment');
    if (filters.isUnread) queryParts.push('is:unread');
    
    const result = await gmailService.listEmails(context, {
      query: queryParts.length > 0 ? queryParts.join(' ') : undefined,
      maxResults: filters.maxResults || 10,
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
  
  private async reply(gmailService: any, context: RequestUserContext, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required for reply' };
    }
    
    const result = await gmailService.replyToEmail(context, {
      messageId: args.messageId,
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
}
