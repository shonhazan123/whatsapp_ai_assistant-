/**
 * Gmail Resolver
 * 
 * Converts email-related PlanSteps into gmail operation arguments.
 * 
 * Based on V1: src/agents/functions/GmailFunctions.ts
 */

import { LLMResolver, type ResolverOutput } from './BaseResolver.js';
import type { MemoState } from '../state/MemoState.js';
import type { PlanStep, Capability } from '../../types/index.js';

// ============================================================================
// GMAIL RESOLVER
// ============================================================================

/**
 * GmailResolver - Email operations
 * 
 * Actions: list_emails, get_email, send_email, reply_email, mark_read, mark_unread
 */
export class GmailResolver extends LLMResolver {
  readonly name = 'gmail_resolver';
  readonly capability: Capability = 'gmail';
  readonly actions = [
    'list_emails',
    'get_email',
    'get_latest_email',
    'send_email',
    'send_preview',
    'send_confirm',
    'reply_email',
    'reply_preview',
    'reply_confirm',
    'mark_read',
    'mark_unread',
  ];
  
  getSystemPrompt(): string {
    return `You are an email management assistant. Convert user requests into Gmail operation parameters.

Your job is to output JSON arguments for the gmailOperations function.

AVAILABLE OPERATIONS:
- listEmails: List emails with filters
- getLatestEmail: Get the most recent email
- getEmailById: Get a specific email
- sendPreview: Draft email for review
- sendConfirm: Confirm and send a draft
- replyPreview: Draft reply for review
- replyConfirm: Confirm and send a reply
- markAsRead: Mark email as read
- markAsUnread: Mark email as unread

OUTPUT FORMAT for sendPreview:
{
  "operation": "sendPreview",
  "to": ["email@example.com"],
  "subject": "Email subject",
  "body": "Email body content"
}

OUTPUT FORMAT for listEmails:
{
  "operation": "listEmails",
  "filters": {
    "from": "sender@example.com",
    "subjectContains": "keyword",
    "maxResults": 10
  }
}

OUTPUT FORMAT for replyPreview:
{
  "operation": "replyPreview",
  "messageId": "email ID to reply to",
  "body": "Reply content"
}

RULES:
1. Always use preview first for send/reply operations
2. Never guess messageId - use filters to find
3. For ambiguous email references, return clarify type
4. Output only the JSON, no explanation`;
  }
  
  getSchemaSlice(): object {
    return {
      name: 'gmailOperations',
      parameters: {
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
          },
          filters: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              subjectContains: { type: 'string' },
              textContains: { type: 'string' },
              labelIds: { type: 'array', items: { type: 'string' } },
              maxResults: { type: 'number' },
              includeBody: { type: 'boolean' },
            },
          },
          messageId: { type: 'string' },
          to: { type: 'array', items: { type: 'string' } },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string' },
          draftId: { type: 'string' },
          selectionIndex: { type: 'number' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    const { action, constraints, changes } = step;
    
    // Map semantic action to operation
    const operationMap: Record<string, string> = {
      'list_emails': 'listEmails',
      'get_email': 'getEmailById',
      'get_latest_email': 'getLatestEmail',
      'send_email': 'sendPreview', // Always preview first
      'send_preview': 'sendPreview',
      'send_confirm': 'sendConfirm',
      'reply_email': 'replyPreview', // Always preview first
      'reply_preview': 'replyPreview',
      'reply_confirm': 'replyConfirm',
      'mark_read': 'markAsRead',
      'mark_unread': 'markAsUnread',
    };
    
    const operation = operationMap[action] || 'listEmails';
    
    // Build args based on operation
    const args: Record<string, any> = { operation };
    
    switch (operation) {
      case 'listEmails':
        args.filters = {
          ...(constraints.from && { from: constraints.from }),
          ...(constraints.to && { to: constraints.to }),
          ...(constraints.subjectContains && { subjectContains: constraints.subjectContains }),
          ...(constraints.textContains && { textContains: constraints.textContains }),
          ...(constraints.maxResults && { maxResults: constraints.maxResults }),
          includeBody: constraints.includeBody ?? true,
        };
        break;
        
      case 'getLatestEmail':
        if (constraints.filters) {
          args.filters = constraints.filters;
        }
        break;
        
      case 'getEmailById':
        args.messageId = constraints.messageId;
        break;
        
      case 'sendPreview':
        args.to = constraints.to || [];
        args.subject = constraints.subject || changes.subject;
        args.body = constraints.body || changes.body;
        if (constraints.cc) args.cc = constraints.cc;
        if (constraints.bcc) args.bcc = constraints.bcc;
        break;
        
      case 'sendConfirm':
        args.draftId = constraints.draftId;
        break;
        
      case 'replyPreview':
        args.messageId = constraints.messageId;
        args.body = constraints.body || changes.body;
        break;
        
      case 'replyConfirm':
        args.draftId = constraints.draftId;
        break;
        
      case 'markAsRead':
      case 'markAsUnread':
        args.messageId = constraints.messageId;
        break;
    }
    
    // Handle disambiguation for operations that need email lookup
    if (['getEmailById', 'replyPreview', 'markAsRead', 'markAsUnread'].includes(operation) && !args.messageId) {
      if (constraints.from || constraints.subject || constraints.selectionIndex) {
        args._needsResolution = true;
        args._searchHints = {
          from: constraints.from,
          subject: constraints.subject,
          selectionIndex: constraints.selectionIndex,
        };
      }
    }
    
    return {
      stepId: step.id,
      type: 'execute',
      args,
    };
  }
  
  protected getEntityType(): 'calendar' | 'database' | 'gmail' | 'second-brain' | 'error' {
    return 'gmail';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createGmailResolver() {
  const resolver = new GmailResolver();
  return resolver.asNodeFunction();
}


