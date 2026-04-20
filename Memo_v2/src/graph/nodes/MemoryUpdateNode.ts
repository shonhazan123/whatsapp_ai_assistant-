/**
 * MemoryUpdateNode
 *
 * End of graph: ConversationWindow (reply/disambiguation) + ConversationContextStore (planner rolling context).
 *
 * TODO — Redis persistence: When ConversationContextStore moves to Redis, perform the same read-modify-write
 * (append turn, conditional summarization) against Redis keys here, synchronously before returning.
 *
 * Guests: no memory writes (see `isGuestAuth`).
 */

import {
	getConversationContextStore,
	CONVERSATION_KEEP_RAW_MESSAGES,
	CONVERSATION_RAW_MESSAGE_CAP,
	CONVERSATION_RAW_TOKEN_CAP,
	estimateRecentMessagesTokens,
} from "../../services/memory/ConversationContextStore.js";
import { summarizeRollingConversation } from "../../services/memory/conversationContextSummarizer.js";
import { getMemoryService } from "../../services/memory/index.js";
import type { ConversationMessage, LatestAction } from "../../types/index.js";
import { isGuestAuth } from "../../utils/guestUser.js";
import type { LLMStep, MemoState } from "../state/MemoState.js";
import { CodeNode } from "./BaseNode.js";

// ============================================================================
// MEMORY UTILITIES (graph / tests)
// ============================================================================

const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from string length
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Calculate total tokens in messages
 */
export function calculateTotalTokens(messages: ConversationMessage[]): number {
	return messages.reduce((total, msg) => total + estimateTokens(msg.content), 0);
}

/**
 * Enforce memory limits on messages array (legacy helper for tests / callers)
 */
export function enforceMemoryLimits(
	messages: ConversationMessage[],
	maxMessages: number,
	maxTokens: number,
): ConversationMessage[] {
	let result = [...messages];
	if (result.length > maxMessages) {
		result = result.slice(-maxMessages);
	}
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
		const guest = isGuestAuth(state.authContext);

		console.log("[MemoryUpdate] Updating conversation memory");
		console.log(
			`[MemoryUpdate] User message: ${userMessage ? `"${userMessage.substring(0, 50)}..."` : "MISSING"}`,
		);
		console.log(
			`[MemoryUpdate] Assistant response: ${assistantResponse ? `"${assistantResponse.substring(0, 50)}..."` : "MISSING"}`,
		);
		console.log(
			`[MemoryUpdate] Current recentMessages count: ${state.recentMessages.length}, guest=${guest}`,
		);

		if (guest) {
			return {
				recentMessages: [],
				longTermSummary: undefined,
				conversationContext: { recentMessages: [] },
			};
		}

		const userMsg: ConversationMessage | null = userMessage
			? {
					role: "user",
					content: enhancedMessage || userMessage,
					timestamp: new Date(now - 1000).toISOString(),
					whatsappMessageId: state.input.whatsappMessageId,
					replyToMessageId: state.input.replyToMessageId,
					metadata: {
						disambiguationContext: state.disambiguation,
						imageContext: state.input.imageContext,
					},
				}
			: null;

		const assistantMsg: ConversationMessage | null = assistantResponse
			? {
					role: "assistant",
					content: assistantResponse,
					timestamp: new Date(now).toISOString(),
				}
			: null;

		this.persistMessagesToMemory(state, userMessage, enhancedMessage);
		this.persistLatestActions(state);

		const userId = state.authContext!.userRecord.id;
		const store = getConversationContextStore();
		const requestId = (state.input as { requestId?: string }).requestId ?? state.traceId;

		let summarizerSteps: LLMStep[] = [];
		if (userMsg && assistantMsg) {
			store.appendCompletedTurn(userId, userMsg, assistantMsg);
			summarizerSteps = await this.rollUpConversationContextIfNeeded(userId, requestId);
		}

		const ctx = store.getForPlanner(userId);

		return {
			recentMessages: ctx.recentMessages,
			conversationContext: ctx,
			longTermSummary: ctx.summary,
			...(summarizerSteps.length > 0 ? { llmSteps: summarizerSteps } : {}),
		};
	}

	/**
	 * Synchronous summarization when raw buffer exceeds caps (no background jobs).
	 *
	 * TODO — Redis persistence: use WATCH/MULTI or Lua script so append + summarize stays atomic per user.
	 */
	private async rollUpConversationContextIfNeeded(
		userId: string,
		requestId?: string,
	): Promise<LLMStep[]> {
		const store = getConversationContextStore();
		const steps: LLMStep[] = [];

		while (true) {
			const internal = store.getInternal(userId);
			const msgs = internal.recentMessages;
			const tokens = estimateRecentMessagesTokens(msgs);

			if (msgs.length <= CONVERSATION_RAW_MESSAGE_CAP && tokens <= CONVERSATION_RAW_TOKEN_CAP) {
				break;
			}

			if (msgs.length <= CONVERSATION_KEEP_RAW_MESSAGES) {
				try {
					const { text: newSummary, llmStep } = await summarizeRollingConversation({
						priorSummary: internal.summary,
						messagesToFold: msgs,
						requestId,
					});
					store.applySummarizationResult(userId, newSummary, []);
					if (llmStep) steps.push(llmStep);
				} catch (e) {
					console.error("[MemoryUpdate] Summarization failed (small buffer):", e);
					store.applySummarizationResult(userId, internal.summary || "", msgs);
				}
				break;
			}

			const keep = msgs.slice(-CONVERSATION_KEEP_RAW_MESSAGES);
			const toFold = msgs.slice(0, msgs.length - keep.length);
			if (toFold.length === 0) {
				break;
			}

			try {
				const { text: newSummary, llmStep } = await summarizeRollingConversation({
					priorSummary: internal.summary,
					messagesToFold: toFold,
					requestId,
				});
				store.applySummarizationResult(userId, newSummary, keep);
				if (llmStep) steps.push(llmStep);
			} catch (e) {
				console.error("[MemoryUpdate] Summarization failed:", e);
				store.applySummarizationResult(userId, internal.summary || "", keep);
				break;
			}
		}

		return steps;
	}

	private persistMessagesToMemory(
		state: MemoState,
		userMessage: string,
		enhancedMessage: string | undefined,
	): void {
		if (isGuestAuth(state.authContext)) return;

		try {
			const memoryService = getMemoryService();
			const userPhone = state.user.phone || state.input.userPhone;

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
		}
	}

	private persistLatestActions(state: MemoState): void {
		if (isGuestAuth(state.authContext)) return;

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
		if (!data) return constraints?.rawMessage?.substring(0, 80) || "unknown";

		switch (capability) {
			case "calendar":
				return data.summary || data.title || constraints?.rawMessage?.substring(0, 80) || "calendar action";
			case "database": {
				const base = data.text || data.list_name || constraints?.rawMessage?.substring(0, 80) || "task action";
				const recurrence = data.reminder_recurrence || data.reminderRecurrence;
				if (recurrence && typeof recurrence === "object") {
					const type = recurrence.type;
					const interval = recurrence.interval;
					if (type === "weekly" && recurrence.days?.length) {
						return `${base} (recurring: weekly on ${recurrence.days.length} day(s))`;
					}
					if (type === "weekly" && interval) return `${base} (every ${interval} week(s))`;
					if (type) return `${base} (recurring: ${type}${interval ? ` ${interval}` : ""})`;
				}
				return base;
			}
			case "gmail":
				return data.subject || constraints?.rawMessage?.substring(0, 80) || "email action";
			case "second-brain":
				return (data.content || data.summary || "").substring(0, 80) || "memory action";
			default:
				return constraints?.rawMessage?.substring(0, 80) || "action";
		}
	}

	private extractWhen(capability: string, data: any): string | undefined {
		if (!data) return undefined;

		switch (capability) {
			case "calendar":
				return data.start || undefined;
			case "database":
				return data.next_reminder_at ?? data.nextReminderAt ?? data.due_date ?? data.dueDate ?? undefined;
			default:
				return undefined;
		}
	}

	private extractActionExternalIds(capability: string, data: any): Record<string, string | string[]> | undefined {
		if (!data) return undefined;

		switch (capability) {
			case "calendar":
				if (data.id) return { eventId: data.id };
				break;
			case "database":
				if (data.id) return { taskId: data.id };
				break;
			case "gmail":
				if (data.id) return { threadId: data.id };
				break;
			case "second-brain":
				if (data.id) return { memoryId: data.id };
				break;
		}
		return undefined;
	}
}

export function createMemoryUpdateNode() {
	const node = new MemoryUpdateNode();
	return node.asNodeFunction();
}
