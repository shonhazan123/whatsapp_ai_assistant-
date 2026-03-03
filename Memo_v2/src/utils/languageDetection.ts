/**
 * Central language detection for user messages.
 * Used by the first nodes (e.g. ContextAssemblyNode) and by media handlers (image)
 * so all LLM responses use the same language. Uses the languagedetect library
 * (keyword/n-gram based). When there is no text (e.g. image without caption),
 * defaults to Hebrew.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LanguageDetect = require("languagedetect");

export type ResponseLanguage = "he" | "en" | "other";

const lngDetector = new LanguageDetect();

/** Minimum length of text to run library detection; below this we use defaultWhenEmpty */
const MIN_TEXT_LENGTH = 2;

/**
 * Map languagedetect result (e.g. 'english', 'hebrew') to our response language.
 * languagedetect returns lowercase full names.
 */
function mapToResponseLanguage(detected: string): ResponseLanguage {
	const lower = detected.toLowerCase();
	if (lower === "hebrew") return "he";
	if (lower === "english") return "en";
	return "other";
}

/**
 * Detect the user's preferred response language from message text.
 * Call this first (e.g. in context assembly / before any LLM) and pass the result
 * so all LLM calls respond in the same language.
 *
 * @param text - User message (or caption + recent context). Can be empty.
 * @param options.defaultWhenEmpty - When text is empty or too short (e.g. image without keywords), use this. Default 'he'.
 * @returns 'he' | 'en' | 'other'
 */
export function detectUserResponseLanguage(
	text: string,
	options?: { defaultWhenEmpty?: ResponseLanguage },
): ResponseLanguage {
	const defaultWhenEmpty = options?.defaultWhenEmpty ?? "he";
	const trimmed = (text || "").trim();

	if (trimmed.length < MIN_TEXT_LENGTH) {
		return defaultWhenEmpty;
	}

	// Hebrew is not always top in n-gram; quick check so we don't misclassify
	const hebrewRegex = /[\u0590-\u05FF]/;
	if (hebrewRegex.test(trimmed)) {
		return "he";
	}

	try {
		const results = lngDetector.detect(trimmed, 3) as [string, number][] | undefined;
		if (results && results.length > 0) {
			const top = results[0][0];
			return mapToResponseLanguage(top);
		}
	} catch {
		// Fallback: simple heuristic
		const asciiChars = trimmed.match(/[a-zA-Z]/g)?.length ?? 0;
		if (asciiChars > trimmed.length * 0.5) return "en";
		return defaultWhenEmpty;
	}

	return defaultWhenEmpty;
}
