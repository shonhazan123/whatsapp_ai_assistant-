/**
 * Gmail Resolver
 * 
 * Converts email-related PlanSteps into gmail operation arguments.
 * 
 * Uses its OWN LLM call with domain-specific prompts to:
 * 1. Determine the specific operation (list, send, reply, etc.)
 * 2. Extract all required fields from the user's natural language
 * 
 * Based on V1: src/agents/functions/GmailFunctions.ts
 */

import type { Capability, PlanStep } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { LLMResolver, type ResolverOutput } from './BaseResolver.js';

// ============================================================================
// GMAIL RESOLVER
// ============================================================================

/**
 * GmailResolver - Email operations
 * 
 * Uses LLM to determine operation and extract email parameters.
 */
export class GmailResolver extends LLMResolver {
  readonly name = 'gmail_resolver';
  readonly capability: Capability = 'gmail';
  readonly actions = [
    'email_operation',  // Generic - LLM will determine specific operation
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
    return `YOU ARE AN EMAIL MANAGEMENT ASSISTANT.

## YOUR ROLE:
Analyze the user's natural language request and convert it into Gmail operation parameters.
You handle email searching, reading, composing, sending, and replying.

## OPERATION SELECTION
Analyze the user's intent to determine the correct operation:
- User wants to SEE/LIST emails → "listEmails"
- User asks "מה יש לי במייל"/"check my email" → "listEmails"
- User wants to SEE latest email → "getLatestEmail"
- User wants to SEND new email → "sendPreview" (always preview first!)
- User wants to REPLY to email → "replyPreview" (always preview first!)
- User confirms draft → "sendConfirm" or "replyConfirm"
- User wants to mark as READ/UNREAD → "markAsRead" or "markAsUnread"

## AVAILABLE OPERATIONS:
- **listEmails**: List emails with filters (from, subject, etc.)
- **getLatestEmail**: Get the most recent email
- **getEmailById**: Get a specific email by ID
- **sendPreview**: Draft email for review (ALWAYS use this for new emails)
- **sendConfirm**: Confirm and send a draft
- **replyPreview**: Draft reply for review (ALWAYS use this for replies)
- **replyConfirm**: Confirm and send a reply
- **markAsRead**: Mark email as read
- **markAsUnread**: Mark email as unread

## CRITICAL RULES:

### Always Preview Before Send:
- NEVER use sendConfirm or replyConfirm directly
- ALWAYS use sendPreview or replyPreview first
- User must see and approve the email before it's sent

### Email Search:
- Use filters to find emails
- Don't guess messageId - use search criteria
- For "from Dan" use filters.from

### Contact Resolution:
- If user mentions a name, try to extract email or name for search
- Don't make up email addresses

## OUTPUT FORMAT for sendPreview:
{
  "operation": "sendPreview",
  "to": ["email@example.com"],
  "subject": "Email subject",
  "body": "Email body content"
}

## OUTPUT FORMAT for listEmails:
{
  "operation": "listEmails",
  "filters": {
    "from": "sender@example.com",
    "subjectContains": "keyword",
    "maxResults": 10
  }
}

## OUTPUT FORMAT for replyPreview:
{
  "operation": "replyPreview",
  "filters": { "from": "...", "subjectContains": "..." },
  "body": "Reply content"
}

## EXAMPLES:

Example 1 - Check emails:
User: "מה יש לי במייל?"
→ { "operation": "listEmails", "filters": { "maxResults": 10, "includeBody": true } }

Example 2 - Search from specific sender:
User: "האם יש לי מיילים מדני?"
→ { "operation": "listEmails", "filters": { "from": "דני", "maxResults": 10, "includeBody": true } }

Example 3 - Get latest email:
User: "show me my latest email"
→ { "operation": "getLatestEmail", "filters": { "includeBody": true } }

Example 4 - Search by subject:
User: "find emails about the project meeting"
→ { "operation": "listEmails", "filters": { "subjectContains": "project meeting", "maxResults": 10 } }

Example 5 - Send new email:
User: "שלח מייל לדני על הפגישה מחר"
→ { "operation": "sendPreview", "to": ["דני"], "subject": "הפגישה מחר", "body": "..." }

Example 6 - Reply to email:
User: "reply to the email from Sarah saying I'll be there"
→ { "operation": "replyPreview", "filters": { "from": "Sarah" }, "body": "I'll be there." }

Example 7 - Send to specific email:
User: "send an email to john@example.com about the deadline"
→ { "operation": "sendPreview", "to": ["john@example.com"], "subject": "Deadline", "body": "..." }

Example 8 - Mark as read:
User: "mark the email from HR as read"
→ { "operation": "markAsRead", "filters": { "from": "HR" } }

Output only the JSON, no explanation.`;
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
          messageId: { type: 'string', description: 'Email message ID' },
          to: { type: 'array', items: { type: 'string' }, description: 'Recipients' },
          cc: { type: 'array', items: { type: 'string' } },
          bcc: { type: 'array', items: { type: 'string' } },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Email body content' },
          draftId: { type: 'string' },
          selectionIndex: { type: 'number', description: 'For disambiguation' },
        },
        required: ['operation'],
      },
    };
  }
  
  async resolve(step: PlanStep, state: MemoState): Promise<ResolverOutput> {
    // Use LLM to extract operation and parameters
    try {
      console.log(`[${this.name}] Calling LLM to extract email operation`);
      
      const args = await this.callLLM(step, state);
      
      // Validate operation
      if (!args.operation) {
        console.warn(`[${this.name}] LLM did not return operation, defaulting to 'listEmails'`);
        args.operation = 'listEmails';
      }
      
      // Ensure filters has includeBody for list operations
      if (['listEmails', 'getLatestEmail'].includes(args.operation)) {
        args.filters = args.filters || {};
        if (args.filters.includeBody === undefined) {
          args.filters.includeBody = true;
        }
      }
      
      // Safety: redirect send_email to sendPreview
      if (args.operation === 'send_email') {
        args.operation = 'sendPreview';
      }
      if (args.operation === 'reply_email') {
        args.operation = 'replyPreview';
      }
      
      // Mark for resolution if we need to find email
      if (['getEmailById', 'replyPreview', 'markAsRead', 'markAsUnread'].includes(args.operation) && !args.messageId) {
        args._needsResolution = true;
        args._searchHints = {
          from: args.filters?.from,
          subject: args.filters?.subjectContains,
        };
      }
      
      console.log(`[${this.name}] LLM determined operation: ${args.operation}`);
      
      return {
        stepId: step.id,
        type: 'execute',
        args,
      };
    } catch (error: any) {
      console.error(`[${this.name}] LLM call failed:`, error.message);
      
      // Fallback: default to listEmails
      return {
        stepId: step.id,
        type: 'execute',
        args: {
          operation: 'listEmails',
          filters: { maxResults: 10, includeBody: true },
          _fallback: true,
        },
      };
    }
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
