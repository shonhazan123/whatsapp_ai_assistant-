import axios from 'axios';
import { DEBUG_INSTANCE_URL, DEBUG_PHONE_NUMBER, ENVIRONMENT, FORWARD_TO_DEBUG } from '../../config/environment';
import { logger } from '../../utils/logger';

export interface ForwardRequest {
  messageText: string;
  userPhone: string;
  messageId: string;
  messageType: 'text' | 'audio' | 'image';
  replyToMessageId?: string;
  whatsappMessageId?: string;
  [key: string]: any;
}

export interface ForwardResponse {
  success: boolean;
  responseText: string;
  error?: string;
}

export class DebugForwarderService {
  private debugInstanceUrl: string;

  constructor() {
    if (ENVIRONMENT !== 'PRODUCTION') {
      // Service should not be used in DEBUG mode
      this.debugInstanceUrl = '';
      return;
    }

    if (!DEBUG_INSTANCE_URL) {
      throw new Error('DEBUG_INSTANCE_URL is required when ENVIRONMENT is PRODUCTION');
    }

    this.debugInstanceUrl = DEBUG_INSTANCE_URL;
    logger.info(`🔗 DebugForwarderService initialized. DEBUG instance URL: ${this.debugInstanceUrl}`);
  }

  /**
   * Forward request to DEBUG instance
   */
  async forwardToDebug(request: ForwardRequest): Promise<ForwardResponse> {
    if (ENVIRONMENT !== 'PRODUCTION') {
      throw new Error('DebugForwarderService can only be used in PRODUCTION environment');
    }

    if (!this.debugInstanceUrl) {
      throw new Error('DEBUG_INSTANCE_URL is not configured');
    }

    try {
      const url = `${this.debugInstanceUrl}/api/debug/process`;
      logger.info(`[RAILWAY] 📤 Forwarding to DEBUG: ${url}`);
      logger.info(`[RAILWAY] Request payload: ${JSON.stringify(request)}`);

      const response = await axios.post<ForwardResponse>(url, request, {
        timeout: 30000, // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true' // Bypass ngrok free tier interstitial
        }
      });

      logger.info(`[RAILWAY] ✅ Response status: ${response.status}`);
      logger.info(`[RAILWAY] Response body: ${JSON.stringify(response.data)}`);
      return response.data;
    } catch (error: any) {
      logger.error(`[RAILWAY] ❌ Forward failed: ${error.message}`);
      if (error.response) {
        logger.error(`[RAILWAY] Response status: ${error.response.status}`);
        logger.error(`[RAILWAY] Response body: ${JSON.stringify(error.response.data)}`);
      }
      if (error.stack) logger.error(`[RAILWAY] Stack: ${error.stack}`);
      
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        return {
          success: false,
          responseText: 'Debug service is currently unavailable. Please try again later.',
          error: 'DEBUG instance unreachable'
        };
      }

      return {
        success: false,
        responseText: 'An error occurred while processing your request.',
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Check if phone number should be forwarded to DEBUG
   */
  shouldForwardToDebug(phoneNumber: string): boolean {
    return ENVIRONMENT === 'PRODUCTION' && phoneNumber === DEBUG_PHONE_NUMBER && FORWARD_TO_DEBUG;
  }
}

