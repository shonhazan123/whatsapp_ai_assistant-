/**
 * Image Analysis Types
 * Used for structured extraction from images
 */

export type ImageType =
	| "wedding_invitation"
	| "calendar"
	| "todo_list"
	| "event_poster"
	| "contact_card"
	| "other";

export interface ExtractedEvent {
	title: string;
	date: string; // ISO date string or natural language date
	time?: string; // Time in HH:mm format or natural language
	location?: string;
	description?: string;
	attendees?: string[]; // Names or emails
}

export interface ExtractedTask {
	text: string;
	dueDate?: string; // ISO date string or natural language date
	priority?: "high" | "medium" | "low";
}

export interface ExtractedContact {
	name: string;
	phone?: string;
	email?: string;
	address?: string;
	company?: string;
}

export interface StructuredImageData {
	type: ImageType;
	extractedData: {
		events?: ExtractedEvent[];
		tasks?: ExtractedTask[];
		contacts?: ExtractedContact[];
		notes?: string[]; // General notes or text from image
		dates?: string[]; // Standalone dates found
		locations?: string[]; // Standalone locations found
	};
}

export interface ImageAnalysisResult {
	imageType: "structured" | "random";
	structuredData?: StructuredImageData;
	description?: string; // For random images or general description
	extractedText?: string; // Raw text extracted from image (optional)
	suggestedActions?: string[]; // Action suggestions based on extracted data
	confidence: "high" | "medium" | "low";
	language?: "hebrew" | "english" | "other"; // Detected language in image
	formattedMessage: string; // User-friendly formatted message with extracted data and suggested actions
}
