/**
 * MemoryUpdateNode
 *
 * Updates conversation memory at the end of each interaction.
 *
 * Based on V1: ConversationWindow (in-memory) + conversation_memory (Supabase)
 *
 * Responsibilities:
 * - Add user message to recentMessages
 * - Add assistant response to recentMessages
 * - Enforce memory limits (max messages, max tokens)
 * - Optionally update long-term memory summary
 */

import { getMemoryService } from "../../services/memory/index.js";
import type { ConversationMessage, LatestAction } from "../../types/index.js";
import type { MemoState } from "../state/MemoState.js";
import { CodeNode } from "./BaseNode.js";

// ============================================================================
// MEMORY LIMITS
// ============================================================================

const MAX_RECENT_MESSAGES = 10;
const MAX_TOKENS_ESTIMATE = 500; // Rough estimate, not exact
const CHARS_PER_TOKEN = 4; // Rough approximation

// ============================================================================
// MEMORY UTILITIES
// ============================================================================

/**
 * Estimate token count from string length
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Calculate total tokens in messages
 */
function calculateTotalTokens(messages: ConversationMessage[]): number {
	return messages.reduce(
		(total, msg) => total + estimateTokens(msg.content),
		0,
	);
}

/**
 * Enforce memory limits on messages array
 */
function enforceMemoryLimits(
	messages: ConversationMessage[],
	maxMessages: number,
	maxTokens: number,
): ConversationMessage[] {
	let result = [...messages];

	// Limit by message count first
	if (result.length > maxMessages) {
		result = result.slice(-maxMessages);
	}

	// Then limit by tokens
	while (calculateTotalTokens(result) > maxTokens && result.length > 1) {
		result = result.slice(1);
	}

	return result;
}

// ============================================================================
// MEMORY UPDATE NODE
// ============================================================================

export class MemoryUpdateNode extends CodeNode {
	readonly name = "memory_update";

	protected async process(state: MemoState): Promise<Partial<MemoState>> {
		const userMessage = state.input.message;
		const enhancedMessage = state.input.enhancedMessage;
		const assistantResponse = state.finalResponse;
		const now = Date.now();

		console.log("[MemoryUpdate] Updating conversation memory");
		console.log(
			`[MemoryUpdate] User message: ${userMessage ? `"${userMessage.substring(0, 50)}..."` : "MISSING"}`,
		);
		console.log(
			`[MemoryUpdate] Assistant response: ${assistantResponse ? `"${assistantResponse.substring(0, 50)}..."` : "MISSING"}`,
		);
		console.log(
			`[MemoryUpdate] Current recentMessages count: ${state.recentMessages.length}`,
		);

		// Build new messages to add
		const newMessages: ConversationMessage[] = [];

		// Add user message
		if (userMessage) {
			const userMsg: ConversationMessage = {
				role: "user",
				content: enhancedMessage || userMessage,
				timestamp: new Date(now - 1000).toISOString(), // ISO string format (matches ContextAssemblyNode)
				whatsappMessageId: state.input.whatsappMessageId,
				replyToMessageId: state.input.replyToMessageId,
				metadata: {
					disambiguationContext: state.disambiguation,
					imageContext: state.input.imageContext,
				},
			};
			newMessages.push(userMsg);
			console.log(`[MemoryUpdate] Added user message to newMessages`);
		} else {
			console.warn(
				"[MemoryUpdate] No user message found in state.input.message",
			);
		}

		// Add assistant response
		if (assistantResponse) {
			const assistantMsg: ConversationMessage = {
				role: "assistant",
				content: assistantResponse,
				timestamp: new Date(now).toISOString(), // ISO string format (matches ContextAssemblyNode)
			};
			newMessages.push(assistantMsg);
			console.log(`[MemoryUpdate] Added assistant message to newMessages`);
		} else {
			console.warn(
				"[MemoryUpdate] No assistant response found in state.finalResponse",
			);
		}

		// Merge with existing messages
		const allMessages = [...state.recentMessages, ...newMessages];

		// Enforce limits
		const trimmedMessages = enforceMemoryLimits(
			allMessages,
			MAX_RECENT_MESSAGES,
			MAX_TOKENS_ESTIMATE,
		);

		console.log(
			`[MemoryUpdate] ${allMessages.length} messages → ${trimmedMessages.length} after limits`,
		);

		// Persist messages to ConversationWindow via MemoryService
		// NOTE: User message is already added by ContextAssemblyNode, we validate as fallback
		// Assistant message is NOT added here: the webhook calls Memo_v2 sendWhatsAppMessage,
		// which adds the assistant message with the returned WhatsApp message ID (for reply context).
		this.persistMessagesToMemory(state, userMessage, enhancedMessage);

		// Persist latestActions for ALL successful executions in this run
		this.persistLatestActions(state);

		// Update long-term summary if needed
		// This would typically involve an LLM call to summarize older messages
		// For now, we just pass through the existing summary
		const shouldUpdateSummary = this.shouldUpdateLongTermSummary(state);
		let longTermSummary = state.longTermSummary;

		if (shouldUpdateSummary) {
			console.log(
				"[MemoryUpdate] Long-term summary update triggered (not implemented)",
			);
			// TODO: Implement summary update with LLM
			// longTermSummary = await this.generateSummary(trimmedMessages);
		}

		// Update execution metadata
		const metadata = {
			...state.metadata,
			nodeExecutions: [
				...state.metadata.nodeExecutions,
				{
					node: this.name,
					startTime: now,
					endTime: Date.now(),
					durationMs: Date.now() - now,
				},
			],
		};

		return {
			recentMessages: trimmedMessages,
			longTermSummary,
			metadata,
		};
	}

	/**
	 * Persist messages to ConversationWindow via MemoryService
	 * - Validates user message exists (fallback if ContextAssemblyNode didn't add it)
	 * - Assistant message is added by the webhook when it calls Memo_v2 sendWhatsAppMessage (with message ID).
	 */
	private persistMessagesToMemory(
		state: MemoState,
		userMessage: string,
		enhancedMessage: string | undefined,
	): void {
		try {
			const memoryService = getMemoryService();
			const userPhone = state.user.phone || state.input.userPhone;

			// Validate user message exists (fallback if ContextAssemblyNode missed it)
			if (userMessage) {
				const hasUserMsg = memoryService.hasUserMessage(
					userPhone,
					userMessage,
					state.input.whatsappMessageId,
				);

				if (!hasUserMsg) {
					console.warn(
						"[MemoryUpdate] User message not found in memory, adding as fallback",
					);
					memoryService.addUserMessage(
						userPhone,
						enhancedMessage || userMessage,
						{
							whatsappMessageId: state.input.whatsappMessageId,
							replyToMessageId: state.input.replyToMessageId,
							disambiguationContext: state.disambiguation,
							imageContext: state.input.imageContext,
						},
					);
				}
			}
		} catch (error) {
			console.error(
				"[MemoryUpdate] Error persisting messages to memory:",
				error,
			);
			// Don't fail the node if this fails
		}
	}

	/**
	 * Extract and persist LatestActions for ALL successful executions in this run.
	 * Iterates every PlanStep; for each success, builds a compact LatestAction record.
	 */
	private persistLatestActions(state: MemoState): void {
		try {
			const plan = state.plannerOutput?.plan;
			const results = state.executionResults;
			if (!plan || plan.length === 0 || !results || results.size === 0) return;

			const memoryService = getMemoryService();
			const userPhone = state.user.phone || state.input.userPhone;
			const nowIso = new Date().toISOString();

			const actions: LatestAction[] = [];

			for (const step of plan) {
				const execResult = results.get(step.id);
				if (!execResult || !execResult.success) continue;

				const data = execResult.data;
				const summary = this.extractSummary(step.capability, data, step.constraints);
				const when = this.extractWhen(step.capability, data);
				const externalIds = this.extractActionExternalIds(step.capability, data);

				actions.push({
					createdAt: nowIso,
					capability: step.capability,
					action: step.action,
					summary,
					...(when ? { when } : {}),
					...(externalIds ? { externalIds } : {}),
				});
			}

			if (actions.length > 0) {
				memoryService.pushLatestActions(userPhone, actions);
				console.log(`[MemoryUpdate] Persisted ${actions.length} latestActions`);
			}
		} catch (error) {
			console.error("[MemoryUpdate] Error persisting latestActions:", error);
		}
	}

	private extractSummary(capability: string, data: any, constraints: Record<string, any>): string {
		if (!data) return constraints?.rawMessage?.substring(0, 80) || 'unknown';

		switch (capability) {
			case 'calendar':
				return data.summary || data.title || constraints?.rawMessage?.substring(0, 80) || 'calendar action';
			case 'database':
				return data.text || data.list_name || constraints?.rawMessage?.substring(0, 80) || 'task action';
			case 'gmail':
				return data.subject || constraints?.rawMessage?.substring(0, 80) || 'email action';
			case 'second-brain':
				return (data.content || data.summary || '').substring(0, 80) || 'memory action';
			default:
				return constraints?.rawMessage?.substring(0, 80) || 'action';
		}
	}

	private extractWhen(capability: string, data: any): string | undefined {
		if (!data) return undefined;

		switch (capability) {
			case 'calendar':
				return data.start || undefined;
			case 'database':
				return data.due_date || data.dueDate || undefined;
			default:
				return undefined;
		}
	}

	private extractActionExternalIds(capability: string, data: any): Record<string, string | string[]> | undefined {
		if (!data) return undefined;

		switch (capability) {
			case 'calendar':
				if (data.id) return { eventId: data.id };
				break;
			case 'database':
				if (data.id) return { taskId: data.id };
				break;
			case 'gmail':
				if (data.id) return { threadId: data.id };
				break;
			case 'second-brain':
				if (data.id) return { memoryId: data.id };
				break;
		}
		return undefined;
	}

	/**
	 * Determine if long-term summary should be updated
	 */
	private shouldUpdateLongTermSummary(state: MemoState): boolean {
		// Update summary periodically or when significant events occur

		// Check if we've had many messages since last summary
		const messageCount = state.recentMessages.length;
		if (messageCount >= MAX_RECENT_MESSAGES - 2) {
			return true;
		}

		// Check if significant operations occurred
		const significantOps = ["create", "update", "delete", "complete"];
		const hasSignificantOp = state.plannerOutput?.plan.some((step) =>
			significantOps.some((op) => step.action.includes(op)),
		);

		if (hasSignificantOp && messageCount > 5) {
			return true;
		}

		return false;
	}
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createMemoryUpdateNode() {
	const node = new MemoryUpdateNode();
	return node.asNodeFunction();
}

// Export utilities for use in MemoState reducers
export { calculateTotalTokens, enforceMemoryLimits, estimateTokens };
