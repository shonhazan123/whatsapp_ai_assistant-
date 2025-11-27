import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import { RequestContext } from '../core/context/RequestContext';
import { ConversationWindow } from '../core/memory/ConversationWindow';
import { processMessageV2 } from '../index-v2';
import { OpenAIService } from '../services/ai/OpenAIService';
import { googleOAuthService } from '../services/auth/GoogleOAuthService';
import { GoogleTokenManager } from '../services/auth/GoogleTokenManager';
import { UserGoogleToken, UserRecord, UserService } from '../services/database/UserService';
import { transcribeAudio } from '../services/transcription';
import {
  downloadWhatsAppMedia,
  sendTypingIndicator,
  sendWhatsAppMessage
} from '../services/whatsapp';
import { WhatsAppMessage, WhatsAppWebhookPayload } from '../types';
import { RequestUserContext, UserCapabilities } from '../types/UserContext';
import { logger } from '../utils/logger';
dotenv.config();


export const whatsappWebhook = express.Router();

const userService = new UserService();
const googleTokenManager = new GoogleTokenManager();
const openaiService = new OpenAIService(logger);
const conversationWindow = ConversationWindow.getInstance();

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
    const rawNumber = message.from;
    const userPhone = normalizeWhatsAppNumber(rawNumber);
    let messageText = '';

    logger.info(`👤 From: ${userPhone}`);
    logger.info(`📋 Message ID: ${message.id}`);
    logger.info(`📝 Type: ${message.type}`);
    
    // Extract reply context if this is a reply to a previous message
    const replyToMessageId = message.context?.id;
    if (replyToMessageId) {
      logger.info(`↩️  This is a reply to message ID: ${replyToMessageId}`);
    }

    await sendTypingIndicator(userPhone, message.id);

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
    } else if (message.type === 'image' && message.image) {
      // Download and analyze image
      logger.info('🖼️  Processing image message');
      
      let imageBuffer: Buffer;
      const imageCaption = message.image.caption || '';
      
      // Step 1: Download image with error handling
      try {
        imageBuffer = await downloadWhatsAppMedia(message.image.id);
        logger.info(`📷 Image downloaded (${(imageBuffer.length / 1024).toFixed(2)}KB)`);
      } catch (downloadError: any) {
        logger.error('Error downloading image:', downloadError);
        const errorMessage = downloadError.message?.includes('not found') 
          ? 'Sorry, I couldn\'t access the image. It may have expired or been deleted. Please send the image again.'
          : downloadError.message?.includes('timeout')
          ? 'The image download timed out. Please try sending the image again.'
          : 'Sorry, I couldn\'t download your image. Please try sending it again.';
        
        await sendWhatsAppMessage(userPhone, errorMessage);
        return;
      }
      
      if (imageCaption) {
        logger.info(`📝 Image caption: "${imageCaption}"`);
      }
      
      // Step 2: Analyze image using OpenAI Vision
      try {
        const analysisResult = await openaiService.analyzeImage(imageBuffer, imageCaption);
        logger.info(`✅ Image analysis complete: ${analysisResult.imageType} (confidence: ${analysisResult.confidence})`);
        
        // Store image context in conversation memory for future reference
        conversationWindow.addMessage(
          userPhone,
          'user',
          imageCaption || '[Image]',
          {
            imageContext: {
              imageId: message.image.id,
              analysisResult: analysisResult,
              imageType: analysisResult.imageType,
              extractedAt: Date.now()
            }
          },
          message.id
        );
        logger.info(`💾 Stored image context in conversation memory`);
        
        // Send formatted message directly from LLM
        const responseMessage = analysisResult.formattedMessage || 
          'I analyzed your image. Is there anything you\'d like me to help you with?';
        
        await sendWhatsAppMessage(userPhone, responseMessage);
        logger.info(`📤 Sent formatted image analysis response to ${userPhone}`);
      } catch (error: any) {
        logger.error('Error analyzing image:', error);
        
        // The analyzeImage method already returns a formatted error message
        // But we'll send a user-friendly message here as well
        const errorMessage = error.message || 'Sorry, I encountered an error analyzing your image.';
        await sendWhatsAppMessage(
          userPhone,
          errorMessage.includes('rate limit')
            ? 'The image analysis service is currently busy. Please try again in a few moments.'
            : errorMessage.includes('timeout')
            ? 'The image took too long to process. Please try with a smaller image.'
            : 'Sorry, I encountered an error analyzing your image. Please try again or describe what you see.'
        );
      }
      return; // Exit early - image processing complete
    } else {
      // Unsupported message type
      logger.warn(`⚠️  Unsupported message type: ${message.type}`);
      await sendWhatsAppMessage(
        userPhone,
        'Sorry, I can only process text, audio, and image messages at the moment.'
      );
      return;
    }

    let userRecord = await userService.findOrCreateByWhatsappNumber(userPhone);
    if (userRecord.plan_type !== 'pro') {
      userRecord = await userService.updatePlanType(userRecord.id, 'pro') ?? userRecord;
    }
    let tokens = await userService.getGoogleTokens(userRecord.id);
    const capabilities = determineCapabilities(userRecord.plan_type);

    let googleConnected = false;
    if (hasGoogleIntegrations(capabilities)) {
      try {
        const tokenResult = await googleTokenManager.ensureFreshTokens(userRecord, tokens, { forceRefresh: true });
        tokens = tokenResult.tokens;
        googleConnected = tokenResult.googleConnected;

        if (tokenResult.needsReauth) {
          await promptGoogleReconnect(userRecord, userPhone, capabilities);
          return;
        }
      } catch (tokenError) {
        logger.error('Error ensuring Google tokens are fresh:', tokenError);
        await promptGoogleReconnect(userRecord, userPhone, capabilities);
        return;
      }
    }

    const onboardingSent = await maybeSendOnboarding(userRecord, userPhone, capabilities, googleConnected);
    if (!googleConnected && hasGoogleIntegrations(capabilities)) {
      if (!onboardingSent) {
        await promptGoogleReconnect(userRecord, userPhone, capabilities);
      }
      logger.info(`Waiting for Google connection from ${userPhone}, stopping processing`);
      return;
    }

    const context: RequestUserContext = {
      user: userRecord,
      planType: userRecord.plan_type,
      whatsappNumber: userRecord.whatsapp_number,
      capabilities,
      googleTokens: tokens,
      googleConnected
    };

    logger.info(`🤖 AI Processing: "${messageText}"`);
    const response = await RequestContext.run(context, () => 
      processMessageV2(userPhone, messageText, {
        whatsappMessageId: message.id,
        replyToMessageId: replyToMessageId
      })
    );
    logger.info(`💡 AI Response: "${response}"`);

    // Step 4: Send response back to user
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

function normalizeWhatsAppNumber(number: string): string {
  const cleaned = number.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  if (cleaned.startsWith('00')) {
    return `+${cleaned.slice(2)}`;
  }
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}

function determineCapabilities(planType: string): UserCapabilities {
  switch (planType) {
    case 'pro':
      return { database: true, calendar: true, gmail: true };
    case 'standard':
      return { database: true, calendar: true, gmail: false };
    default:
      return { database: true, calendar: false, gmail: false };
  }
}

function hasGoogleIntegrations(capabilities: UserCapabilities): boolean {
  return capabilities.calendar || capabilities.gmail;
}

function isTokenValid(tokens?: UserGoogleToken | null): boolean {
  if (!tokens) return false;
  const hasCredential = Boolean(tokens.refresh_token || tokens.access_token);
  if (!hasCredential) return false;
  if (!tokens.expires_at) return true;
  const expiry = new Date(tokens.expires_at);
  const bufferMs = 2 * 60 * 1000; // 2 minutes buffer
  return expiry.getTime() > Date.now() + bufferMs;
}

async function maybeSendOnboarding(
  user: UserRecord,
  whatsappNumber: string,
  capabilities: UserCapabilities,
  googleConnected: boolean
): Promise<boolean> {
  if (!hasGoogleIntegrations(capabilities)) {
    return false;
  }

  if (googleConnected) {
    return false;
  }

  const appUrl = process.env.APP_PUBLIC_URL;
  if (!appUrl) {
    logger.error('APP_PUBLIC_URL is not configured; cannot send onboarding link');
    return false;
  }

  const state = googleOAuthService.createStateToken({
    userId: user.id,
    planType: user.plan_type
  });
  const authUrl = `${appUrl.replace(/\/$/, '')}/auth/google?state=${encodeURIComponent(state)}`;

  const message = buildOnboardingMessage(capabilities, authUrl);

  await sendWhatsAppMessage(whatsappNumber, message);
  await userService.markOnboardingPrompted(user.id);
  logger.info(`Sent onboarding prompt to ${whatsappNumber}`);
  return true;
}

async function promptGoogleReconnect(
  user: UserRecord,
  whatsappNumber: string,
  capabilities: UserCapabilities
): Promise<void> {
  const appUrl = process.env.APP_PUBLIC_URL;
  if (!appUrl) {
    logger.error('APP_PUBLIC_URL is not configured; cannot send reconnect link');
    return;
  }

  const state = googleOAuthService.createStateToken({
    userId: user.id,
    planType: user.plan_type
  });
  const authUrl = `${appUrl.replace(/\/$/, '')}/auth/google?state=${encodeURIComponent(state)}`;
  const message = buildOnboardingMessage(capabilities, authUrl);

  await sendWhatsAppMessage(whatsappNumber, message);
  await userService.markOnboardingPrompted(user.id);
  logger.info(`Prompted ${whatsappNumber} to reconnect Google account`);
}

function buildOnboardingMessage(capabilities: UserCapabilities, authUrl: string): string {
  return [
    'כדי לפתוח את כל היכולות המלאות שלי אני צריך שתתחבר לחשבון Google שלך.',
    '',
    'מה אפשר לעשות אחרי החיבור:',
    
    '• ניהול יומן – כשאתה רוצה שהבקשה תתועד ביומן, ציין את המילה "יומן" או כתוב במפורש "תוסיף ליומן...".',
    
    '• תזכורות ומשימות – אני שומר עבורך את המשימות בזיכרון האישי שלי.',
    ...(capabilities.gmail
      ? ['• דואר אלקטרוני – אני יכול להכין טיוטות, לשלוח מיילים ולהמשיך שיחות מתוך Gmail עבורך.']
      : []),
    '• סוכן כללי – אפשר לשאול אותי כל שאלה כללית או לבקש עזרה בכל נושא אחר.',
    '',
    `🔗 התחבר כאן: ${authUrl}`,
    '',
    'אחרי שסיימת את ההתחברות, כתוב לי "התחברתי" או "סיימתי" ונמשיך!'
  ].join('\n');
}