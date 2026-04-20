import { describe, expect, it } from 'vitest';
import type { LatestAction } from '../../src/types/index.js';
import type { MemoState } from '../../src/graph/state/MemoState.js';
import {
	buildContextWindowSnapshotStep,
	buildLLMStep,
	computeAggregates,
	CONTEXT_WINDOW_TRACE_MODEL,
	CONTEXT_WINDOW_TRACE_NODE,
	isLlmStepCountedInAggregates,
} from '../../src/services/trace/traceHelpers.js';

function minimalState(overrides: Partial<MemoState> = {}): MemoState {
	const base = {
		user: {
			phone: '+10000000000',
			timezone: 'Asia/Jerusalem',
			language: 'he' as const,
			planTier: 'free' as const,
			googleConnected: false,
			capabilities: {
				calendar: true,
				gmail: false,
				database: true,
				secondBrain: true,
			},
		},
		authContext: {
			userRecord: { id: 'user-1', phone: '+10000000000' },
		} as unknown as MemoState['authContext'],
		input: {
			message: 'Hello',
			triggerType: 'user' as const,
			userPhone: '+10000000000',
			enhancedMessage: '[Replying to: "x"]\n\nHello',
		},
		now: {
			formatted: 't',
			iso: new Date().toISOString(),
			timezone: 'Asia/Jerusalem',
			dayOfWeek: 0,
			date: new Date(),
		},
		recentMessages: [
			{
				role: 'user' as const,
				content: 'prior',
				timestamp: new Date().toISOString(),
				whatsappMessageId: 'w1',
			},
			{
				role: 'assistant' as const,
				content: 'prior reply',
				timestamp: new Date().toISOString(),
			},
		],
		longTermSummary: undefined,
		conversationContext: {
			summary: 'User asked about tasks earlier.',
			recentMessages: [],
		},
		latestActions: [
			{
				createdAt: new Date().toISOString(),
				capability: 'database',
				action: 'list tasks',
				summary: 'Listed tasks',
			} satisfies LatestAction,
		],
		plannerOutput: undefined,
		routingSuggestions: undefined,
		disambiguation: undefined,
		pendingHITL: null,
		hitlResults: {},
		threadId: 'thread-1',
		traceId: 'trace-1',
		executedOperations: {},
		resolverResults: new Map(),
		executorArgs: new Map(),
		executionResults: new Map(),
		refs: {},
		formattedResponse: undefined,
		finalResponse: undefined,
		error: undefined,
		llmSteps: [],
		metadata: {
			startTime: Date.now(),
			nodeExecutions: [],
			llmCalls: 0,
			totalTokens: 0,
			totalCost: 0,
		},
	} satisfies MemoState;
	return { ...base, ...overrides } as MemoState;
}

describe('context_window trace snapshot', () => {
	it('buildContextWindowSnapshotStep uses reply_context node and stores a readable context window', () => {
		const step = buildContextWindowSnapshotStep(minimalState());
		expect(step.node).toBe(CONTEXT_WINDOW_TRACE_NODE);
		expect(step.model).toBe(CONTEXT_WINDOW_TRACE_MODEL);
		expect(step.countInAggregates).toBe(false);
		expect(step.totalTokens).toBe(0);
		expect(isLlmStepCountedInAggregates(step)).toBe(false);

		const content = step.input[0]!.content;
		expect(content).toContain('## Context Window');
		expect(content).toContain('## Last User Message');
		expect(content).toContain('Hello');
		expect(content).toContain('## Enhanced User Message');
		expect(content).toContain('## Conversation Summary');
		expect(content).toContain('User asked about tasks earlier.');
		expect(content).toContain('## Recent Messages Array');
		expect(content).toContain('[user]');
		expect(content).toContain('[assistant]');
		expect(content).toContain('## Last Executions');
		expect(content).toContain('capability=database | action=list tasks');
	});

	it('computeAggregates ignores context_window snapshot but counts real LLM steps', () => {
		const snapshot = buildContextWindowSnapshotStep(minimalState());
		const real = buildLLMStep(
			'planner',
			'gpt-4o-mini',
			{ cachedInputTokens: 0, inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			100,
			[{ role: 'user', content: 'x' }],
			'{}',
		);
		const agg = computeAggregates([snapshot, real]);
		expect(agg.totalLlmCalls).toBe(1);
		expect(agg.totalInputTokens).toBe(10);
		expect(agg.totalOutputTokens).toBe(5);
	});

	it('payload text does not contain forbidden secret-like keys', () => {
		const step = buildContextWindowSnapshotStep(minimalState());
		const raw = step.input[0]!.content;
		const forbidden = [
			'refresh_token',
			'access_token',
			'authContext',
			'client_secret',
			'authorization',
		];
		const lower = raw.toLowerCase();
		for (const f of forbidden) {
			expect(lower.includes(f)).toBe(false);
		}
	});

	it('guest snapshot marks guest true', () => {
		const step = buildContextWindowSnapshotStep(
			minimalState({ authContext: undefined }),
		);
		expect(step.input[0]!.content).toContain('guest=true');
	});
});
