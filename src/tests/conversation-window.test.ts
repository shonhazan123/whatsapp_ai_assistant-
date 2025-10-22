import { ConversationWindow } from '../core/memory/ConversationWindow';

/**
 * Simple test functions for ConversationWindow functionality
 * (No Jest required - just basic validation)
 */

/**
 * Test basic message adding and retrieval
 */
export function testBasicFunctionality(): boolean {
  console.log('🧪 Testing basic functionality...');
  
  const window = ConversationWindow.getInstance();
  window.clear('test-user');
  
  // Add messages
  window.addMessage('test-user', 'user', 'Hello');
  window.addMessage('test-user', 'assistant', 'Hi there!');
  window.addMessage('test-user', 'user', 'How are you?');
  
  // Retrieve context
  const context = window.getContext('test-user');
  
  // Validate
  const success = context.length === 3 && 
                  context[0].content === 'Hello' && 
                  context[1].content === 'Hi there!' && 
                  context[2].content === 'How are you?';
  
  console.log(success ? '✅ Basic functionality test passed' : '❌ Basic functionality test failed');
  return success;
}

/**
 * Test separate conversations per user
 */
export function testSeparateConversations(): boolean {
  console.log('🧪 Testing separate conversations...');
  
  const window = ConversationWindow.getInstance();
  window.clear('user1');
  window.clear('user2');
  
  // Add messages for two users
  window.addMessage('user1', 'user', 'Hello from user1');
  window.addMessage('user2', 'user', 'Hello from user2');
  
  // Check contexts are separate
  const context1 = window.getContext('user1');
  const context2 = window.getContext('user2');
  
  const success = context1.length === 1 && 
                  context2.length === 1 && 
                  context1[0].content === 'Hello from user1' && 
                  context2[0].content === 'Hello from user2';
  
  console.log(success ? '✅ Separate conversations test passed' : '❌ Separate conversations test failed');
  return success;
}

/**
 * Test conversation clearing
 */
export function testConversationClearing(): boolean {
  console.log('🧪 Testing conversation clearing...');
  
  const window = ConversationWindow.getInstance();
  window.clear('test-user');
  
  // Add messages
  window.addMessage('test-user', 'user', 'Hello');
  window.addMessage('test-user', 'assistant', 'Hi!');
  
  // Clear and verify
  window.clear('test-user');
  const context = window.getContext('test-user');
  
  const success = context.length === 0;
  console.log(success ? '✅ Conversation clearing test passed' : '❌ Conversation clearing test failed');
  return success;
}

/**
 * Test token trimming
 */
export function testTokenTrimming(): boolean {
  console.log('🧪 Testing token trimming...');
  
  const window = ConversationWindow.getInstance();
  window.clear('test-user');
  
  // Add many long messages to trigger trimming
  for (let i = 0; i < 20; i++) {
    const longMessage = 'This is a very long message that contains many words and should contribute significantly to the token count. '.repeat(10);
    window.addMessage('test-user', 'user', longMessage);
  }
  
  const context = window.getContext('test-user');
  const stats = window.getStats('test-user');
  
  // Should have trimmed to stay under token limit
  const success = context.length < 20 && stats.tokenCount < 8000;
  console.log(success ? '✅ Token trimming test passed' : '❌ Token trimming test failed');
  console.log(`   Messages: ${context.length}, Tokens: ${stats.tokenCount}`);
  return success;
}

/**
 * Run all tests
 */
export function runAllTests(): boolean {
  console.log('🚀 Running all ConversationWindow tests...\n');
  
  const results = [
    testBasicFunctionality(),
    testSeparateConversations(),
    testConversationClearing(),
    testTokenTrimming()
  ];
  
  const allPassed = results.every(result => result);
  console.log(`\n${allPassed ? '🎉 All tests passed!' : '❌ Some tests failed!'}`);
  
  return allPassed;
}

/**
 * Manual test function for quick verification
 */
export function runConversationWindowTest(): void {
  console.log('🧪 Running ConversationWindow manual test...');
  
  const window = ConversationWindow.getInstance();
  window.clear('test-user');
  
  // Add some messages
  window.addMessage('test-user', 'user', 'תמחק את רשימת דברים לבית');
  window.addMessage('test-user', 'assistant', 'רשימת "דברים לבית" נמצאה. אני אמחק את הרשימה עבורך.');
  window.addMessage('test-user', 'user', 'תמחק אותה');
  
  // Get context
  const context = window.getContext('test-user');
  console.log('📝 Context:', context);
  
  // Get stats
  const stats = window.getStats('test-user');
  console.log('📊 Stats:', stats);
  
  // Format conversation
  const formatted = window.formatConversation('test-user');
  console.log('📋 Formatted:', formatted);
  
  console.log('✅ ConversationWindow test completed!');
}
