# 📊 Message Flow Diagram

## Complete Message Processing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     WhatsApp User Sends Message                  │
│                              📱 → 💬                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. WEBHOOK RECEIVES POST REQUEST                                │
│  📍 src/routes/webhook.ts:36                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  whatsappWebhook.post('/whatsapp', ...)                         │
│  • Receives WhatsAppWebhookPayload                               │
│  • Responds 200 immediately                                      │
│  • Extracts message from payload                                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. HANDLE INCOMING MESSAGE                                      │
│  📍 src/routes/webhook.ts:61                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  handleIncomingMessage(message)                                  │
│  • Extract userPhone from message.from                           │
│  • Log message details                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. SEND TYPING INDICATOR                                        │
│  📍 src/services/whatsapp.ts:33                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  sendTypingIndicator(userPhone, messageId)                      │
│  • Mark message as read                                          │
│  • Show typing indicator (three dots)                            │
│  • POST to WhatsApp API                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. EXTRACT MESSAGE CONTENT                                      │
│  📍 src/routes/webhook.ts:82                                     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  if (message.type === 'text')                                    │
│  • Text: Extract from message.text.body                          │
│  • Audio: Download & transcribe with OpenAI Whisper             │
│  • Other: Send unsupported message error                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. PROCESS MESSAGE (AI AGENT)                                   │
│  📍 src/agents/mainAgent.ts:61                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  processMessage(userPhone, messageText)                          │
│  • Get conversation history from database                        │
│  • Estimate tokens & trim if needed                              │
│  • Build context: [system, ...history, user_message]            │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. GET CONVERSATION HISTORY                                     │
│  📍 src/services/memory.ts:19                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  getConversationHistory(userPhone)                               │
│  • Query database for last 20 messages                           │
│  • Filter by time window (24 hours)                              │
│  • Return in chronological order                                 │
│  • Fallback to [] if database fails                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. TOKEN MANAGEMENT                                             │
│  📍 src/agents/mainAgent.ts:73                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  estimateTokens(history)                                         │
│  • Calculate token count (chars / 4)                             │
│  • Trim old messages if exceeds limit                            │
│  • Keep most recent messages                                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. DETECT INTENT                                                │
│  📍 src/agents/mainAgent.ts:105                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  detectIntent(messageText)                                       │
│  • Check for calendar keywords → 'calendar'                      │
│  • Check for email keywords → 'email'                            │
│  • Check for database keywords → 'database'                      │
│  • Default → 'general'                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
┌───────────────────────┐   ┌───────────────────────┐
│  CALENDAR AGENT       │   │  EMAIL AGENT          │
│  📍 calanderAgent.ts  │   │  📍 gmailAgent.ts     │
│  ━━━━━━━━━━━━━━━━━━  │   │  ━━━━━━━━━━━━━━━━━━  │
│  • Google Calendar    │   │  • Gmail API          │
│  • Create events      │   │  • Send emails        │
│  • List events        │   │  • Read inbox         │
└───────────┬───────────┘   └───────────┬───────────┘
            │                           │
            └───────────┬───────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │  DATABASE AGENT               │
        │  📍 databaseAgent.ts          │
        │  ━━━━━━━━━━━━━━━━━━━━━━━━━━  │
        │  • Task management            │
        │  • Contact management         │
        │  • Lists & notes              │
        └───────────┬───────────────────┘
                    │
                    ▼
        ┌───────────────────────────────┐
        │  GENERAL RESPONSE             │
        │  📍 mainAgent.ts:114          │
        │  ━━━━━━━━━━━━━━━━━━━━━━━━━━  │
        │  • OpenAI GPT-4o-mini         │
        │  • Full conversation context  │
        │  • Natural language response  │
        └───────────┬───────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│  9. SAVE USER MESSAGE                                            │
│  📍 src/services/memory.ts:55                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  saveMessage(userPhone, 'user', messageText)                    │
│  • Get or create user in database                                │
│  • Insert message into conversation_memory                       │
│  • Clean up old messages (keep last 50)                          │
│  • Non-blocking (async)                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  10. SAVE ASSISTANT RESPONSE                                     │
│  📍 src/services/memory.ts:55                                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  saveMessage(userPhone, 'assistant', response)                  │
│  • Save AI's response to database                                │
│  • Link to same user                                             │
│  • Non-blocking (async)                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  11. SEND RESPONSE TO WHATSAPP                                   │
│  📍 src/services/whatsapp.ts:10                                  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  sendWhatsAppMessage(userPhone, response)                       │
│  • POST to WhatsApp Graph API                                    │
│  • Send text message                                             │
│  • Log success/failure                                           │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     User Receives Response                       │
│                              💬 → 📱                             │
│                                                                   │
│  ✅ Total Time: ~1-3 seconds                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Timing Breakdown

```
Step                          Time        Cumulative
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Webhook receives           ~10ms       10ms
2. Handle message             ~5ms        15ms
3. Typing indicator           ~200ms      215ms
4. Extract content            ~5ms        220ms
5. Get history (DB)           ~50ms       270ms
6. Token management           ~5ms        275ms
7. Detect intent              ~10ms       285ms
8. AI processing              ~800ms      1085ms
9. Save messages (async)      ~50ms       1135ms
10. Send to WhatsApp          ~200ms      1335ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOTAL                                     ~1.3s
```

## Error Handling Flow

```
Any Step Fails
     │
     ▼
┌─────────────────────┐
│  Catch Error        │
│  • Log error        │
│  • Send error msg   │
└─────────────────────┘
```

## Database Fallback

```
Database Query Fails
     │
     ▼
┌─────────────────────┐
│  Return []          │
│  • Continue         │
│  • No memory        │
│  • Still works!     │
└─────────────────────┘
```

## Key Decision Points

### 1. Message Type (Line 82)
```
Text → Extract directly
Audio → Download & transcribe
Other → Send error message
```

### 2. Intent Detection (Line 105)
```
Calendar keywords → Calendar Agent
Email keywords → Email Agent
Database keywords → Database Agent
None → General Response
```

### 3. Token Limit (Line 78)
```
Tokens > Limit → Trim history
Tokens < Limit → Keep all
```

## Breakpoint Strategy

Set breakpoints at these key decision points:

1. **Line 71** - Message received
2. **Line 82** - Message type check
3. **Line 67** - Get history
4. **Line 105** - Intent detection
5. **Line 119** - Get response
6. **Line 109** - Send to user

This lets you see every major decision in the flow!

