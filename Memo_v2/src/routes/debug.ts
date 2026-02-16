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
  // [TRACE] First line - request hit the route handler (force flush with \n)
  const entryTs = new Date().toISOString();
  process.stdout.write(`\n[TRACE] ${entryTs} >>> DEBUG ROUTE HANDLER ENTERED <<<\n`);
  logger.info(`[TRACE] DEBUG ROUTE /process handler entered`);

  if (ENVIRONMENT !== 'DEBUG') {
    logger.warn('⚠️  /api/debug/process called but ENVIRONMENT is not DEBUG');
    return res.status(403).json({
      success: false,
      error: 'This endpoint is only available in DEBUG environment'
    });
  }

  try {
    process.stdout.write(`[TRACE] ${new Date().toISOString()} Extracting req.body...\n`);
    const {
      messageText,
      userPhone,
      messageId,
      messageType,
      replyToMessageId,
      whatsappMessageId,
      ...otherFields
    } = req.body;

    process.stdout.write(`[TRACE] ${new Date().toISOString()} Extracted: messageText=${!!messageText} userPhone=${userPhone}\n`);

    if (!messageText || !userPhone) {
      logger.error(`[DEBUG] Missing required fields: messageText=${!!messageText}, userPhone=${!!userPhone}`);
      return res.status(400).json({
        success: false,
        error: 'messageText and userPhone are required'
      });
    }

    logger.info(`[DEBUG] 📥 Received from PRODUCTION: user=${userPhone} | msg="${messageText}" | type=${messageType}`);

    // Construct WhatsApp message format from forwarded request
    logger.info(`[DEBUG] Step 1: Constructing whatsappMessage...`);
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
    process.stdout.write(`[TRACE] ${new Date().toISOString()} Calling handleIncomingMessage...\n`);
    logger.info(`[DEBUG] Step 2: Calling handleIncomingMessage...`);
    await handleIncomingMessage(whatsappMessage);
    process.stdout.write(`[TRACE] ${new Date().toISOString()} handleIncomingMessage DONE - sending 200\n`);
    logger.info(`[DEBUG] Step 3: handleIncomingMessage completed successfully`);

    // Note: handleIncomingMessage sends the response to WhatsApp directly
    // We return success to PRODUCTION
    res.json({
      success: true,
      responseText: 'Message processed successfully'
    });
  } catch (error: any) {
    process.stdout.write(`[TRACE] ${new Date().toISOString()} >>> DEBUG ROUTE CAUGHT ERROR <<<\n`);
    logger.error(`[DEBUG] ❌ Error in forwarded request: ${error?.message ?? error}`);
    if (error?.stack) {
      process.stdout.write(`[TRACE] Stack: ${error.stack}\n`);
      console.error(`[DEBUG] Stack trace:\n`, error.stack);
    }
    if (error?.response?.data) logger.error('[DEBUG] API Error response:', error.response.data);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      responseText: 'An error occurred while processing your request.'
    });
  }
});

