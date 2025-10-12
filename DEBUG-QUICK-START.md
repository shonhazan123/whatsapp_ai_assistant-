# 🐛 Debug Mode - Quick Start

## 🚀 Start Debugging in 3 Steps

### Step 1: Open Debug Panel
Press **`F5`** or click the **Debug icon** (🐛) in the left sidebar

### Step 2: Select Configuration
Choose **"🐛 Debug WhatsApp Bot"** from the dropdown

### Step 3: Start
Click the **green play button** or press **`F5`** again

---

## 🔴 Set Your First Breakpoint

1. Open `src/routes/webhook.ts`
2. Find line **71** (where it says `const userPhone = message.from;`)
3. Click in the **gutter** (left of line number) - a **red dot** appears
4. That's it! You've set a breakpoint

---

## 📱 Test It

1. **Send a message** from your phone to your WhatsApp Business number
2. **Watch the magic** - your code will pause at the breakpoint!
3. **Inspect variables** in the left panel:
   - `message` - the incoming message object
   - `userPhone` - the sender's phone number
   - `messageText` - what they said

---

## 🎮 Debug Controls

| Key | Action |
|-----|--------|
| **F5** | Continue (run to next breakpoint) |
| **F10** | Step Over (execute current line) |
| **F11** | Step Into (enter function) |
| **Shift+F11** | Step Out (exit function) |
| **Ctrl+Shift+F5** | Restart |
| **Shift+F5** | Stop |

---

## 👀 What to Watch

### Variables Panel (Left Side)
Shows all variables at current breakpoint:
- `message` - Full message object
- `userPhone` - Sender's number
- `messageText` - Message content
- `history` - Conversation history
- `response` - AI's response

### Call Stack Panel
Shows the path your code took to get here

### Debug Console (Bottom)
Type commands to test things:
```javascript
console.log(messageText)
console.log(history.length)
```

---

## 🎯 Key Breakpoint Locations

### 1. **Message Received**
`src/routes/webhook.ts:71`
```typescript
const userPhone = message.from;  // 🔴 Break here
```

### 2. **AI Processing**
`src/agents/mainAgent.ts:67`
```typescript
let history = await getConversationHistory(userPhone);  // 🔴 Break here
```

### 3. **Database Query**
`src/services/memory.ts:25`
```typescript
const result = await query(...);  // 🔴 Break here
```

### 4. **Sending Response**
`src/services/whatsapp.ts:12`
```typescript
await axios.post(...);  // 🔴 Break here
```

---

## 📊 See the Full Flow

Set breakpoints at **all 4 locations** above, then:

1. Send a message from your phone
2. Press **F5** to continue to each breakpoint
3. Watch the message flow through your system!

```
Message Received → AI Processing → Database → Send Response
     ↓                  ↓              ↓            ↓
  Line 71           Line 67        Line 25      Line 12
```

---

## 💡 Pro Tips

### Conditional Breakpoints
Right-click the red dot → "Edit Breakpoint"
```javascript
messageText.includes('hello')  // Only break if message contains "hello"
userPhone === '+1234567890'    // Only break for specific user
```

### Logpoints (No Pause)
Right-click → "Add Logpoint"
```
Message: {messageText}
From: {userPhone}
```

### Watch Expressions
Add to Watch panel:
```javascript
history.length
messageText
response
```

---

## 🐛 Common Issues

### Breakpoint Not Hit?
- ✅ Make sure you started with F5 (not `npm run dev`)
- ✅ Check the red dot is solid (not hollow)
- ✅ Send a message from your phone

### Can't See Variables?
- ✅ Make sure you're paused at a breakpoint
- ✅ Check the Variables panel is open
- ✅ Expand objects with the arrow

### App Won't Start?
- ✅ Check `.env` file exists
- ✅ Run `npm install` first
- ✅ Check for TypeScript errors

---

## 🎓 Learn More

Full guide: `docs/DEBUGGING-GUIDE.md`

---

## 🚀 Ready to Debug!

1. Press **F5**
2. Set a breakpoint at line **71** in `webhook.ts`
3. Send a message from your phone
4. Watch your code pause!

**You're now debugging like a pro!** 🎉

