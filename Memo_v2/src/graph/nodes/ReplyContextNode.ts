/**
 * ReplyContextNode - Handles reply-to context
 * 
 * Enriches input.message with:
 * - Reply-to message content
 * - Numbered list disambiguation
 * - Image context from recent messages
 * 
 * ❌ No reasoning
 * ❌ No LLM
 * ✅ Deterministic
 */

import type { ImageContext } from '../../types/index.js';
import type { MemoState } from '../state/MemoState.js';
import { CodeNode } from './BaseNode.js';

export class ReplyContextNode extends CodeNode {
  readonly name = 'reply_context';
  
  protected async process(state: MemoState): Promise<Partial<MemoState>> {
    let enhancedMessage = state.input.message;
    let imageContext: ImageContext | undefined = state.input.imageContext;
    
    // 1. Check if this is a reply to a previous message
    if (state.input.replyToMessageId) {
      const repliedTo = this.findMessageById(state.input.replyToMessageId, state.recentMessages);
      
      if (repliedTo) {
        // Check for numbered list (like "1. Event 1\n2. Event 2")
        if (this.hasNumberedList(repliedTo.content)) {
          enhancedMessage = this.buildNumberedListContext(repliedTo.content, state.input.message);
        } else {
          enhancedMessage = this.buildReplyContext(repliedTo.content, state.input.message);
        }
        
        // Check for image context in replied message
        if (repliedTo.metadata?.imageContext) {
          imageContext = repliedTo.metadata.imageContext;
        }
      }
    }
    
    // 2. Check for image context in recent messages (last 3) if not already found
    if (!imageContext) {
      imageContext = this.findRecentImageContext(state.recentMessages);
    }
    
    // 3. Include image context in enhanced message if found
    if (imageContext) {
      enhancedMessage = this.buildImageContextMessage(imageContext, enhancedMessage);
    }
    
    return {
      input: {
        ...state.input,
        enhancedMessage,
        imageContext,
      },
    };
  }
  
  // ========================================================================
  // Helper methods
  // ========================================================================
  
  private findMessageById(
    messageId: string,
    messages: MemoState['recentMessages']
  ) {
    return messages.find(m => m.whatsappMessageId === messageId);
  }
  
  private hasNumberedList(content: string): boolean {
    // Matches patterns like "1. " or "1) " at start of lines
    const numberedListRegex = /^\d+[\.\)]\s/m;
    return numberedListRegex.test(content);
  }
  
  private buildNumberedListContext(listContent: string, userSelection: string): string {
    // Extract the number from user's message (e.g., "1", "2", or "the first one")
    const selectedNumber = this.extractSelectionNumber(userSelection);
    
    if (selectedNumber !== null) {
      // Find the corresponding item in the list
      const lines = listContent.split('\n');
      const selectedLine = lines.find(line => {
        const match = line.match(/^(\d+)[\.\)]\s/);
        return match && parseInt(match[1]) === selectedNumber;
      });
      
      if (selectedLine) {
        return `[User selected from list: "${selectedLine.trim()}"]\nUser message: ${userSelection}`;
      }
    }
    
    return `[Replying to numbered list]\n${listContent}\n\nUser selection: ${userSelection}`;
  }
  
  private extractSelectionNumber(message: string): number | null {
    // Direct number
    const directMatch = message.match(/^(\d+)$/);
    if (directMatch) {
      return parseInt(directMatch[1]);
    }
    
    // "the first one", "second", etc.
    const ordinals: Record<string, number> = {
      'first': 1, 'ראשון': 1,
      'second': 2, 'שני': 2,
      'third': 3, 'שלישי': 3,
      'fourth': 4, 'רביעי': 4,
      'fifth': 5, 'חמישי': 5,
    };
    
    for (const [word, num] of Object.entries(ordinals)) {
      if (message.toLowerCase().includes(word)) {
        return num;
      }
    }
    
    return null;
  }
  
  private buildReplyContext(repliedContent: string, userMessage: string): string {
    // Truncate if too long
    const truncated = repliedContent.length > 200 
      ? repliedContent.substring(0, 200) + '...' 
      : repliedContent;
    
    return `[Replying to: "${truncated}"]\n\n${userMessage}`;
  }
  
  private findRecentImageContext(messages: MemoState['recentMessages']): ImageContext | undefined {
    // Look at last 3 messages for image context
    const recent = messages.slice(-3);
    
    for (const message of recent.reverse()) {
      if (message.metadata?.imageContext) {
        // Check if not expired (within 5 minutes)
        const fiveMinutes = 5 * 60 * 1000;
        if (Date.now() - message.metadata.imageContext.extractedAt < fiveMinutes) {
          return message.metadata.imageContext;
        }
      }
    }
    
    return undefined;
  }
  
  private buildImageContextMessage(imageContext: ImageContext, message: string): string {
    const analysis = imageContext.analysisResult;
    
    let context = `[Image context from earlier: ${analysis.description}`;
    
    if (analysis.extractedText) {
      context += `\nExtracted text: ${analysis.extractedText}`;
    }
    
    if (analysis.structuredData) {
      context += `\nStructured data: ${JSON.stringify(analysis.structuredData)}`;
    }
    
    context += ']';
    
    return `${context}\n\n${message}`;
  }
}

/**
 * Factory function for LangGraph node registration
 */
export function createReplyContextNode() {
  const node = new ReplyContextNode();
  return node.asNodeFunction();
}

