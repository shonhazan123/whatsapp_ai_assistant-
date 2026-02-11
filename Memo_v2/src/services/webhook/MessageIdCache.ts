/**
 * Message ID Cache
 * Prevents duplicate processing of WhatsApp webhook messages
 * Uses TTL-based expiration (48 hours to cover WhatsApp's retry window)
 */

import { logger } from '../../legacy/utils/logger';

export class MessageIdCache {
  private static instance: MessageIdCache;
  private cache: Map<string, number> = new Map(); // messageId -> timestamp
  private readonly TTL = 48 * 60 * 60 * 1000; // 48 hours (longer than WhatsApp's 24h retry window)

  private constructor() {
    // Clean up expired entries every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  public static getInstance(): MessageIdCache {
    if (!MessageIdCache.instance) {
      MessageIdCache.instance = new MessageIdCache();
    }
    return MessageIdCache.instance;
  }

  /**
   * Check if message ID has been processed
   * @returns true if already processed, false if new
   */
  public has(messageId: string): boolean {
    const timestamp = this.cache.get(messageId);
    
    if (!timestamp) {
      return false;
    }

    // Check if expired
    if (Date.now() - timestamp > this.TTL) {
      this.cache.delete(messageId);
      return false;
    }

    return true;
  }

  /**
   * Mark message ID as processed
   */
  public add(messageId: string): void {
    this.cache.set(messageId, Date.now());
    logger.debug(`📝 Cached message ID: ${messageId.substring(0, 20)}...`);
  }

  /**
   * Clear expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [messageId, timestamp] of this.cache.entries()) {
      if (now - timestamp > this.TTL) {
        this.cache.delete(messageId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`🧹 Cleaned up ${cleaned} expired message IDs`);
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): { size: number; ttl: number } {
    return {
      size: this.cache.size,
      ttl: this.TTL
    };
  }
}

