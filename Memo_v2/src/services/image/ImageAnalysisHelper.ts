/**
 * Image Analysis Helper
 * Normalization and formatting for image analysis results (copied from V1 OpenAIFunctionHelper)
 */

import type { ImageAnalysisResult } from "../../types/imageAnalysis.js";

export class ImageAnalysisHelper {
	/**
	 * Normalize image analysis result to ensure it matches the expected format
	 */
	static normalizeImageAnalysisResult(result: any): ImageAnalysisResult {
		const imageType: "structured" | "random" =
			result.imageType === "structured" || result.structuredData
				? "structured"
				: "random";

		const normalized: ImageAnalysisResult = {
			imageType,
			confidence: ImageAnalysisHelper.normalizeConfidence(result.confidence),
			language: result.language || "other",
			formattedMessage: result.formattedMessage || "",
		};

		if (result.structuredData && imageType === "structured") {
			normalized.structuredData = {
				type: result.structuredData.type || "other",
				extractedData: {
					events: result.structuredData.extractedData?.events || [],
					tasks: result.structuredData.extractedData?.tasks || [],
					contacts:
						result.structuredData.extractedData?.contacts ||
						result.structuredData.extractedData?.businessCards ||
						[],
					notes: result.structuredData.extractedData?.notes || [],
					dates: result.structuredData.extractedData?.dates || [],
					locations: result.structuredData.extractedData?.locations || [],
				},
			};
			normalized.suggestedActions =
				ImageAnalysisHelper.generateSuggestedActions(normalized.structuredData);
		}

		if (imageType === "random" && result.description) {
			normalized.description = result.description;
		}

		return normalized;
	}

	static generateSuggestedActions(structuredData: any): string[] {
		const actions: string[] = [];
		const data = structuredData?.extractedData || {};
		if (data.events?.length > 0) {
			actions.push("Add event(s) to calendar");
			actions.push("Set reminder for event(s)");
		}
		if (data.tasks?.length > 0) {
			actions.push("Create task(s) in my task list");
			actions.push("Set reminder for task(s)");
		}
		if (data.contacts?.length > 0) {
			actions.push("Save contact(s) to my contact list");
		}
		if (
			structuredData?.type === "wedding_invitation" ||
			structuredData?.type === "event_poster"
		) {
			actions.push("Add to calendar");
			actions.push("Set reminder");
		}
		if (structuredData?.type === "calendar") {
			actions.push("Extract tasks and add to my task list");
			actions.push("Set reminders for tasks");
		}
		if (structuredData?.type === "todo_list") {
			actions.push("Add all items to my task list");
			actions.push("Create tasks with due dates");
		}
		return actions.length > 0 ? actions : ["Tell me more about this image"];
	}

	static normalizeConfidence(confidence: any): "high" | "medium" | "low" {
		if (typeof confidence === "string") {
			const normalized = confidence.toLowerCase();
			if (["high", "medium", "low"].includes(normalized)) {
				return normalized as "high" | "medium" | "low";
			}
		}
		return "medium";
	}

	static detectLanguageFromText(text: string): "hebrew" | "english" | "other" {
		const hebrewRegex = /[\u0590-\u05FF]/;
		const englishRegex = /[a-zA-Z]/;
		if (hebrewRegex.test(text)) return "hebrew";
		if (englishRegex.test(text)) return "english";
		return "other";
	}

	static getDefaultImageAnalysisResult(): ImageAnalysisResult {
		return {
			imageType: "random",
			description:
				"I was unable to analyze this image. Please describe what you see or what you would like me to do with it.",
			confidence: "low",
			formattedMessage:
				"I was unable to analyze this image. Please describe what you see or what you would like me to do with it.",
		};
	}

	static generateFallbackFormattedMessage(result: ImageAnalysisResult): string {
		if (result.imageType === "structured" && result.structuredData) {
			const data = result.structuredData.extractedData ?? {};
			const isHebrew = result.language === "hebrew";
			let message = isHebrew
				? "מצאתי מידע מובנה בתמונה:\n\n"
				: "I found structured information in the image:\n\n";
			const events = data.events ?? [];
			if (events.length > 0) {
				message += isHebrew ? "📅 אירועים:\n" : "📅 Events:\n";
				events.forEach((event: any) => {
					message += `- ${event.title}`;
					if (event.date) message += ` (${event.date})`;
					if (event.time) message += ` at ${event.time}`;
					message += "\n";
				});
				message += "\n";
			}
			const tasks = data.tasks ?? [];
			if (tasks.length > 0) {
				message += isHebrew ? "✅ משימות:\n" : "✅ Tasks:\n";
				tasks.forEach((task: any) => {
					message += `- ${task.text}`;
					if (task.dueDate) message += ` (${task.dueDate})`;
					message += "\n";
				});
				message += "\n";
			}
			const contacts = data.contacts ?? [];
			if (contacts.length > 0) {
				message += isHebrew ? "📞 אנשי קשר:\n" : "📞 Contacts:\n";
				contacts.forEach((contact: any) => {
					message += `- ${contact.name}`;
					if (contact.phone) message += ` (${contact.phone})`;
					message += "\n";
				});
				message += "\n";
			}
			message += isHebrew
				? "תרצה שאוסיף את זה ליומן או לרשימת המשימות?"
				: "Would you like me to add this to your calendar or task list?";
			return message;
		}
		return (
			result.description ||
			"I analyzed your image. Is there anything you'd like me to help you with?"
		);
	}
}
