// src/services/whatsapp.ts
import axios from 'axios';
import { ConversationWindow } from '../core/memory/ConversationWindow';
import { logger } from '../utils/logger';

const WHATSAPP_API_URL = 'https://graph.facebook.com/v22.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_API_TOKEN;

export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: to,
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    logger.info(`Message sent to ${to}`);
    
    // Add message to conversation memory (non-blocking)
    try {
      const conversationWindow = ConversationWindow.getInstance();
      conversationWindow.addMessage(to, 'assistant', message);
    } catch (memoryError) {
      // Don't fail message sending if memory save fails
      logger.warn('Failed to save message to conversation memory:', memoryError);
    }
  } catch (error) {
    logger.error('Error sending WhatsApp message:', error);
    throw error;
  }
}

export async function sendTypingIndicator(to: string, messageId: string): Promise<void> {
  try {
    // Note: This combines marking as read with a typing indicator
    // Based on user's working n8n implementation
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: {
          type: 'text'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    logger.info(`Typing indicator and read status sent for message ${messageId}`);
  } catch (error) {
    logger.error('Error sending typing indicator:', error);
  }
}

export async function markMessageAsRead(messageId: string): Promise<void> {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      },
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (error) {
    logger.error('Error marking message as read:', error);
  }
}

export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  try {
    // Get media URL
    const mediaInfo = await axios.get(
      `${WHATSAPP_API_URL}/${mediaId}`,
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        }
      }
    );

    const mediaUrl = mediaInfo.data.url;

    // Download media
    const response = await axios.get(mediaUrl, {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      },
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  } catch (error) {
    logger.error('Error downloading media:', error);
    throw error;
  }
}

