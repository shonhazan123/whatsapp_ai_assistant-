/**
 * Image Analysis Service
 * Analyzes images using GPT-4 Vision and returns structured data (copied from V1 OpenAIService.analyzeImage)
 */

import { getNodeModel, getOpenAI } from "../../config/llm-config.js";
import { getImageAnalysisLanguageMessage, getImageAnalysisPrompt, type ImageResponseLanguage } from "../../config/image-analysis-prompt.js";
import type { LLMStep } from "../../graph/state/MemoState.js";
import type { ImageAnalysisResult } from "../../types/imageAnalysis.js";
import type { LLMUsage } from "../llm/LLMService.js";
import { logger } from "../../utils/logger.js";
import { buildLLMStep, extractTokenUsage } from "../trace/traceHelpers.js";
import { ImageAnalysisHelper } from "./ImageAnalysisHelper.js";
import { ImageCache } from "./ImageCache.js";
import { ImageProcessor } from "./ImageProcessor.js";

const imageCache = ImageCache.getInstance();

export interface AnalyzeImageServiceResult {
	analysis: ImageAnalysisResult;
	/** Present when an OpenAI vision call was made (not for cache-only or validation-only paths) */
	llmStep: LLMStep | null;
}

function buildImageAnalysisLlmStep(params: {
	latencyMs: number;
	completion: { usage?: LLMUsage };
	outputText: string;
}): LLMStep {
	const model = getNodeModel("imageAnalysis").model;
	const tokens = extractTokenUsage(params.completion.usage);
	return buildLLMStep(
		"image-analysis",
		model,
		tokens,
		params.latencyMs,
		[{ role: "user", content: "[image analysis request]" }],
		params.outputText,
	);
}

/**
 * @param userLanguage - User's preferred response language ('he' | 'en' | 'other'). Response (formattedMessage) will be in this language.
 */
export async function analyzeImage(
	imageBuffer: Buffer,
	userCaption?: string,
	userLanguage?: ImageResponseLanguage,
): Promise<AnalyzeImageServiceResult> {
	try {
		logger.info("🔍 Starting image analysis...", { userLanguage });

		const cachedResult = imageCache.get(imageBuffer, userLanguage);
		if (cachedResult) {
			logger.info("✅ Using cached image analysis result");
			return { analysis: cachedResult, llmStep: null };
		}

		const validation = ImageProcessor.validateImage(imageBuffer);
		if (!validation.valid) {
			logger.error(`Image validation failed: ${validation.error}`);
			return {
				analysis: {
					imageType: "random",
					description: validation.error || "Invalid image",
					confidence: "low",
					formattedMessage: `Sorry, I couldn't process your image. ${validation.error || "The image format is not supported or the image is corrupted."}`,
				},
				llmStep: null,
			};
		}

		let processedBuffer = imageBuffer;
		if (validation.needsCompression) {
			try {
				const compressionResult =
					await ImageProcessor.compressImage(imageBuffer);
				processedBuffer = compressionResult.buffer;
				if (compressionResult.compressed) {
					logger.info(
						`Image compressed: ${(compressionResult.originalSize / 1024 / 1024).toFixed(2)}MB → ${(compressionResult.compressedSize / 1024 / 1024).toFixed(2)}MB`,
					);
				}
			} catch (compressionError) {
				logger.error("Image compression failed:", compressionError);
				return {
					analysis: {
						imageType: "random",
						description: "Image is too large to process",
						confidence: "low",
						formattedMessage:
							"Sorry, your image is too large to process. Please send a smaller image (under 4MB).",
					},
					llmStep: null,
				};
			}
		}

		const mimeType = ImageProcessor.getMimeType(validation.format || "jpeg");
		const base64Image = processedBuffer.toString("base64");

		const systemPrompt = getImageAnalysisPrompt();
		const languageMessage = getImageAnalysisLanguageMessage(userLanguage);
		const taskText = userCaption
			? `Analyze this image. The user provided this caption: "${userCaption}". Extract structured data if possible.`
			: "Analyze this image and extract structured data if possible.";
		const userTextContent = languageMessage + taskText;

		const openai = getOpenAI();
		let completion: any;
		let retries = 2;
		let lastError: any;
		let apiLatencyMs = 0;

		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				const timeoutPromise = new Promise((_, reject) => {
					setTimeout(() => reject(new Error("Request timeout")), 60000);
				});

				const apiStart = Date.now();
				completion = (await Promise.race([
					openai.chat.completions.create({
						model: getNodeModel("imageAnalysis").model,
						messages: [
							{ role: "system", content: systemPrompt },
							{
								role: "user",
								content: [
									{
										type: "text",
										text: userTextContent,
									},
									{
										type: "image_url",
										image_url: {
											url: `data:${mimeType};base64,${base64Image}`,
										},
									},
								] as any,
							},
						],
						temperature: 0.3,
						max_tokens: 2000,
					}),
					timeoutPromise,
				])) as any;
				apiLatencyMs = Date.now() - apiStart;

				break;
			} catch (apiError: any) {
				lastError = apiError;
				if (apiError.status === 429) {
					const retryAfter = apiError.response?.headers?.["retry-after"] || 5;
					if (attempt < retries) {
						logger.warn(
							`Rate limited, retrying after ${retryAfter} seconds...`,
						);
						await new Promise((r) => setTimeout(r, retryAfter * 1000));
						continue;
					}
					throw new Error(
						"OpenAI API rate limit exceeded. Please try again in a few moments.",
					);
				}
				if (
					apiError.code === "ECONNABORTED" ||
					apiError.message?.includes("timeout")
				) {
					if (attempt < retries) {
						logger.warn(
							`Request timeout, retrying... (attempt ${attempt + 1}/${retries + 1})`,
						);
						await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
						continue;
					}
					throw new Error(
						"Request timed out. The image may be too large or the service is busy. Please try again.",
					);
				}
				throw apiError;
			}
		}

		if (!completion) {
			throw lastError || new Error("Failed to get completion from OpenAI");
		}

		const responseContent = completion.choices[0]?.message?.content?.trim();
		if (!responseContent) {
			logger.warn("Image analysis returned empty content");
			const defaultAnalysis = ImageAnalysisHelper.getDefaultImageAnalysisResult();
			return {
				analysis: defaultAnalysis,
				llmStep: buildImageAnalysisLlmStep({
					latencyMs: apiLatencyMs,
					completion,
					outputText: "",
				}),
			};
		}

		let analysisResult: ImageAnalysisResult;
		try {
			analysisResult = JSON.parse(responseContent);
		} catch {
			logger.warn(
				"Image analysis response is not pure JSON, attempting extraction",
			);
			const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				analysisResult = JSON.parse(jsonMatch[0]);
			} else {
				logger.warn(
					"Could not extract JSON from image analysis, using description fallback",
				);
				return {
					analysis: {
						imageType: "random",
						description: responseContent,
						confidence: "low",
						language: ImageAnalysisHelper.detectLanguageFromText(responseContent),
						formattedMessage: `I analyzed your image: ${responseContent}\n\nIs there anything you'd like me to help you with?`,
					},
					llmStep: buildImageAnalysisLlmStep({
						latencyMs: apiLatencyMs,
						completion,
						outputText: responseContent,
					}),
				};
			}
		}

		analysisResult =
			ImageAnalysisHelper.normalizeImageAnalysisResult(analysisResult);
		if (!analysisResult.formattedMessage) {
			analysisResult.formattedMessage =
				ImageAnalysisHelper.generateFallbackFormattedMessage(analysisResult);
		}

		imageCache.set(imageBuffer, analysisResult, userLanguage);
		logger.info(
			`✅ Image analysis complete: ${analysisResult.imageType} (confidence: ${analysisResult.confidence})`,
		);
		return {
			analysis: analysisResult,
			llmStep: buildImageAnalysisLlmStep({
				latencyMs: apiLatencyMs,
				completion,
				outputText: responseContent,
			}),
		};
	} catch (error: any) {
		logger.error("Error analyzing image:", error);
		let errorMessage = "Sorry, I encountered an error analyzing your image.";
		if (error.message?.includes("rate limit")) {
			errorMessage =
				"The image analysis service is currently busy. Please try again in a few moments.";
		} else if (error.message?.includes("timeout")) {
			errorMessage =
				"The image took too long to process. Please try with a smaller or simpler image.";
		} else if (error.message?.includes("too large")) {
			errorMessage =
				"Your image is too large to process. Please send a smaller image (under 4MB).";
		} else if (
			error.message?.includes("invalid") ||
			error.message?.includes("format")
		) {
			errorMessage =
				"I couldn't process this image format. Please send a JPEG, PNG, or WebP image.";
		}
		return {
			analysis: {
				imageType: "random",
				description: error.message || "Error analyzing image",
				confidence: "low",
				formattedMessage: `${errorMessage} You can also describe what you see and I'll help you with it.`,
			},
			llmStep: null,
		};
	}
}
