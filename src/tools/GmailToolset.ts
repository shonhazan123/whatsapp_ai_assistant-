import { IToolset, ToolResult } from '../types/interfaces';
import { GmailService } from '../services/email/GmailService';
import { logger } from '../utils/logger';
import { EmailSchema } from '../types/schema';

/**
 * GmailToolset - Clean operations for Gmail API
 * No LLM, just pure email operations
 */
export class GmailToolset implements IToolset {
  name = 'GmailToolset';
  description = 'Handles all Gmail operations for sending and reading emails';

  private gmailService: GmailService;

  constructor() {
    this.gmailService = new GmailService(logger);
  }

  async execute(operation: string, params: any): Promise<ToolResult> {
    try {
      logger.info(`📧 GmailToolset.${operation}`, { params });

      switch (operation) {
        case 'email.send':
          return await this.sendEmail(params);
        case 'email.sendMultiple':
          return await this.sendMultipleEmails(params);
        case 'email.search':
          return await this.searchEmails(params);
        case 'email.getById':
          return await this.getEmailById(params);
        case 'email.getRecent':
          return await this.getRecentEmails(params);
        case 'email.markAsRead':
          return await this.markAsRead(params);
        case 'email.delete':
          return await this.deleteEmail(params);
        
        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`
          };
      }
    } catch (error) {
      logger.error(`GmailToolset error in ${operation}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async sendEmail(params: any): Promise<ToolResult> {
    const validated = EmailSchema.parse(params);
    const response = await this.gmailService.sendEmail({
      to: validated.to,
      subject: validated.subject,
      body: validated.body,
      cc: validated.cc,
      bcc: validated.bcc
    });
    return this.toToolResult(response);
  }

  private async sendMultipleEmails(params: any): Promise<ToolResult> {
    const results = [];
    const errors = [];

    for (const email of params.emails) {
      try {
        const response = await this.gmailService.sendEmail(email);
        if (response.success) {
          results.push(response.data);
        } else {
          errors.push({ to: email.to, error: response.message });
        }
        
        // Add delay between emails to avoid rate limiting
        if (params.delayMs) {
          await new Promise(resolve => setTimeout(resolve, params.delayMs));
        }
      } catch (error) {
        errors.push({ to: email.to, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return {
      success: results.length > 0,
      data: { sent: results, errors },
      message: `Sent ${results.length} emails${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    };
  }

  private async searchEmails(params: any): Promise<ToolResult> {
    const response = await this.gmailService.searchEmails(params.query);
    return this.toToolResult(response);
  }

  private async getEmailById(params: any): Promise<ToolResult> {
    const response = await this.gmailService.getEmailById(params.emailId);
    return this.toToolResult(response);
  }

  private async getRecentEmails(params: any): Promise<ToolResult> {
    // Placeholder - use search with recent filter
    const response = await this.gmailService.searchEmails('is:unread newer_than:7d');
    return this.toToolResult(response);
  }

  private async markAsRead(params: any): Promise<ToolResult> {
    // Placeholder
    return { success: true, message: 'Mark as read not implemented' };
  }

  private async deleteEmail(params: any): Promise<ToolResult> {
    // Placeholder
    return { success: true, message: 'Delete email not implemented' };
  }

  private toToolResult(serviceResponse: any): ToolResult {
    return {
      success: serviceResponse.success,
      data: serviceResponse.data,
      error: serviceResponse.message && !serviceResponse.success ? serviceResponse.message : undefined,
      message: serviceResponse.message
    };
  }
}

