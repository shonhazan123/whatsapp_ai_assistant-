import express, { Request, Response } from 'express';
import { ENVIRONMENT } from '../config/environment';
import { WhatsAppMessage } from '../types/whatsapp';
import { logger } from '../legacy/utils/logger';
import { handleIncomingMessage } from './webhook';

export const debugRouter = express.Router();

/**
 * Debug endpoint for receiving forwarded requests from PRODUCTION
 * Only accessible when ENVIRONMENT is DEBUG
 */
debugRouter.post('/process', async (req: Request, res: Response) => {
  if (ENVIRONMENT !== 'DEBUG') {
    logger.warn('⚠️  /api/debug/process called but ENVIRONMENT is not DEBUG');
    return res.status(403).json({
      success: false,
      error: 'This endpoint is only available in DEBUG environment'
    });
  }

  try {
    const {
      messageText,
      userPhone,
      messageId,
      messageType,
      replyToMessageId,
      whatsappMessageId,
      ...otherFields
    } = req.body;

    if (!messageText || !userPhone) {
      return res.status(400).json({
        success: false,
        error: 'messageText and userPhone are required'
      });
    }

    logger.info(`📥 Received forwarded request from PRODUCTION for user: ${userPhone}`);

    // Construct WhatsApp message format from forwarded request
    const whatsappMessage: WhatsAppMessage = {
      from: userPhone,
      id: messageId || whatsappMessageId || `debug_${Date.now()}`,
      type: messageType || 'text',
      text: messageType === 'text' ? { body: messageText } : undefined,
      audio: messageType === 'audio' ? { id: otherFields.audioId } : undefined,
      image: messageType === 'image' ? { id: otherFields.imageId, caption: otherFields.imageCaption } : undefined,
      context: replyToMessageId ? { id: replyToMessageId } : undefined,
      ...otherFields
    };

    // Process using existing handleIncomingMessage function
    await handleIncomingMessage(whatsappMessage);

    // Note: handleIncomingMessage sends the response to WhatsApp directly
    // We return success to PRODUCTION
    res.json({
      success: true,
      responseText: 'Message processed successfully'
    });
  } catch (error: any) {
    logger.error('Error processing forwarded request:', error?.message ?? error);
    if (error?.stack) console.error(error.stack);
    if (error?.response?.data) logger.error('API Error response:', error.response.data);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      responseText: 'An error occurred while processing your request.'
    });
  }
});

