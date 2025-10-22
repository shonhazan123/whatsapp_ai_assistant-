/**
 * ConversationWindow Architecture Demo
 * 
 * This shows how the new ChatGPT-style conversation window works
 * with simple in-memory conversation context.
 */

import { ConversationWindow } from '../core/memory/ConversationWindow';

async function demonstrateConversationWindow() {
  const conversationWindow = ConversationWindow.getInstance();
  const userPhone = '+1234567890';

  console.log('🤖 ConversationWindow Architecture Demo\n');

  // Simulate conversation flow
  console.log('=== CONVERSATION FLOW ===\n');

  // 1. Add messages to conversation window
  console.log('1. User: "Create a task: Buy groceries"');
  conversationWindow.addMessage(userPhone, 'user', 'Create a task: Buy groceries');
  console.log('   ↓ ConversationWindow.addMessage()');
  console.log('   → Message stored in memory');
  console.log('');

  // 2. Get conversation context
  console.log('2. Getting conversation context');
  const context = conversationWindow.getContext(userPhone);
  console.log(`   ↓ ConversationWindow.getContext() → ${context.length} messages`);
  console.log('   → Context passed to agents');
  console.log('');

  // 3. Add assistant response
  console.log('3. Assistant: "Task created: Buy groceries"');
  conversationWindow.addMessage(userPhone, 'assistant', 'Task created: Buy groceries');
  console.log('   ↓ ConversationWindow.addMessage()');
  console.log('   → Response stored in memory');
  console.log('');

  // 4. Hebrew conversation with context
  console.log('4. User: "תמחק אותה" (Delete it)');
  conversationWindow.addMessage(userPhone, 'user', 'תמחק אותה');
  console.log('   ↓ ConversationWindow.addMessage()');
  console.log('   ↓ ConversationWindow.getContext() → Full conversation history');
  console.log('   ↓ Agent receives full context (including "Buy groceries" task)');
  console.log('   → "Task \'Buy groceries\' deleted"');
  console.log('');

  // 5. Check conversation stats
  console.log('5. Check conversation statistics');
  const stats = conversationWindow.getStats(userPhone);
  console.log(`   ↓ ConversationWindow.getStats() → ${stats.messageCount} messages, ${stats.tokenCount} tokens`);
  console.log('');

  console.log('=== COMPONENT RESPONSIBILITIES ===\n');
  console.log('   - ConversationWindow: In-memory conversation storage');
  console.log('   - MainAgent: Routes messages and passes context to agents');
  console.log('   - Domain Agents: Receive full conversation context');
  console.log('   - HITLNode: Handles disambiguation with context');
  console.log('   - QueryResolver: Resolves entities with context');
  console.log('');

  console.log('=== DATA FLOW ===\n');
  console.log('User Message');
  console.log('   ↓');
  console.log('ConversationWindow.addMessage()');
  console.log('   ↓');
  console.log('MainAgent.processRequest()');
  console.log('   ↓');
  console.log('ConversationWindow.getContext()');
  console.log('   ↓');
  console.log('Domain Agent (with full context)');
  console.log('   ↓');
  console.log('ConversationWindow.addMessage() (assistant response)');
  console.log('   ↓');
  console.log('Response to User');
  console.log('');

  console.log('=== BENEFITS ===\n');
  console.log('   ✅ Simple: No complex entity tracking');
  console.log('   ✅ Fast: No database calls for conversation history');
  console.log('   ✅ Reliable: In-memory storage with automatic trimming');
  console.log('   ✅ Context-aware: Full conversation history available to all agents');
  console.log('   ✅ ChatGPT-style: Familiar conversation window approach');
  console.log('');

  console.log('✅ Demo completed! The system now uses a simple ChatGPT-style conversation window.');
}

// Run the demo
if (require.main === module) {
  demonstrateConversationWindow().catch(console.error);
}

export { demonstrateConversationWindow };

