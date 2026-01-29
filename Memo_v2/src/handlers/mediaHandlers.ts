/**
 * Media handlers for image and audio messages.
 * All memory is stored in Memo V2 (no V1 dependency).
 */

import { invokeMemoGraph } from "../graph/index.js";
import { analyzeImage } from "../services/image/ImageAnalysisService.js";
import { getMemoryService } from "../services/memory/index.js";
import { transcribeAudio } from "../services/transcription.js";

/**
 * Process an image message: analyze, store in Memo V2 memory, return formatted response.
 */
export async function processImageMessage(
	userPhone: string,
	imageBuffer: Buffer,
	caption: string,
	whatsappMessageId: string,
	imageId: string,
): Promise<string> {
	const analysisResult = await analyzeImage(imageBuffer, caption || undefined);
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
	const result = await invokeMemoGraph(userPhone, transcribedText, {
		whatsappMessageId,
		triggerType: "user",
	});
	return result.response;
}
