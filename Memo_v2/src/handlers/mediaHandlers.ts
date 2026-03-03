/**
 * Media handlers for image and audio messages.
 * All memory is stored in Memo V2 (no V1 dependency).
 */

import { invokeMemoGraph } from "../graph/index.js";
import { analyzeImage } from "../services/image/ImageAnalysisService.js";
import { getMemoryService } from "../services/memory/index.js";
import { transcribeAudio } from "../services/transcription.js";
import { detectUserResponseLanguage } from "../utils/languageDetection.js";

/**
 * Get text used to detect language for image response: caption first, then last user message.
 * If no keywords (empty), we default to Hebrew in detectUserResponseLanguage.
 */
function getTextForImageLanguage(userPhone: string, caption: string): string {
	if (caption && caption.trim().length > 0) return caption;
	try {
		const messages = getMemoryService().getRecentMessages(userPhone, 5);
		for (let i = messages.length - 1; i >= 0; i--) {
			if (messages[i].role === "user" && messages[i].content?.trim()) {
				return messages[i].content;
			}
		}
	} catch {
		// ignore
	}
	return "";
}

/**
 * Process an image message: analyze, store in Memo V2 memory, return formatted response.
 * Response language is detected from caption + recent conversation; picture without keywords defaults to Hebrew.
 */
export async function processImageMessage(
	userPhone: string,
	imageBuffer: Buffer,
	caption: string,
	whatsappMessageId: string,
	imageId: string,
): Promise<string> {
	const textForLang = getTextForImageLanguage(userPhone, caption || "");
	const userLanguage = detectUserResponseLanguage(textForLang, { defaultWhenEmpty: "he" });
	const analysisResult = await analyzeImage(imageBuffer, caption || undefined, userLanguage);
	const responseMessage =
		analysisResult.formattedMessage ||
		"I analyzed your image. Is there anything you'd like me to help you with?";

	getMemoryService().addUserMessage(userPhone, caption || "[Image]", {
		whatsappMessageId,
		imageContext: {
			imageId,
			analysisResult,
			imageType: analysisResult.imageType,
			extractedAt: Date.now(),
		},
	});
	getMemoryService().addAssistantMessage(userPhone, responseMessage);

	return responseMessage;
}

/**
 * Process an audio message: transcribe, invoke graph, return graph response.
 */
export async function processAudioMessage(
	userPhone: string,
	audioBuffer: Buffer,
	whatsappMessageId: string,
): Promise<string> {
	const transcribedText = await transcribeAudio(audioBuffer);
	console.log("transcribedText", transcribedText);
	const result = await invokeMemoGraph(userPhone, transcribedText, {
		whatsappMessageId,
		triggerType: "user",
	});
	return result.response;
}
