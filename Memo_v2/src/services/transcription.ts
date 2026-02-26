/**
 * Audio transcription using Whisper (copied from V1; no PerformanceTracker in Memo V2)
 * Uses prompt to guide date formatting so calendar/reminder intents parse correctly.
 */

import { getOpenAI } from "../config/llm-config.js";
import { logger } from "../utils/logger.js";

/** Prompt to steer transcription toward valid date formats (dd/mm or dd/mm/yy). */
const TRANSCRIPTION_DATE_PROMPT = `When the speaker says dates, write them in dd/mm format: two digits for day, slash, two digits for month (e.g. 24/03, 30/03, 01/12). Optional year: dd/mm/yy (e.g. 24/03/25). Never write invalid day numbers (e.g. 124/03); use only valid days 01-31 and months 01-12. Recognize date phrases like "עד ה-30 במרץ" or "מ-24/03" and output the numbers in dd/mm form.`;

export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
	try {
		const audioFile = new File([audioBuffer], "audio.ogg", {
			type: "audio/ogg",
		});
		const openai = getOpenAI();
		const transcription = await openai.audio.transcriptions.create({
			file: audioFile,
			model: "gpt-4o-transcribe",
			language: "he",
			prompt: TRANSCRIPTION_DATE_PROMPT,
		});
		logger.info("Audio transcribed successfully");
		return transcription.text;
	} catch (error) {
		logger.error("Error transcribing audio:", error);
		throw error;
	}
}
