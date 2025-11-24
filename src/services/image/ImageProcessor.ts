/**
 * Image Processing Utilities
 * Handles image validation, compression, and caching
 */

import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

export interface ImageValidationResult {
  valid: boolean;
  error?: string;
  size?: number;
  format?: string;
  needsCompression?: boolean;
}

export interface CompressionResult {
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
  buffer: Buffer;
}

export class ImageProcessor {
  private static readonly MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
  private static readonly MAX_IMAGE_SIZE_FOR_API = 4 * 1024 * 1024; // 4MB (OpenAI limit)
  private static readonly COMPRESSION_QUALITY = 0.8; // 80% quality for JPEG

  /**
   * Validate image buffer
   */
  static validateImage(buffer: Buffer): ImageValidationResult {
    try {
      // Check size
      if (buffer.length === 0) {
        return { valid: false, error: 'Image is empty' };
      }

      if (buffer.length > this.MAX_IMAGE_SIZE) {
        return {
          valid: false,
          error: `Image is too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB). Maximum size is ${this.MAX_IMAGE_SIZE / 1024 / 1024}MB`
        };
      }

      // Detect format by checking magic bytes
      const format = this.detectImageFormat(buffer);
      if (!format) {
        return { valid: false, error: 'Unsupported image format. Please use JPEG, PNG, or WebP' };
      }

      // Check if compression is needed for API
      const needsCompression = buffer.length > this.MAX_IMAGE_SIZE_FOR_API;

      return {
        valid: true,
        size: buffer.length,
        format,
        needsCompression
      };
    } catch (error) {
      logger.error('Error validating image:', error);
      return { valid: false, error: 'Failed to validate image' };
    }
  }

  /**
   * Detect image format from magic bytes
   */
  private static detectImageFormat(buffer: Buffer): string | null {
    if (buffer.length < 4) return null;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      return 'jpeg';
    }

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      return 'png';
    }

    // WebP: Check for RIFF...WEBP
    if (buffer.length >= 12) {
      const header = buffer.toString('ascii', 0, 4);
      const webpHeader = buffer.toString('ascii', 8, 12);
      if (header === 'RIFF' && webpHeader === 'WEBP') {
        return 'webp';
      }
    }

    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
      return 'gif';
    }

    return null;
  }

  /**
   * Compress image if needed
   * Note: This is a basic implementation. For production, consider using sharp or jimp library
   */
  static async compressImage(buffer: Buffer, targetSize?: number): Promise<CompressionResult> {
    const target = targetSize || this.MAX_IMAGE_SIZE_FOR_API;
    
    if (buffer.length <= target) {
      return {
        compressed: false,
        originalSize: buffer.length,
        compressedSize: buffer.length,
        buffer
      };
    }

    try {
      // For now, we'll just return the original buffer with a warning
      // In production, you should use a library like 'sharp' for actual compression
      logger.warn(`Image size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds API limit. Compression not implemented yet.`);
      
      // TODO: Implement actual compression using sharp or jimp
      // For now, we'll truncate if it's way too large (not ideal, but prevents API errors)
      if (buffer.length > target * 2) {
        logger.error(`Image is too large even after compression attempt. Size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
        throw new Error(`Image is too large (${(buffer.length / 1024 / 1024).toFixed(2)}MB). Please use a smaller image.`);
      }

      return {
        compressed: false, // Not actually compressed, but within acceptable range
        originalSize: buffer.length,
        compressedSize: buffer.length,
        buffer
      };
    } catch (error) {
      logger.error('Error compressing image:', error);
      throw error;
    }
  }

  /**
   * Generate hash for image caching
   */
  static generateImageHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Get MIME type from format
   */
  static getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      'jpeg': 'image/jpeg',
      'jpg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif'
    };
    return mimeTypes[format.toLowerCase()] || 'image/jpeg';
  }
}

