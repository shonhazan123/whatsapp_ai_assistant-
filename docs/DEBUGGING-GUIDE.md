# 🐛 Debugging Guide - WhatsApp AI Assistant

## 📋 Table of Contents
1. [Quick Start](#quick-start)
2. [Using VS Code Debugger](#using-vs-code-debugger)
3. [Setting Breakpoints](#setting-breakpoints)
4. [Viewing the Message Flow](#viewing-the-message-flow)
5. [Common Debugging Scenarios](#common-debugging-scenarios)
6. [Advanced Debugging](#advanced-debugging)

---

## 🚀 Quick Start

### Method 1: VS Code/Cursor Debugger (Recommended)

1. **Open the Debug Panel**
   - Press `F5` or click the Debug icon (bug icon) in the left sidebar
   - Or press `Ctrl+Shift+D` (Windows/Linux) / `Cmd+Shift+D` (Mac)

2. **Select Debug Configuration**
   - Choose **"🐛 Debug WhatsApp Bot"** from the dropdown

3. **Start Debugging**
   - Click the green play button or press `F5`
   - Your app will start in debug mode

4. **Send a Test Message**
   - Send a message from your phone to your WhatsApp Business number
   - Watch the debugger catch your breakpoints!

### Method 2: Enhanced Logging (No Debugger)

Just run with detailed logs:
```bash
NODE_ENV=development npm run dev
```

---

## 🎯 Using VS Code Debugger

### Available Debug Configurations

We've created 3 debug configurations for you:

#### 1. 🐛 Debug WhatsApp Bot
**Best for**: Debugging the entire application
```json
{
  "name": "🐛 Debug WhatsApp Bot"
}
```
- Starts the full application
- Loads `.env` file automatically
- Shows all console output
- Catches all breakpoints

#### 2. 🔍 Debug with ts-node
**Best for**: TypeScript-specific debugging
```json
{
  "name": "🔍 Debug with ts-node"
}
```
- Direct TypeScript execution
- Better source map support
- Useful for complex TypeScript issues

#### 3. 🧪 Debug Test Webhook
**Best for**: Testing without sending real WhatsApp messages
```json
{
  "name": "🧪 Debug Test Webhook"
}
```
- Simulates a webhook call
- No need for ngrok or WhatsApp
- Perfect for quick testing

---

## 🔴 Setting Breakpoints

### Where to Set Breakpoints

#### 1. **Webhook Entry Point**
File: `src/routes/webhook.ts`

```typescript
// Line 36: When webhook receives POST
whatsappWebhook.post('/whatsapp', async (req: Request, res: Response) => {
  // 🔴 Set breakpoint here to catch incoming webhooks
  const payload: WhatsAppWebhookPayload = req.body;
```

#### 2. **Message Handler**
File: `src/routes/webhook.ts`

```typescript
// Line 61: Start of message processing
async function handleIncomingMessage(message: WhatsAppMessage): Promise<void> {
  // 🔴 Set breakpoint here to inspect message object
  const userPhone = message.from;
```

#### 3. **AI Agent Processing**
File: `src/agents/mainAgent.ts`

```typescript
// Line 61: Main message processing
export async function processMessage(
  userPhone: string,
  messageText: string
): Promise<string> {
  // 🔴 Set breakpoint here to see AI processing
  const history = await getConversationHistory(userPhone);
```

#### 4. **Database Operations**
File: `src/services/memory.ts`

```typescript
// Line 19: Getting conversation history
export async function getConversationHistory(
  userPhone: string,
  limit: number = DEFAULT_MESSAGE_LIMIT
): Promise<ConversationMessage[]> {
  // 🔴 Set breakpoint here to inspect database queries
  const result = await query(...);
```

#### 5. **WhatsApp API Calls**
File: `src/services/whatsapp.ts`

```typescript
// Line 10: Sending messages
export async function sendWhatsAppMessage(to: string, message: string): Promise<void> {
  // 🔴 Set breakpoint here to see outgoing messages
  await axios.post(...);
```

### How to Set Breakpoints

1. **Click in the gutter** (left of line numbers) - a red dot appears
2. **Or press F9** while cursor is on the line
3. **Conditional breakpoints**: Right-click the red dot → "Edit Breakpoint"
   - Example: `messageText.includes('hello')`

---

## 👀 Viewing the Message Flow

### Complete Message Flow

```
1. WhatsApp sends POST to /webhook/whatsapp
   📍 src/routes/webhook.ts:36
   
2. Extract message from payload
   📍 src/routes/webhook.ts:46
   
3. Call handleIncomingMessage()
   📍 src/routes/webhook.ts:61
   
4. Send typing indicator
   📍 src/routes/webhook.ts:77
   
5. Extract message text
   📍 src/routes/webhook.ts:82
   
6. Process through AI agent
   📍 src/agents/mainAgent.ts:61
   
7. Get conversation history
   📍 src/services/memory.ts:19
   
8. Detect intent
   📍 src/agents/mainAgent.ts:105
   
9. Route to appropriate agent or general response
   📍 src/agents/mainAgent.ts:111-119
   
10. Save messages to database
    📍 src/services/memory.ts:55
    
11. Send response to WhatsApp
    📍 src/services/whatsapp.ts:10
```

### Debug Variables to Watch

Add these to the **Watch** panel (Debug sidebar → Watch):

```javascript
// User info
userPhone
messageText

// Conversation context
history
history.length
estimateTokens(history)

// AI response
intent
response

// Timing
startTime
Date.now() - startTime
```

---

## 🔍 Common Debugging Scenarios

### Scenario 1: Message Not Received

**Set breakpoints at:**
1. `src/routes/webhook.ts:36` - Check if webhook is called
2. `src/routes/webhook.ts:44` - Inspect `payload` object

**Check:**
- Is ngrok running?
- Is webhook URL correct in Meta dashboard?
- Is `payload.entry` defined?

### Scenario 2: Bot Not Responding

**Set breakpoints at:**
1. `src/agents/mainAgent.ts:61` - Is AI agent called?
2. `src/agents/mainAgent.ts:119` - What's the response?
3. `src/services/whatsapp.ts:10` - Is message being sent?

**Check:**
- OpenAI API key valid?
- Check `response` variable value
- Any errors in catch blocks?

### Scenario 3: No Conversation Memory

**Set breakpoints at:**
1. `src/services/memory.ts:19` - Getting history
2. `src/services/memory.ts:55` - Saving message

**Check:**
- Database connected?
- `history` array length
- Any database errors?

### Scenario 4: Wrong Intent Detection

**Set breakpoints at:**
1. `src/agents/mainAgent.ts:134` - detectIntent function
2. Check `intent` variable value

**Inspect:**
```javascript
// In Debug Console
calendarKeywords.some(k => messageText.toLowerCase().includes(k))
emailKeywords.some(k => messageText.toLowerCase().includes(k))
```

---

## 🛠️ Advanced Debugging

### Debug Console Commands

While paused at a breakpoint, use the Debug Console:

```javascript
// Inspect variables
console.log(messageText)
console.log(JSON.stringify(message, null, 2))

// Test functions
estimateTokens(history)
detectIntent("schedule a meeting")

// Check environment
process.env.OPENAI_API_KEY
process.env.DB_HOST

// Manipulate data
messageText = "test message"
history.length
```

### Logpoints (Non-Breaking Breakpoints)

Right-click in gutter → "Add Logpoint"

Examples:
```
Message received: {messageText}
History length: {history.length}
Intent detected: {intent}
Response: {response}
```

### Call Stack Navigation

When paused at breakpoint:
1. View **Call Stack** panel
2. Click any function to see its context
3. Inspect variables at each level

### Step Through Code

- **F10**: Step Over (execute current line)
- **F11**: Step Into (enter function)
- **Shift+F11**: Step Out (exit function)
- **F5**: Continue (run to next breakpoint)

### Watch Expressions

Add to Watch panel:
```javascript
message.from
message.text?.body
history.length
response.length
Date.now() - startTime
```

---

## 📊 Enhanced Logging Output

With our enhanced logging, you'll see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 NEW MESSAGE RECEIVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 From: +1234567890
📋 Message ID: wamid.xxx
📝 Type: text
💬 Message: "Hello, how are you?"
🤖 AI Processing: "Hello, how are you?"
Context: 5 messages, ~234 tokens
Detected intent: general
💡 AI Response: "I'm doing great! How can I help you today?"
✅ Message handled successfully in 1234ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🎯 Quick Debug Checklist

Before debugging, verify:

- [ ] `.env` file has all required variables
- [ ] Database is connected (check startup logs)
- [ ] ngrok is running (if testing with real WhatsApp)
- [ ] OpenAI API key is valid
- [ ] WhatsApp webhook is configured

---

## 💡 Pro Tips

1. **Use Conditional Breakpoints** for specific users:
   ```javascript
   userPhone === '+1234567890'
   ```

2. **Log to File** for long debugging sessions:
   ```bash
   npm run dev > debug.log 2>&1
   ```

3. **Test Without WhatsApp** using the test webhook script:
   ```bash
   npm run test:webhook "your test message"
   ```

4. **Monitor Database** in real-time:
   ```sql
   SELECT * FROM conversation_memory ORDER BY created_at DESC LIMIT 10;
   ```

5. **Use Debug Console** to test functions without restarting

---

## 🆘 Still Stuck?

1. Check the logs - they're very detailed!
2. Run `npm run debug` to check all systems
3. Look for error messages in the Debug Console
4. Check the Call Stack to see where execution stopped
5. Inspect variables in the Variables panel

Happy Debugging! 🐛✨

