// src/services/memory.ts
import { query } from '../config/database';
import { ConversationMessage } from '../types';
import { logger } from '../utils/logger';

/**
 * Best Practice: Sliding Window Approach
 * - Keep only recent messages (default: last 10 exchanges = 20 messages)
 * - Prevents token overflow
 * - Maintains relevant context
 */
const DEFAULT_MESSAGE_LIMIT = 20; // 10 user + 10 assistant messages
const MAX_MESSAGE_AGE_HOURS = 24; // Clear old conversations

/**
 * Get conversation history with intelligent context management
 * Returns messages in chronological order (oldest first)
 */
export async function getConversationHistory(
  userPhone: string,
  limit: number = DEFAULT_MESSAGE_LIMIT
): Promise<ConversationMessage[]> {
  try {
    // Get recent messages within time window using user_id
    const result = await query(
      `SELECT cm.role, cm.content, cm.created_at 
       FROM conversation_memory cm
       JOIN users u ON cm.user_id = u.id
       WHERE u.phone = $1 
         AND cm.created_at > NOW() - INTERVAL '${MAX_MESSAGE_AGE_HOURS} hours'
       ORDER BY cm.created_at DESC 
       LIMIT $2`,
      [userPhone, limit]
    );

    // Return in chronological order (oldest first) for proper context
    const messages = result.rows.reverse().map(row => ({
      role: row.role as 'user' | 'assistant' | 'system',
      content: row.content
    }));

    logger.info(`Retrieved ${messages.length} messages for ${userPhone}`);
    return messages;
  } catch (error) {
    logger.error('Error getting conversation history:', error);
    return [];
  }
}

/**
 * Save a message to conversation history
 * Automatically cleans up old messages to prevent database bloat
 * Uses get_or_create_user function to ensure user exists
 */
export async function saveMessage(
  userPhone: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<void> {
  try {
    // Get or create user and save message in one transaction
    await query(
      `INSERT INTO conversation_memory (user_id, role, content) 
       VALUES (get_or_create_user($1), $2, $3)`,
      [userPhone, role, content]
    );

    // Clean up old messages (keep only last 50 messages per user)
    await query(
      `DELETE FROM conversation_memory 
       WHERE id IN (
         SELECT cm.id FROM conversation_memory cm
         JOIN users u ON cm.user_id = u.id
         WHERE u.phone = $1 
         ORDER BY cm.created_at DESC 
         OFFSET 50
       )`,
      [userPhone]
    );

    logger.debug(`Saved ${role} message for ${userPhone}`);
  } catch (error) {
    logger.error('Error saving message:', error);
    throw error;
  }
}

/**
 * Store last resolution context (intent/entities) as a system message for quick recall
 */
export async function saveResolutionContext(userPhone: string, context: any): Promise<void> {
  try {
    const payload = { type: 'resolution_context', at: new Date().toISOString(), ...context };
    await saveMessage(userPhone, 'system', JSON.stringify(payload));
  } catch (error) {
    logger.error('Error saving resolution context:', error);
  }
}

/**
 * Retrieve the most recent resolution context from conversation memory
 */
export async function getLastResolutionContext(userPhone: string): Promise<any | null> {
  try {
    const result = await query(
      `SELECT cm.content
       FROM conversation_memory cm
       JOIN users u ON cm.user_id = u.id
       WHERE u.phone = $1 
       AND cm.role = 'system'
       ORDER BY cm.created_at DESC 
       LIMIT 20`,
      [userPhone]
    );

    for (const row of result.rows) {
      try {
        const obj = JSON.parse(row.content);
        if (obj && obj.type === 'resolution_context') {
          return obj;
        }
      } catch {}
    }
    return null;
  } catch (error) {
    logger.error('Error getting last resolution context:', error);
    return null;
  }
}

/**
 * Clear conversation history for a user
 * Useful for "start fresh" or privacy requests
 */
export async function clearConversationHistory(userPhone: string): Promise<void> {
  try {
    await query(
      `DELETE FROM conversation_memory 
       WHERE user_id IN (SELECT id FROM users WHERE phone = $1)`,
      [userPhone]
    );
    logger.info(`Cleared conversation history for ${userPhone}`);
  } catch (error) {
    logger.error('Error clearing conversation history:', error);
    throw error;
  }
}

/**
 * Get conversation statistics for monitoring
 */
export async function getConversationStats(userPhone: string): Promise<{
  totalMessages: number;
  oldestMessage: Date | null;
  newestMessage: Date | null;
}> {
  try {
    const result = await query(
      `SELECT 
         COUNT(*) as total,
         MIN(cm.created_at) as oldest,
         MAX(cm.created_at) as newest
       FROM conversation_memory cm
       JOIN users u ON cm.user_id = u.id
       WHERE u.phone = $1`,
      [userPhone]
    );

    return {
      totalMessages: parseInt(result.rows[0].total),
      oldestMessage: result.rows[0].oldest,
      newestMessage: result.rows[0].newest
    };
  } catch (error) {
    logger.error('Error getting conversation stats:', error);
    return { totalMessages: 0, oldestMessage: null, newestMessage: null };
  }
}

/**
 * Estimate token count for messages (rough approximation)
 * 1 token ≈ 4 characters for English text
 */
export function estimateTokens(messages: ConversationMessage[]): number {
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  return Math.ceil(totalChars / 4);
}
