import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
dotenv.config();
import { WhatsAppWebhookPayload, WhatsAppMessage } from '../types';
import { processMessageV2 } from '../index-v2';
import {
  sendWhatsAppMessage,
  sendTypingIndicator,
  markMessageAsRead,
  downloadWhatsAppMedia
} from '../services/whatsapp';
import { transcribeAudio } from '../services/transcription';
import { logger } from '../utils/logger';


export const whatsappWebhook = express.Router();

// Webhook verification (GET request from WhatsApp)
whatsappWebhook.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('Webhook verified successfully');
    res.status(200).send(challenge);
  } else {
    logger.warn('Webhook verification failed');
    res.sendStatus(403);
  }
});

// Webhook message handler (POST request from WhatsApp)
whatsappWebhook.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const payload: WhatsAppWebhookPayload = req.body;

    // Respond immediately to WhatsApp
    res.sendStatus(200);

    // Process the webhook payload
    if (payload.entry && payload.entry[0]?.changes) {
      for (const change of payload.entry[0].changes) {
        const messages = change.value.messages;
        
        if (messages && messages.length > 0) {
          for (const message of messages) {
            await handleIncomingMessage(message);
          }
        }
      }
    }
  } catch (error) {
    logger.error('Error processing webhook:', error);
    res.sendStatus(500);
  }
});

async function handleIncomingMessage(message: WhatsAppMessage): Promise<void> {
  const startTime = Date.now();
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('📨 NEW MESSAGE RECEIVED');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  try {
    const userPhone = message.from;
    let messageText = '';

    logger.info(`👤 From: ${userPhone}`);
    logger.info(`📋 Message ID: ${message.id}`);
    logger.info(`📝 Type: ${message.type}`);

    // Step 1: Mark message as read and show typing indicator
    logger.debug('Step 1: Sending typing indicator...');
    await sendTypingIndicator(userPhone, message.id);
    logger.debug('✅ Typing indicator sent');

    // Step 2: Handle different message types
    logger.debug('Step 2: Processing message content...');
    if (message.type === 'text' && message.text) {
      messageText = message.text.body;
      logger.info(`💬 Message: "${messageText}"`);
    } else if (message.type === 'audio' && message.audio) {
      // Download and transcribe audio
      logger.info('🎤 Processing audio message');
      const audioBuffer = await downloadWhatsAppMedia(message.audio.id);
      messageText = await transcribeAudio(audioBuffer);
      logger.info(`🎤 Audio transcribed: "${messageText}"`);
    } else {
      // Unsupported message type
      logger.warn(`⚠️  Unsupported message type: ${message.type}`);
      await sendWhatsAppMessage(
        userPhone,
        'Sorry, I can only process text and audio messages at the moment.'
      );
      return;
    }

    // Step 3: Process the message through the AI agent
    logger.debug('Step 3: Processing through AI agent...');
    logger.info(`🤖 AI Processing: "${messageText}"`);
    const response = await processMessageV2(userPhone, messageText);
    logger.info(`💡 AI Response: "${response}"`);

    // Step 4: Send response back to user
    logger.debug('Step 4: Sending response to user...');
    await sendWhatsAppMessage(userPhone, response);
    
    const duration = Date.now() - startTime;
    logger.info(`✅ Message handled successfully in ${duration}ms`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`❌ Error handling message after ${duration}ms:`, error);
    
    try {
      await sendWhatsAppMessage(
        message.from,
        'Sorry, I encountered an error processing your message. Please try again.'
      );
    } catch (sendError) {
      logger.error('Error sending error message:', sendError);
    }
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

export default whatsappWebhook;