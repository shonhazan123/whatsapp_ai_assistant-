/**
 * Image Processing Utilities
 * Handles image validation, compression, and caching
 */

import { createHash } from 'crypto';
import { logger } from '../../utils/logger';

// Dynamic import for sharp (fastest image processing library)
let sharp: any = null;
try {
  sharp = require('sharp');
} catch (error) {
  logger.warn('sharp library not found. Image compression will be limited. Install with: npm install sharp');
}

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
   * Compress image if needed using sharp (fastest image processing library)
   */
  static async compressImage(buffer: Buffer, targetSize?: number): Promise<CompressionResult> {
    const target = targetSize || this.MAX_IMAGE_SIZE_FOR_API;
    const originalSize = buffer.length;
    
    if (originalSize <= target) {
      return {
        compressed: false,
        originalSize,
        compressedSize: originalSize,
        buffer
      };
    }

    try {
      // If sharp is not available, fall back to basic error
      if (!sharp) {
        logger.warn(`Image size (${(originalSize / 1024 / 1024).toFixed(2)}MB) exceeds API limit. Sharp library not installed.`);
        if (originalSize > target * 2) {
          throw new Error(`Image is too large (${(originalSize / 1024 / 1024).toFixed(2)}MB). Please use a smaller image or install sharp: npm install sharp`);
        }
        return {
          compressed: false,
          originalSize,
          compressedSize: originalSize,
          buffer
        };
      }

      logger.info(`Compressing image: ${(originalSize / 1024 / 1024).toFixed(2)}MB → target: ${(target / 1024 / 1024).toFixed(2)}MB`);

      // Detect format
      const format = this.detectImageFormat(buffer);
      const outputFormat = format === 'png' ? 'png' : 'jpeg'; // Convert to JPEG for better compression (except PNG)

      // Progressive compression: try different quality levels
      let quality = 85; // Start with high quality
      let compressedBuffer: Buffer = buffer; // Initialize with original buffer as fallback
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        // Create sharp instance and compress
        let sharpInstance = sharp(buffer);

        // Resize if image is very large (maintain aspect ratio)
        const metadata = await sharp(buffer).metadata();
        const maxDimension = 2048; // Max width or height
        if (metadata.width && metadata.height && (metadata.width > maxDimension || metadata.height > maxDimension)) {
          const ratio = Math.min(maxDimension / metadata.width, maxDimension / metadata.height);
          const newWidth = Math.round(metadata.width * ratio);
          const newHeight = Math.round(metadata.height * ratio);
          logger.info(`Resizing image: ${metadata.width}x${metadata.height} → ${newWidth}x${newHeight}`);
          sharpInstance = sharpInstance.resize(newWidth, newHeight, {
            fit: 'inside',
            withoutEnlargement: true
          });
        }

        // Apply compression based on format
        if (outputFormat === 'jpeg') {
          compressedBuffer = await sharpInstance
            .jpeg({ 
              quality,
              progressive: true,
              mozjpeg: true // Use mozjpeg for better compression
            })
            .toBuffer();
        } else {
          compressedBuffer = await sharpInstance
            .png({ 
              quality,
              compressionLevel: 9,
              adaptiveFiltering: true
            })
            .toBuffer();
        }

        // Check if we've reached target size
        if (compressedBuffer.length <= target) {
          logger.info(`✅ Compression successful: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (quality: ${quality})`);
          return {
            compressed: true,
            originalSize,
            compressedSize: compressedBuffer.length,
            buffer: compressedBuffer
          };
        }

        // Reduce quality for next attempt
        quality -= 15;
        attempts++;

        if (quality < 30) {
          // If quality is too low, stop trying
          logger.warn(`Reached minimum quality threshold. Final size: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB`);
          break;
        }
      }

      // If we still haven't reached target, use the best result we got
      if (compressedBuffer.length > target * 1.5) {
        // If still way too large, throw error
        throw new Error(`Unable to compress image to target size. Final size: ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (target: ${(target / 1024 / 1024).toFixed(2)}MB)`);
      }

      logger.warn(`⚠️  Compression reached ${(compressedBuffer.length / 1024 / 1024).toFixed(2)}MB (target: ${(target / 1024 / 1024).toFixed(2)}MB)`);
      return {
        compressed: true,
        originalSize,
        compressedSize: compressedBuffer.length,
        buffer: compressedBuffer
      };

    } catch (error: any) {
      logger.error('Error compressing image:', error);
      
      // If compression fails but image is not too large, return original
      if (originalSize <= target * 1.5) {
        logger.warn('Compression failed, using original image');
        return {
          compressed: false,
          originalSize,
          compressedSize: originalSize,
          buffer
        };
      }
      
      throw new Error(`Failed to compress image: ${error.message || 'Unknown error'}`);
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

