/**
 * GmailServiceAdapter
 * 
 * Adapter for V1 GmailService.
 * Converts resolver args (gmailOperations) into GmailService method calls.
 */

import { getGmailService } from '../v1-services.js';

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
  
  constructor(userPhone: string) {
    this.userPhone = userPhone;
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
    
    try {
      switch (operation) {
        case 'listEmails':
          return await this.listEmails(gmailService, args);
          
        case 'getEmailById':
          return await this.getEmailById(gmailService, args);
          
        case 'sendPreview':
          return await this.sendPreview(gmailService, args);
          
        case 'sendConfirm':
          return await this.sendConfirm(gmailService, args);
          
        case 'reply':
          return await this.reply(gmailService, args);
          
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
  
  private async listEmails(gmailService: any, args: GmailOperationArgs): Promise<GmailOperationResult> {
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
    
    const result = await gmailService.listEmails({
      query: queryParts.length > 0 ? queryParts.join(' ') : undefined,
      maxResults: filters.maxResults || 10,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async getEmailById(gmailService: any, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required' };
    }
    
    const result = await gmailService.getEmailById(args.messageId, {
      includeBody: true,
      includeHeaders: true,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async sendPreview(gmailService: any, args: GmailOperationArgs): Promise<GmailOperationResult> {
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
  
  private async sendConfirm(gmailService: any, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.to || args.to.length === 0) {
      return { success: false, error: 'Recipients (to) are required' };
    }
    
    const result = await gmailService.sendEmail({
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
  
  private async reply(gmailService: any, args: GmailOperationArgs): Promise<GmailOperationResult> {
    if (!args.messageId) {
      return { success: false, error: 'Message ID is required for reply' };
    }
    
    const result = await gmailService.replyToEmail({
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
