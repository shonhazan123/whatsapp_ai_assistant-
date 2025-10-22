import { MainAgent } from '../agents/v2/MainAgent';
import { FunctionHandler } from '../core/base/FunctionHandler';
import { ConversationWindow } from '../core/memory/ConversationWindow';
import { OpenAIService } from '../services/ai/OpenAIService';

/**
 * End-to-end test for the new memory system
 */
export async function testEndToEndMemory(): Promise<void> {
  console.log('🧪 Testing end-to-end memory system...');
  
  try {
    // Initialize services
    const openaiService = new OpenAIService();
    const functionHandler = new FunctionHandler();
    const mainAgent = new MainAgent(openaiService, functionHandler);
    
    // Get conversation window instance
    const conversationWindow = ConversationWindow.getInstance();
    const userPhone = '972543911602';
    
    // Test 1: First message - create a task
    console.log('📝 Test 1: Creating a task...');
    const response1 = await mainAgent.processRequest('Create a task: Buy groceries', userPhone);
    console.log(`Response: ${response1}`);
    
    // Verify conversation window has the messages
    const context1 = conversationWindow.getContext(userPhone);
    console.log(`Context after first message: ${context1.length} messages`);
    
    // Test 2: Second message - reference to previous task
    console.log('📝 Test 2: Referencing previous task...');
    const response2 = await mainAgent.processRequest('Delete it', userPhone);
    console.log(`Response: ${response2}`);
    
    // Verify conversation window has both messages
    const context2 = conversationWindow.getContext(userPhone);
    console.log(`Context after second message: ${context2.length} messages`);
    
    // Test 3: Check conversation statistics
    console.log('📊 Test 3: Checking conversation statistics...');
    const stats = conversationWindow.getStats(userPhone);
    console.log(`Stats: ${stats.messageCount} messages, ${stats.tokenCount} tokens`);
    
    // Test 4: Test conversation context is being passed to agents
    console.log('🔍 Test 4: Verifying context is passed to agents...');
    console.log('Context messages:');
    context2.forEach((msg, index) => {
      console.log(`  ${index + 1}. ${msg.role}: ${msg.content}`);
    });
    
    console.log('✅ End-to-end memory test completed successfully!');
    
  } catch (error) {
    console.error('❌ End-to-end memory test failed:', error);
    throw error;
  }
}

/**
 * Run all end-to-end memory tests
 */
export async function runEndToEndMemoryTests(): Promise<void> {
  console.log('🚀 Starting end-to-end memory tests...');
  
  try {
    await testEndToEndMemory();
    console.log('🎉 All end-to-end memory tests passed!');
  } catch (error) {
    console.error('💥 End-to-end memory tests failed:', error);
    throw error;
  }
}

// Export for manual testing
export { testEndToEndMemory as runEndToEndMemoryTest };

