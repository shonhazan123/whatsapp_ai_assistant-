# Conversation Memory Best Practices

## 📚 Overview

This document explains the **industry-standard best practices** for implementing conversation memory in AI chatbots, as implemented in this WhatsApp AI Assistant.

## 🎯 Key Principles

### 1. **Sliding Window Approach** ✅

**What it is:**
- Keep only the most recent N messages (default: 20 messages = 10 exchanges)
- Automatically discard older messages

**Why it's important:**
- Prevents token overflow
- Maintains relevant context
- Reduces API costs
- Improves response time

**Implementation:**
```typescript
const DEFAULT_MESSAGE_LIMIT = 20; // 10 user + 10 assistant messages
const MAX_MESSAGE_AGE_HOURS = 24; // Auto-expire old conversations
```

### 2. **Token Management** 📊

**What it is:**
- Monitor and limit total tokens sent to AI
- Estimate tokens before API calls
- Trim history if approaching limits

**Why it's important:**
- API has token limits (e.g., GPT-4o-mini: 128k context window)
- Costs scale with tokens
- Performance degrades with too much context

**Implementation:**
```typescript
// Rough estimation: 1 token ≈ 4 characters
function estimateTokens(messages: ConversationMessage[]): number {
  const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
  return Math.ceil(totalChars / 4);
}

// Trim if needed
while (historyTokens > availableTokens && history.length > 0) {
  history.shift(); // Remove oldest message
  historyTokens = estimateTokens(history);
}
```

### 3. **Graceful Degradation** 🛡️

**What it is:**
- System works even if database fails
- Non-blocking saves
- Fallback to stateless mode

**Why it's important:**
- High availability
- Better user experience
- Fault tolerance

**Implementation:**
```typescript
// Non-blocking saves
saveMessage(userPhone, 'user', messageText).catch(err => 
  logger.warn('Could not save user message:', err.message)
);

// Fallback on read
const history = await getConversationHistory(userPhone).catch(() => {
  logger.warn('Database unavailable, continuing without history');
  return [];
});
```

### 4. **Automatic Cleanup** 🧹

**What it is:**
- Delete old messages automatically
- Keep database size manageable
- Respect user privacy

**Why it's important:**
- Prevents database bloat
- Reduces query time
- Complies with data retention policies

**Implementation:**
```typescript
// Keep only last 50 messages per user
await query(
  `DELETE FROM conversation_memory 
   WHERE id IN (
     SELECT id FROM conversation_memory 
     WHERE user_phone = $1 
     ORDER BY created_at DESC 
     OFFSET 50
   )`,
  [userPhone]
);
```

### 5. **Context Ordering** 📝

**What it is:**
- Store messages in database (newest first for efficiency)
- Return to AI in chronological order (oldest first)

**Why it's important:**
- AI models expect chronological order
- Maintains conversation flow
- Efficient database queries

**Implementation:**
```typescript
// Query: newest first (efficient with indexes)
ORDER BY created_at DESC LIMIT 20

// Return: oldest first (reverse for AI)
return result.rows.reverse().map(row => ({
  role: row.role,
  content: row.content
}));
```

## 🏗️ Architecture

### Message Flow

```
User Message
    ↓
1. Retrieve last N messages from DB
    ↓
2. Estimate tokens
    ↓
3. Trim if needed (remove oldest)
    ↓
4. Build context: [system, ...history, user_message]
    ↓
5. Send to AI
    ↓
6. Get response
    ↓
7. Save both messages to DB (async)
    ↓
8. Send response to user
```

### Database Schema

```sql
CREATE TABLE conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_phone VARCHAR(20) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversation_user ON conversation_memory(user_phone, created_at);
```

## 📏 Configuration Parameters

### Recommended Values

```typescript
// Message limits
DEFAULT_MESSAGE_LIMIT = 20        // 10 exchanges
MAX_MESSAGE_AGE_HOURS = 24        // 1 day
MAX_STORED_MESSAGES = 50          // Per user

// Token limits
MAX_CONTEXT_TOKENS = 8000         // For gpt-4o-mini
SYSTEM_PROMPT_TOKENS = 500        // Approximate
```

### Adjusting for Your Use Case

**Short-term memory (customer support):**
```typescript
DEFAULT_MESSAGE_LIMIT = 10        // 5 exchanges
MAX_MESSAGE_AGE_HOURS = 2         // 2 hours
```

**Long-term memory (personal assistant):**
```typescript
DEFAULT_MESSAGE_LIMIT = 40        // 20 exchanges
MAX_MESSAGE_AGE_HOURS = 168       // 1 week
```

**High-volume (many users):**
```typescript
MAX_STORED_MESSAGES = 30          // Reduce storage
```

## 🔄 Advanced Patterns

### 1. **Context Summarization** (Not yet implemented)

For very long conversations:
```typescript
// Summarize old messages
if (history.length > 30) {
  const oldMessages = history.slice(0, 20);
  const summary = await summarizeConversation(oldMessages);
  history = [
    { role: 'system', content: `Previous conversation summary: ${summary}` },
    ...history.slice(20)
  ];
}
```

### 2. **Session Management** (Not yet implemented)

Track conversation sessions:
```typescript
// New session if > 1 hour since last message
if (timeSinceLastMessage > 3600) {
  await startNewSession(userPhone);
}
```

### 3. **Semantic Search** (Not yet implemented)

For retrieving relevant past context:
```typescript
// Use embeddings to find relevant past messages
const relevantContext = await searchSimilarMessages(userPhone, currentMessage);
```

## 🎓 Learning Resources

### Why These Practices Matter

1. **Token Limits**: OpenAI models have context windows (e.g., 128k tokens for GPT-4o-mini)
2. **Cost Optimization**: You pay per token - unnecessary context = wasted money
3. **Response Quality**: Too much context can confuse the model
4. **Performance**: Smaller context = faster responses

### Industry Standards

- **ChatGPT**: Uses sliding window + summarization
- **Claude**: Supports 200k context but still uses windowing
- **Gemini**: 1M context but recommends focused context

### Common Mistakes to Avoid

❌ **Sending entire conversation history every time**
- Wastes tokens and money
- Slows down responses
- May hit API limits

❌ **No token counting**
- Risk of exceeding limits
- Unpredictable costs

❌ **Blocking database operations**
- Slows down responses
- Single point of failure

❌ **No cleanup**
- Database grows indefinitely
- Queries get slower

## 📊 Monitoring

### Key Metrics to Track

```typescript
// Average conversation length
SELECT AVG(message_count) FROM (
  SELECT user_phone, COUNT(*) as message_count
  FROM conversation_memory
  GROUP BY user_phone
) as counts;

// Token usage per conversation
SELECT user_phone, 
       SUM(LENGTH(content)) / 4 as estimated_tokens
FROM conversation_memory
GROUP BY user_phone;

// Old conversations
SELECT COUNT(*) 
FROM conversation_memory 
WHERE created_at < NOW() - INTERVAL '24 hours';
```

## 🚀 Performance Tips

1. **Index your queries**: `CREATE INDEX idx_conversation_user ON conversation_memory(user_phone, created_at);`
2. **Use connection pooling**: Already implemented with `pg.Pool`
3. **Async saves**: Don't wait for DB writes to respond
4. **Cache frequently accessed data**: Consider Redis for active conversations
5. **Batch operations**: Clean up multiple users at once

## 🔐 Privacy & Compliance

### Data Retention

```typescript
// Implement GDPR-compliant deletion
async function deleteUserData(userPhone: string) {
  await query('DELETE FROM conversation_memory WHERE user_phone = $1', [userPhone]);
  await query('DELETE FROM users WHERE phone = $1', [userPhone]);
}
```

### Encryption

```typescript
// Encrypt sensitive data before storing
import crypto from 'crypto';

function encryptMessage(content: string): string {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  return cipher.update(content, 'utf8', 'hex') + cipher.final('hex');
}
```

## 📝 Summary

**The "Right Way" to Handle Conversation Memory:**

1. ✅ Use sliding window (10-20 messages)
2. ✅ Count and limit tokens
3. ✅ Graceful degradation if DB fails
4. ✅ Automatic cleanup of old messages
5. ✅ Non-blocking saves
6. ✅ Proper message ordering
7. ✅ Monitor and optimize
8. ✅ Respect privacy

This implementation follows **production-grade best practices** used by major AI companies and ensures your chatbot is:
- **Reliable**: Works even if database fails
- **Efficient**: Optimizes token usage and costs
- **Scalable**: Handles many users
- **Fast**: Non-blocking operations
- **Maintainable**: Clean, documented code

