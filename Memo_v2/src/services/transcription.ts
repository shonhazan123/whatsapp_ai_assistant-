/**
 * Audio transcription using Whisper
 * Uses prompt to guide date formatting so calendar/reminder intents parse correctly.
 */

import { getOpenAI } from "../config/llm-config.js";
import type { LLMStep } from "../graph/state/MemoState.js";
import { logger } from "../utils/logger.js";
import { buildLLMStep } from "./trace/traceHelpers.js";

/** Prompt to steer transcription toward valid date formats (dd/mm or dd/mm/yy). */
const TRANSCRIPTION_DATE_PROMPT = `When the speaker says dates, write them in dd/mm format: two digits for day, slash, two digits for month (e.g. 24/03, 30/03, 01/12). Optional year: dd/mm/yy (e.g. 24/03/25). Never write invalid day numbers (e.g. 124/03); use only valid days 01-31 and months 01-12. Recognize date phrases like "עד ה-30 במרץ" or "מ-24/03" and output the numbers in dd/mm form.`;

const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

const ZERO_TOKENS = {
	cachedInputTokens: 0,
	inputTokens: 0,
	outputTokens: 0,
	totalTokens: 0,
};

export interface TranscribeAudioResult {
	text: string;
	latencyMs: number;
	/** Pipeline trace step (tokens often 0 — audio API is not token-metered like chat) */
	llmStep: LLMStep;
}

export async function transcribeAudio(
	audioBuffer: Buffer,
): Promise<TranscribeAudioResult> {
	const startTime = Date.now();
	try {
		const audioFile = new File([audioBuffer], "audio.ogg", {
			type: "audio/ogg",
		});
		const openai = getOpenAI();
		const transcription = await openai.audio.transcriptions.create({
			file: audioFile,
			model: TRANSCRIPTION_MODEL,
			language: "he",
			prompt: TRANSCRIPTION_DATE_PROMPT,
		});
		const latencyMs = Date.now() - startTime;
		const text = transcription.text;
		logger.info("Audio transcribed successfully");

		const llmStep = buildLLMStep(
			"transcription",
			TRANSCRIPTION_MODEL,
			ZERO_TOKENS,
			latencyMs,
			[{ role: "user", content: "[audio]" }],
			text,
		);

		return { text, latencyMs, llmStep };
	} catch (error) {
		logger.error("Error transcribing audio:", error);
		throw error;
	}
}
