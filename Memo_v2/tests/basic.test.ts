/**
 * Basic Tests for Memo V2 Phase 1
 * 
 * Verifies the fundamental structure is working:
 * - Types compile correctly
 * - State can be created
 * - Graph can be built
 * - Basic flow executes
 * - HITL interrupt/resume works
 */

import { describe, expect, it } from 'vitest';
import { buildMemoGraph, hasPendingInterrupt, invokeMemoGraph } from '../src/graph/index.js';
import { createInitialState } from '../src/graph/state/MemoState.js';
import type { TriggerInput } from '../src/types/index.js';

describe('Memo V2 Phase 1 - Basic Structure', () => {
  
  describe('State Creation', () => {
    it('should create initial state with defaults', () => {
      const state = createInitialState();
      
      expect(state.user).toBeDefined();
      expect(state.user.timezone).toBe('Asia/Jerusalem');
      expect(state.input).toBeDefined();
      expect(state.now).toBeDefined();
      expect(state.recentMessages).toEqual([]);
      // shouldPause removed - now using interrupt()
      expect(state.metadata.startTime).toBeGreaterThan(0);
    });
    
    it('should create state with custom values', () => {
      const state = createInitialState({
        user: {
          phone: '+1234567890',
          timezone: 'America/New_York',
          language: 'en',
          planTier: 'pro',
          googleConnected: true,
          capabilities: {
            calendar: true,
            gmail: true,
            database: true,
            secondBrain: true,
          },
        },
      });
      
      expect(state.user.phone).toBe('+1234567890');
      expect(state.user.timezone).toBe('America/New_York');
      expect(state.user.planTier).toBe('pro');
    });
    
    it('should not have shouldPause property (removed for interrupt())', () => {
      const state = createInitialState();
      expect('shouldPause' in state).toBe(false);
    });
  });
  
  describe('Graph Building', () => {
    it('should build graph from trigger input', () => {
      const input: TriggerInput = {
        userPhone: '+1234567890',
        message: 'Hello',
        triggerType: 'user',
      };
      
      const graph = buildMemoGraph(input);
      
      expect(graph).toBeDefined();
      // LangGraph compiled graph has invoke method
      expect(typeof graph.invoke).toBe('function');
    });
    
    it('should have getState method for checking interrupts', () => {
      const input: TriggerInput = {
        userPhone: '+1234567890',
        message: 'Hello',
        triggerType: 'user',
      };
      
      const graph = buildMemoGraph(input);
      expect(typeof graph.getState).toBe('function');
    });
  });
  
  describe('Graph Execution', () => {
    it('should execute graph and return InvokeResult', async () => {
      const result = await invokeMemoGraph(
        '+1234567890',
        'Hello, what can you do?',
        { triggerType: 'user' }
      );
      
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe('string');
      expect(result.interrupted).toBeDefined();
      expect(result.metadata).toBeDefined();
    });
    
    it('should handle Hebrew messages', async () => {
      const result = await invokeMemoGraph(
        '+1234567890',
        'שלום, מה אתה יכול לעשות?',
        { triggerType: 'user' }
      );
      
      expect(result.response).toBeDefined();
    });
    
    it('should handle calendar-related messages', async () => {
      const result = await invokeMemoGraph(
        '+1234567890',
        'Schedule a meeting with John tomorrow at 3pm',
        { triggerType: 'user' }
      );
      
      expect(result.response).toBeDefined();
    });
    
    it('should handle task-related messages', async () => {
      const result = await invokeMemoGraph(
        '+1234567890',
        'Add a task to buy groceries',
        { triggerType: 'user' }
      );
      
      expect(result.response).toBeDefined();
    });
  });
  
  describe('Thread-based Persistence', () => {
    it('should use phone number as thread_id', async () => {
      const phone = '+972501234567';
      
      // First invocation
      await invokeMemoGraph(phone, 'Hello', { triggerType: 'user' });
      
      // Check hasPendingInterrupt function works
      const hasPending = await hasPendingInterrupt(phone);
      expect(typeof hasPending).toBe('boolean');
    });
    
    it('should return false for non-existent thread', async () => {
      const hasPending = await hasPendingInterrupt('+999999999999');
      expect(hasPending).toBe(false);
    });
  });
  
  describe('LLM Config', () => {
    it('should have model configurations', async () => {
      const { LLM_CAPABILITIES, getModelConfig } = await import('../src/config/llm-config.js');
      
      expect(LLM_CAPABILITIES['gpt-4o-mini']).toBeDefined();
      expect(LLM_CAPABILITIES['gpt-4o-mini'].supportsFunctionCalling).toBe(true);
      expect(LLM_CAPABILITIES['gpt-4o-mini'].supportsCaching).toBe(true);
      
      const config = getModelConfig('gpt-4o-mini');
      expect(config.model).toBe('gpt-4o-mini');
    });
    
    it('should return default config for unknown model', async () => {
      const { getModelConfig } = await import('../src/config/llm-config.js');
      
      const config = getModelConfig('unknown-model');
      expect(config).toBeDefined();
      expect(config.model).toBe('gpt-4o-mini'); // Falls back to default
    });
  });
  
  describe('Utilities', () => {
    it('should provide time context', async () => {
      const { getCurrentTimeContext } = await import('../src/utils/index.js');
      
      const context = getCurrentTimeContext('Asia/Jerusalem');
      
      expect(context).toContain('[Current time:');
      expect(context).toContain('Timezone: Asia/Jerusalem');
    });
    
    it('should calculate fuzzy scores', async () => {
      const { fuzzyScore, findBestMatches } = await import('../src/utils/index.js');
      
      expect(fuzzyScore('meeting', 'meeting')).toBe(1);
      expect(fuzzyScore('meet', 'meeting')).toBeGreaterThan(0.5);
      expect(fuzzyScore('xyz', 'meeting')).toBeLessThan(0.5);
      
      const items = ['meeting with John', 'lunch meeting', 'doctor appointment'];
      const matches = findBestMatches('meeting', items, s => s, 0.5);
      
      expect(matches.length).toBe(2);
      expect(matches[0].item).toContain('meeting');
    });
    
    it('should detect language', async () => {
      const { detectLanguage } = await import('../src/utils/index.js');
      
      expect(detectLanguage('Hello world')).toBe('en');
      expect(detectLanguage('שלום עולם')).toBe('he');
      expect(detectLanguage('你好世界')).toBe('other');
    });
  });
  
  describe('Interrupt Types', () => {
    it('should export InterruptPayload type', async () => {
      const types = await import('../src/types/index.js');
      
      // Just verify the type exists (compile-time check)
      const payload: types.InterruptPayload = {
        type: 'clarification',
        question: 'Which meeting?',
        options: ['Team sync', '1:1 with John'],
      };
      
      expect(payload.type).toBe('clarification');
      expect(payload.question).toBe('Which meeting?');
    });
    
    it('should have updated DisambiguationContext with userSelection', async () => {
      const types = await import('../src/types/index.js');
      
      const context: types.DisambiguationContext = {
        type: 'calendar_event',
        candidates: [{ id: '1', displayText: 'Event 1' }],
        resolverStepId: 'A',
        userSelection: 'Event 1',
        resolved: true,
      };
      
      expect(context.userSelection).toBe('Event 1');
      expect(context.resolved).toBe(true);
    });
  });
});
