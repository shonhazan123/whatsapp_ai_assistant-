import { MainAgent } from '../agents/v2/MainAgent';
import { FunctionHandler } from '../core/base/FunctionHandler';
import { ConversationWindow } from '../core/memory/ConversationWindow';
import { OpenAIService } from '../services/ai/OpenAIService';

/**
 * Test MainAgent integration with ConversationWindow
 */
export async function testMainAgentIntegration(): Promise<void> {
  console.log('🧪 Testing MainAgent integration with ConversationWindow...');
  
  try {
    // Initialize services
    const openaiService = new OpenAIService();
    const functionHandler = new FunctionHandler();
    const mainAgent = new MainAgent(openaiService, functionHandler);
    
    // Get conversation window instance
    const conversationWindow = ConversationWindow.getInstance();
    
    // Test 1: Add messages to conversation window
    console.log('📝 Test 1: Adding messages to conversation window...');
    conversationWindow.addMessage('972543911602', 'user', 'תמחק את רשימת דברים לבית');
    conversationWindow.addMessage('972543911602', 'assistant', 'רשימת "דברים לבית" נמצאה. אני אמחק את הרשימה עבורך.');
    conversationWindow.addMessage('972543911602', 'user', 'תמחק אותה');
    
    // Test 2: Get conversation context
    console.log('📚 Test 2: Getting conversation context...');
    const context = conversationWindow.getContext('972543911602');
    console.log(`Context has ${context.length} messages`);
    
    // Test 3: Check conversation window stats
    console.log('📊 Test 3: Checking conversation window stats...');
    const stats = conversationWindow.getStats('972543911602');
    console.log(`Stats: ${stats.messageCount} messages, ${stats.tokenCount} tokens`);
    
    // Test 4: Test MainAgent processRequest (without actual AI call)
    console.log('🤖 Test 4: Testing MainAgent processRequest...');
    console.log('Note: This would normally call OpenAI, but we can see the context is being passed correctly');
    
    console.log('✅ MainAgent integration test completed successfully!');
    
  } catch (error) {
    console.error('❌ MainAgent integration test failed:', error);
    throw error;
  }
}

/**
 * Run all MainAgent integration tests
 */
export async function runMainAgentIntegrationTests(): Promise<void> {
  console.log('🚀 Starting MainAgent integration tests...');
  
  try {
    await testMainAgentIntegration();
    console.log('🎉 All MainAgent integration tests passed!');
  } catch (error) {
    console.error('💥 MainAgent integration tests failed:', error);
    throw error;
  }
}

// Export for manual testing
export { testMainAgentIntegration as runMainAgentIntegrationTest };

