/**
 * Memo V2 WhatsApp service
 *
 * Copy of V1 send + memory logic; uses Memo_v2 ConversationWindow (via MemoryService)
 * so sent message IDs are stored for reply context.
 */

import axios from "axios";
import { logger } from "../utils/logger.js";
import { getMemoryService } from "./memory/index.js";

const WHATSAPP_API_URL = "https://graph.facebook.com/v22.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_API_TOKEN;

export async function sendWhatsAppMessage(
	to: string,
	message: string,
): Promise<string | null> {
	try {
		// Validate message is not empty
		if (!message || message.trim().length === 0) {
			logger.error(`Cannot send empty message to ${to}`);
			throw new Error("Message cannot be empty");
		}

		// WhatsApp API requires phone numbers without + sign
		const normalizedPhone = to.replace(/^\+/, "");

		// Check message length (WhatsApp has a 4096 character limit)
		if (message.length > 4096) {
			logger.warn(
				`Message too long (${message.length} chars), truncating to 4096 characters`,
			);
			message = message.substring(0, 4093) + "...";
		}

		const response = await axios.post(
			`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`,
			{
				messaging_product: "whatsapp",
				to: normalizedPhone,
				text: { body: message },
			},
			{
				headers: {
					Authorization: `Bearer ${ACCESS_TOKEN}`,
					"Content-Type": "application/json",
				},
			},
		);

		// Extract message ID from response
		const messageId = response.data?.messages?.[0]?.id || null;
		logger.info(
			`Message sent to ${to}${messageId ? ` (ID: ${messageId})` : ""}`,
		);

		// Add message to Memo_v2 conversation memory with message ID (non-blocking)
		try {
			getMemoryService().addAssistantMessage(
				to,
				message,
				messageId || undefined,
			);
		} catch (memoryError) {
			// Don't fail message sending if memory save fails
			logger.warn(
				"Failed to save message to conversation memory:",
				memoryError,
			);
		}

		return messageId;
	} catch (error: any) {
		// Log detailed error information from WhatsApp API
		if (error.response) {
			const errorData = error.response.data;
			logger.error("Error sending WhatsApp message:", {
				status: error.response.status,
				statusText: error.response.statusText,
				error: errorData?.error || errorData,
				phone: to,
				messageLength: message.length,
			});
		} else {
			logger.error("Error sending WhatsApp message:", {
				message: error.message,
				phone: to,
				messageLength: message.length,
			});
		}
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
  
export async function downloadWhatsAppMedia(
	mediaId: string,
	retries: number = 3,
): Promise<Buffer> {
	let lastError: any;

	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			// Get media URL
			const mediaInfo = await axios.get(`${WHATSAPP_API_URL}/${mediaId}`, {
				headers: {
					Authorization: `Bearer ${ACCESS_TOKEN}`,
				},
				timeout: 10000, // 10 second timeout
			});

			if (!mediaInfo.data?.url) {
				throw new Error("Media URL not found in response");
			}

			const mediaUrl = mediaInfo.data.url;

			// Download media with timeout
			const response = await axios.get(mediaUrl, {
				headers: {
					Authorization: `Bearer ${ACCESS_TOKEN}`,
				},
				responseType: "arraybuffer",
				timeout: 30000, // 30 second timeout for download
				maxContentLength: 25 * 1024 * 1024, // 25MB max
				maxBodyLength: 25 * 1024 * 1024,
			});

			if (!response.data || response.data.length === 0) {
				throw new Error("Downloaded media is empty");
			}

			return Buffer.from(response.data);
		} catch (error: any) {
			lastError = error;

			// Don't retry on certain errors
			if (error.response?.status === 404) {
				throw new Error(
					"Media not found. It may have expired or been deleted.",
				);
			}

			if (error.response?.status === 403) {
				throw new Error(
					"Access denied to media. Please check your WhatsApp API permissions.",
				);
			}

			// Log retry attempt
			if (attempt < retries) {
				const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
				logger.warn(
					`Failed to download media (attempt ${attempt}/${retries}), retrying in ${delay}ms...`,
				);
				await new Promise((resolve) => setTimeout(resolve, delay));
			} else {
				logger.error(
					`Failed to download media after ${retries} attempts:`,
					error,
				);
			}
		}
	}

	// If we get here, all retries failed
	throw new Error(
		`Failed to download media after ${retries} attempts: ${lastError?.message || "Unknown error"}`,
	);
}
