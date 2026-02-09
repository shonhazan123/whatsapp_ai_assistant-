/**
 * Audio transcription using Whisper (copied from V1; no PerformanceTracker in Memo V2)
 */

import { getOpenAI } from "../config/llm-config.js";
import { logger } from "../utils/logger.js";

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
	try {
		const audioFile = new File([audioBuffer], "audio.ogg", {
			type: "audio/ogg",
		});
		const openai = getOpenAI();
		const transcription = await openai.audio.transcriptions.create({
			file: audioFile,
			model: "whisper-1",
			language: "he",
		});
		logger.info("Audio transcribed successfully");
		return transcription.text;
	} catch (error) {
		logger.error("Error transcribing audio:", error);
		throw error;
	}
}
