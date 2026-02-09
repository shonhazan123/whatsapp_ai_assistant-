import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { ENVIRONMENT } from "../config/environment";
import { RequestContext } from "../core/context/RequestContext";
import { processMessageV2 } from "../index-v2";
// Memo V2 (LangGraph-based); image and audio handled in Memo V2 only
import {
  invokeMemoGraphSimple,
  processAudioMessage,
  processImageMessage,
} from "../../Memo_v2/dist/index";
import { UserService } from "../services/database/UserService";
import { DebugForwarderService } from "../services/debug/DebugForwarderService";
import { UserOnboardingHandler } from "../services/onboarding/UserOnboardingHandler";
import { PerformanceLogService } from "../services/performance/PerformanceLogService";
import { PerformanceTracker } from "../services/performance/PerformanceTracker";
import { MessageIdCache } from "../services/webhook/MessageIdCache";
import {
  downloadWhatsAppMedia,
  sendTypingIndicator,
  sendWhatsAppMessage,
} from "../services/whatsapp";
import { WhatsAppMessage, WhatsAppWebhookPayload } from "../types";
import { logger } from "../utils/logger";
dotenv.config();

export const whatsappWebhook = express.Router();

const userService = new UserService();
const onboardingHandler = new UserOnboardingHandler(logger);
const performanceTracker = PerformanceTracker.getInstance();
const performanceLogService = PerformanceLogService.getInstance();
const messageIdCache = MessageIdCache.getInstance();

// Initialize DebugForwarderService only in PRODUCTION
const debugForwarder =
	ENVIRONMENT === "PRODUCTION" ? new DebugForwarderService() : null;

// Webhook verification (GET request from WhatsApp)
// Only register in PRODUCTION environment
if (ENVIRONMENT === "PRODUCTION") {
	whatsappWebhook.get("/whatsapp", (req: Request, res: Response) => {
		const mode = req.query["hub.mode"];
		const token = req.query["hub.verify_token"];
		const challenge = req.query["hub.challenge"];

		const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

		if (mode === "subscribe" && token === verifyToken) {
			logger.info("Webhook verified successfully");
			res.status(200).send(challenge);
		} else {
			logger.warn("Webhook verification failed");
			res.sendStatus(403);
		}
	});
} else {
	logger.info(
		"⚠️  WhatsApp webhook registration skipped (ENVIRONMENT is DEBUG)",
	);
}

// Webhook message handler (POST request from WhatsApp)
// Only register in PRODUCTION environment
if (ENVIRONMENT === "PRODUCTION") {
	whatsappWebhook.post("/whatsapp", async (req: Request, res: Response) => {
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
							// Check for duplicate message ID before processing
							if (message.id && messageIdCache.has(message.id)) {
								logger.info(
									`⏭️  Skipping duplicate message ID: ${message.id.substring(0, 20)}...`,
								);
								continue;
							}

							await handleIncomingMessage(message);
						}
					}
				}
			}
		} catch (error) {
			logger.error("Error processing webhook:", error);
			// Don't send status here - already sent 200 above
		}
	});
} else {
	logger.info(
		"⚠️  WhatsApp webhook POST handler skipped (ENVIRONMENT is DEBUG)",
	);
}

export async function handleIncomingMessage(
	message: WhatsAppMessage,
): Promise<void> {
	const startTime = Date.now();
	logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
	logger.info("📨 NEW MESSAGE RECEIVED");
	logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

	let performanceRequestId: string | undefined;

	try {
		const rawNumber = message.from;
		const userPhone = normalizeWhatsAppNumber(rawNumber);

		// Phase 5: Conditional forwarding in PRODUCTION
		if (
			ENVIRONMENT === "PRODUCTION" &&
			debugForwarder &&
			debugForwarder.shouldForwardToDebug(userPhone)
		) {
			logger.info(`🔄 Forwarding message from ${userPhone} to DEBUG instance`);

			// Extract message text for forwarding
			let messageText = "";
			if (message.type === "text" && message.text) {
				messageText = message.text.body;
			} else if (message.type === "audio" && message.audio) {
				// For audio, we'll need to transcribe it first or forward the audio ID
				messageText = "[Audio message]";
			} else if (message.type === "image" && message.image) {
				messageText = message.image.caption || "[Image message]";
			}

			try {
				const forwardResponse = await debugForwarder.forwardToDebug({
					messageText,
					userPhone,
					messageId: message.id || "",
					messageType:
						message.type === "text" ||
						message.type === "audio" ||
						message.type === "image"
							? message.type
							: "text",
					replyToMessageId: message.context?.id,
					whatsappMessageId: message.id,
					audioId: message.audio?.id,
					imageId: message.image?.id,
					imageCaption: message.image?.caption,
				});

				if (forwardResponse.success) {
					logger.info(
						`✅ Successfully forwarded to DEBUG and received response`,
					);
					// Response is already sent to WhatsApp by DEBUG instance
					return;
				} else {
					logger.error(
						`❌ Failed to forward to DEBUG: ${forwardResponse.error}`,
					);
					await sendWhatsAppMessage(
						userPhone,
						forwardResponse.responseText ||
							"Debug service is currently unavailable.",
					);
					return;
				}
			} catch (error: any) {
				logger.error(`❌ Error forwarding to DEBUG:`, error);
				await sendWhatsAppMessage(
					userPhone,
					"Debug service is currently unavailable. Please try again later.",
				);
				return;
			}
		}

		let messageText = "";

		// Mark message ID as processed (before any async operations)
		if (message.id) {
			messageIdCache.add(message.id);
		}

		await sendTypingIndicator(userPhone, message.id);
		// Start performance tracking
		performanceRequestId = performanceTracker.startRequest(userPhone);

		logger.info(`👤 From: ${userPhone}`);
		logger.info(`📋 Message ID: ${message.id}`);
		logger.info(`📝 Type: ${message.type}`);

		// Extract reply context if this is a reply to a previous message
		const replyToMessageId = message.context?.id;
		if (replyToMessageId) {
			logger.info(`↩️  This is a reply to message ID: ${replyToMessageId}`);
		}

		// Step 2: Handle different message types
		logger.debug("Step 2: Processing message content...");
		if (message.type === "text" && message.text) {
			messageText = message.text.body;
			logger.info(`💬 Message: "${messageText}"`);
		} else if (message.type === "audio" && message.audio) {
			logger.info("🎤 Processing audio message");
			try {
				const audioBuffer = await downloadWhatsAppMedia(message.audio.id);
				const response = await processAudioMessage(
					userPhone,
					audioBuffer,
					message.id || "",
				);
				await sendWhatsAppMessage(userPhone, response);
				logger.info(`📤 Sent audio response to ${userPhone}`);
			} catch (error: any) {
				logger.error("Error processing audio:", error);
				await sendWhatsAppMessage(
					userPhone,
					error?.message?.includes("timeout")
						? "The audio took too long to process. Please try again."
						: "Sorry, I couldn't process your audio. Please try again or send a text message.",
				);
			}
			if (performanceRequestId) {
				performanceTracker.endRequest(performanceRequestId);
			}
			return;
		} else if (message.type === "image" && message.image) {
			logger.info("🖼️  Processing image message");
			const imageCaption = message.image.caption || "";
			let imageBuffer: Buffer;
			try {
				imageBuffer = await downloadWhatsAppMedia(message.image.id);
				logger.info(
					`📷 Image downloaded (${(imageBuffer.length / 1024).toFixed(2)}KB)`,
				);
			} catch (downloadError: any) {
				logger.error("Error downloading image:", downloadError);
				const errorMessage = downloadError.message?.includes("not found")
					? "Sorry, I couldn't access the image. It may have expired or been deleted. Please send the image again."
					: downloadError.message?.includes("timeout")
						? "The image download timed out. Please try sending the image again."
						: "Sorry, I couldn't download your image. Please try sending it again.";
				await sendWhatsAppMessage(userPhone, errorMessage);
				if (performanceRequestId)
					performanceTracker.endRequest(performanceRequestId);
				return;
			}
			try {
				const responseMessage = await processImageMessage(
					userPhone,
					imageBuffer,
					imageCaption,
					message.id || "",
					message.image.id,
				);
				await sendWhatsAppMessage(userPhone, responseMessage);
				logger.info(
					`📤 Sent formatted image analysis response to ${userPhone}`,
				);
			} catch (error: any) {
				logger.error("Error analyzing image:", error);
				const errMsg =
					error?.message ||
					"Sorry, I encountered an error analyzing your image.";
				await sendWhatsAppMessage(
					userPhone,
					errMsg.includes("rate limit")
						? "The image analysis service is currently busy. Please try again in a few moments."
						: errMsg.includes("timeout")
							? "The image took too long to process. Please try with a smaller image."
							: "Sorry, I encountered an error analyzing your image. Please try again or describe what you see.",
				);
			}
			if (performanceRequestId) {
				performanceTracker.endRequest(performanceRequestId);
			}
			return;
		} else {
			// Unsupported message type
			logger.warn(`⚠️  Unsupported message type: ${message.type}`);
			await sendWhatsAppMessage(
				userPhone,
				"Sorry, I can only process text, audio, and image messages at the moment.",
			);
			return;
		}

		// Get or create user record
		let userRecord = await userService.findOrCreateByWhatsappNumber(userPhone);

		// Handle onboarding, OAuth, and plan logic in correct order
		const onboardingCheck = await onboardingHandler.handleUserMessage(
			userRecord,
			userPhone,
			messageText,
		);

		// If onboarding handler says not to process, return early
		if (!onboardingCheck.shouldProcess) {
			if (performanceRequestId) {
				await performanceTracker.endRequest(performanceRequestId);
			}
			return;
		}

		// Get updated user record (plan might have been updated)
		userRecord =
			(await userService.findByWhatsappNumber(userPhone)) ?? userRecord;

		// Use context from onboarding handler
		const context = onboardingCheck.context!;

		// Add performance requestId to context
		context.performanceRequestId = performanceRequestId;

		logger.info(`🤖 AI Processing: "${messageText}"`);

		// Use Memo V2 (LangGraph) or V1 based on environment variable
		const useMemoV2 = process.env.USE_MEMO_V2 === "true";

		let response: string;
		if (useMemoV2) {
			logger.info("🆕 Using Memo V2 (LangGraph)");
			response = await RequestContext.run(context, () =>
				invokeMemoGraphSimple(userPhone, messageText, {
					whatsappMessageId: message.id,
					replyToMessageId: replyToMessageId,
					triggerType: "user",
				}),
			);
		} else {
			// V1 processing (existing flow)
			response = await RequestContext.run(context, () =>
				processMessageV2(userPhone, messageText, {
					whatsappMessageId: message.id,
					replyToMessageId: replyToMessageId,
				}),
			);
		}
		logger.info(`💡 AI Response: "${response}"`);

		// Step 4: Send agent response back to user first
		await sendWhatsAppMessage(userPhone, response);

		// Step 5: Check onboarding step completion after agent response
		await onboardingHandler.handlePostAgentResponse(
			userRecord.id,
			userPhone,
			messageText,
			response,
			context,
		);

		const duration = Date.now() - startTime;
		logger.info(`✅ Message handled successfully in ${duration}ms`);

		// End performance tracking FIRST (needs requestCalls for cost calculation)
		if (performanceRequestId) {
			await performanceTracker.endRequest(performanceRequestId);
		}

		// Step 6: Upload performance logs to database (after response is sent and summary printed)
		if (performanceRequestId) {
			try {
				const calls = performanceTracker.getRequestCalls(performanceRequestId);
				const functions =
					performanceTracker.getRequestFunctions(performanceRequestId);

				if (calls.length > 0 || functions.length > 0) {
					await performanceLogService.uploadSessionLogs(calls, functions);
					// Clear in-memory data after successful upload
					performanceTracker.clearRequestData(performanceRequestId);
				}
			} catch (uploadError) {
				logger.error(
					"Error uploading performance logs to database:",
					uploadError,
				);
				// Don't fail the request if upload fails
			}
		}

		logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
	} catch (error) {
		const duration = Date.now() - startTime;
		logger.error(`❌ Error handling message after ${duration}ms:`, error);

		// End performance tracking FIRST (needs requestCalls for cost calculation)
		if (performanceRequestId) {
			await performanceTracker.endRequest(performanceRequestId);
		}

		// Upload performance logs even on error (if any were collected)
		if (performanceRequestId) {
			try {
				const calls = performanceTracker.getRequestCalls(performanceRequestId);
				const functions =
					performanceTracker.getRequestFunctions(performanceRequestId);

				if (calls.length > 0 || functions.length > 0) {
					await performanceLogService.uploadSessionLogs(calls, functions);
					performanceTracker.clearRequestData(performanceRequestId);
				}
			} catch (uploadError) {
				logger.error(
					"Error uploading performance logs to database (error case):",
					uploadError,
				);
			}
		}

		try {
			await sendWhatsAppMessage(
				message.from,
				"Sorry, I encountered an error processing your message. Please try again.",
			);
		} catch (sendError) {
			logger.error("Error sending error message:", sendError);
		}
		logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
	}
}

export default whatsappWebhook;

function normalizeWhatsAppNumber(number: string): string {
	const cleaned = number.replace(/[^\d+]/g, "");
	if (cleaned.startsWith("+")) {
		return cleaned;
	}
	if (cleaned.startsWith("00")) {
		return `+${cleaned.slice(2)}`;
	}
	return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
