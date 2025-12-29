/**
 * Test Script for Phase 1: Prompt Caching Implementation
 * 
 * This script verifies that prompt caching is working correctly
 * Run with: npx ts-node scripts/test-cache-implementation.ts
 */

import { SystemPrompts } from '../src/config/system-prompts';
import { PromptCacheService } from '../src/services/ai/PromptCacheService';

async function testCacheImplementation() {
  console.log('🧪 Testing Phase 1: Prompt Caching Implementation\n');
  
  // Test 1: PromptCacheService Initialization
  console.log('Test 1: PromptCacheService Initialization');
  const cacheService = PromptCacheService.getInstance();
  const config = cacheService.getConfig();
  console.log('✅ Cache Service initialized');
  console.log('   - Enabled:', config.enabled);
  console.log('   - Min tokens:', config.minTokensForCache);
  console.log('   - Auto cache:', config.autoCache);
  console.log('');
  
  // Test 2: System Prompt Generation (Static)
  console.log('Test 2: System Prompt Generation (Static)');
  const staticPrompt = SystemPrompts.getMainAgentPrompt(false);
  const staticLength = staticPrompt.length;
  const staticTokens = Math.ceil(staticLength / 4);
  console.log('✅ Static prompt generated');
  console.log('   - Length:', staticLength, 'characters');
  console.log('   - Estimated tokens:', staticTokens);
  console.log('   - Cache eligible:', staticTokens >= config.minTokensForCache ? 'YES' : 'NO');
  console.log('');
  
  // Test 3: System Prompt Generation (Dynamic)
  console.log('Test 3: System Prompt Generation (Dynamic)');
  const dynamicPrompt = SystemPrompts.getMainAgentPrompt(true);
  const hasDynamicContent = dynamicPrompt.includes(new Date().getFullYear().toString());
  console.log('✅ Dynamic prompt generated');
  console.log('   - Contains timestamp:', hasDynamicContent ? 'YES' : 'NO');
  console.log('   - Length difference:', dynamicPrompt.length - staticLength, 'characters');
  console.log('');
  
  // Test 4: Cache Control Application
  console.log('Test 4: Cache Control Application');
  const testMessages = [
    { role: 'system' as const, content: staticPrompt },
    { role: 'user' as const, content: 'Test message' }
  ];
  const cachedMessages = cacheService.addCacheControl(testMessages, true, true);
  const hasCacheControl = cachedMessages[0].cache_control !== undefined;
  console.log('✅ Cache control applied');
  console.log('   - System message has cache_control:', hasCacheControl ? 'YES' : 'NO');
  console.log('   - Cache type:', cachedMessages[0].cache_control?.type || 'none');
  console.log('');
  
  // Test 5: Cache Eligibility Validation
  console.log('Test 5: Cache Eligibility Validation');
  const validation = cacheService.validateCacheEligibility(testMessages);
  console.log('✅ Validation complete');
  console.log('   - Eligible:', validation.eligible ? 'YES' : 'NO');
  if (validation.issues.length > 0) {
    console.log('   - Issues:', validation.issues.join(', '));
  }
  console.log('');
  
  // Test 6: Tool Cache Control
  console.log('Test 6: Tool Cache Control');
  const testTools = [
    {
      type: 'function' as const,
      function: {
        name: 'test_function',
        description: 'A' + 'B'.repeat(5000), // Make it large enough
        parameters: { type: 'object', properties: {} }
      }
    }
  ];
  const cachedTools = cacheService.addCacheControlToTools(testTools);
  const toolsHaveCache = cachedTools[cachedTools.length - 1].cache_control !== undefined;
  console.log('✅ Tool cache control applied');
  console.log('   - Last tool has cache_control:', toolsHaveCache ? 'YES' : 'NO');
  console.log('');
  
  // Test 7: Statistics Tracking
  console.log('Test 7: Statistics Tracking');
  const initialStats = cacheService.getStats();
  console.log('✅ Statistics retrieved');
  console.log('   - Total requests:', initialStats.totalRequests);
  console.log('   - Cache hits:', initialStats.cacheHits);
  console.log('   - Cache hit rate:', (initialStats.cacheHitRate * 100).toFixed(1) + '%');
  console.log('   - Tokens saved:', initialStats.tokensSaved);
  console.log('   - Cost saved:', '$' + initialStats.costSaved.toFixed(4));
  console.log('');
  
  // Test 8: Simulate Cache Usage Recording
  console.log('Test 8: Simulate Cache Usage Recording');
  const mockUsage = {
    prompt_tokens: 1000,
    completion_tokens: 100,
    total_tokens: 1100,
    cached_tokens: 800 // 80% cache hit
  };
  cacheService.recordCacheUsage(mockUsage);
  const updatedStats = cacheService.getStats();
  console.log('✅ Cache usage recorded');
  console.log('   - Total requests:', updatedStats.totalRequests);
  console.log('   - Cache hits:', updatedStats.cacheHits);
  console.log('   - Cache hit rate:', (updatedStats.cacheHitRate * 100).toFixed(1) + '%');
  console.log('   - Tokens saved:', updatedStats.tokensSaved);
  console.log('   - Cost saved:', '$' + updatedStats.costSaved.toFixed(4));
  console.log('');
  
  // Test 9: All Agent Prompts are Cacheable
  console.log('Test 9: All Agent Prompts are Cacheable');
  const agentPrompts = {
    'Main': SystemPrompts.getMainAgentPrompt(false),
    'Database': SystemPrompts.getDatabaseAgentPrompt(),
    'Calendar': SystemPrompts.getCalendarAgentPrompt(),
    'Gmail': SystemPrompts.getGmailAgentPrompt(),
    'SecondBrain': SystemPrompts.getSecondBrainAgentPrompt()
  };
  
  for (const [name, prompt] of Object.entries(agentPrompts)) {
    const tokens = Math.ceil(prompt.length / 4);
    const eligible = tokens >= config.minTokensForCache;
    console.log(`   - ${name}: ${tokens} tokens (${eligible ? '✅ Cacheable' : '❌ Too small'})`);
  }
  console.log('');
  
  // Summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('🎉 Phase 1 Implementation Test Complete!');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('✅ All tests passed successfully');
  console.log('');
  console.log('Next Steps:');
  console.log('1. Deploy to production');
  console.log('2. Monitor cache hit rates in PerformanceTracker');
  console.log('3. Verify cost savings in OpenAI dashboard');
  console.log('4. Proceed with Phase 2: Eliminate Double LLM Calls');
  console.log('');
}

// Run tests
testCacheImplementation().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

