# How to Verify Prompt Caching is Working

## 🔍 Understanding OpenAI Prompt Caching

### Cache Lifecycle

1. **First Request** (Cache WRITE):
   - System prompt is sent with `cache_control: { type: "ephemeral" }`
   - OpenAI WRITES the prompt to cache
   - Returns `cache_creation_tokens` in usage
   - **No savings yet** - this call creates the cache

2. **Subsequent Requests** (Cache READ - within ~5 minutes):
   - System prompt matches cached version
   - OpenAI READS from cache
   - Returns `cached_tokens` in usage
   - **90% cost savings** on cached tokens!

3. **After ~5 minutes**:
   - Cache expires (ephemeral)
   - Next request writes to cache again

---

## 📊 What to Look For in Logs

### First Request (Cache Write):
```
[DEBUG] 🔖 Marking system prompt for caching { estimatedTokens: 9336, contentLength: 37344 }
[DEBUG] 🔖 Marking tool definitions for caching { toolCount: 6, estimatedTokens: 4315 }
[INFO] 📝 Cache WRITE: 13651 tokens written to cache
```

### Second Request (Cache Hit!):
```
[DEBUG] 🔖 Marking system prompt for caching { estimatedTokens: 9336, contentLength: 37344 }
[INFO] ✅ Cache HIT: 13651 tokens served from cache (94.2% of input)
[INFO] 💰 Cache savings: 13651 tokens = $0.3683 saved
```

---

## 🧪 Testing Steps

### Quick Test (2 requests)

1. **Make first request** (writes to cache):
```bash
# Send a WhatsApp message to your bot
"מה יש לי ביומן מחר?"
```

Watch logs for:
- ✅ `🔖 Marking system prompt for caching`
- ✅ `📝 Cache WRITE: X tokens written to cache`

2. **Make second request within 5 minutes** (reads from cache):
```bash
# Send another message immediately
"מה יש לי ביומן היום?"
```

Watch logs for:
- ✅ `🔖 Marking system prompt for caching`
- ✅ `✅ Cache HIT: X tokens served from cache`
- ✅ `💰 Cache savings: X tokens = $Y saved`

---

## 🔍 API Response Structure

OpenAI returns cache info in the `usage` object:

```json
{
  "usage": {
    "prompt_tokens": 14500,
    "completion_tokens": 150,
    "total_tokens": 14650,
    "prompt_tokens_details": {
      "cached_tokens": 13651,           // ← Cache HIT!
      "cache_creation_tokens": 0
    }
  }
}
```

Or on first request:
```json
{
  "usage": {
    "prompt_tokens": 14500,
    "completion_tokens": 150,
    "total_tokens": 14650,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "cache_creation_tokens": 13651    // ← Cache WRITE
    }
  }
}
```

---

## 📈 What You Should See

### Expected Token Breakdown

For a typical Calendar Agent request:

**Without Caching** (before Phase 1):
```
System Prompt:     9,336 tokens × $0.030/1k = $0.2801
Function Defs:     4,315 tokens × $0.030/1k = $0.1295
User Message:         50 tokens × $0.030/1k = $0.0015
Context:             100 tokens × $0.030/1k = $0.0030
──────────────────────────────────────────────────────
Total Input:      13,801 tokens             = $0.4141
```

**With Caching** (after Phase 1 - 2nd+ request):
```
System Prompt:     9,336 tokens × $0.003/1k = $0.0280  (90% OFF!)
Function Defs:     4,315 tokens × $0.003/1k = $0.0129  (90% OFF!)
User Message:         50 tokens × $0.030/1k = $0.0015  (regular)
Context:             100 tokens × $0.030/1k = $0.0030  (regular)
──────────────────────────────────────────────────────
Total Input:      13,801 tokens             = $0.0454

SAVINGS: $0.3687 per request (89% reduction!)
```

---

## 🐛 Troubleshooting

### Not Seeing Cache Hits?

1. **Check if cache_control is being sent**:
   - Look for: `🔖 Marking system prompt for caching`
   - If missing: Check if `ENABLE_PROMPT_CACHING=false` in .env

2. **Check OpenAI API response**:
   - Look for: `API Usage:` in DEBUG logs
   - Should show `cached_tokens` or `cache_creation_tokens`

3. **Make sure you're making 2+ requests**:
   - First request = cache write (no savings)
   - Second request = cache hit (savings!)

4. **Check timing**:
   - Cache expires after ~5 minutes
   - Make second request within 5 minutes of first

5. **Check model support**:
   - Prompt caching works with: gpt-4o, gpt-4-turbo, gpt-5.1, gpt-3.5-turbo (latest)
   - Older models don't support caching

### Still Not Working?

Run this test script:
```bash
npx ts-node scripts/test-cache-implementation.ts
```

Or check the raw API response manually:
```typescript
import { OpenAIService } from './src/services/ai/OpenAIService';

const service = new OpenAIService();
const response = await service.createCompletion({
  messages: [
    { role: 'system', content: 'Large system prompt here...', cache_control: { type: 'ephemeral' } },
    { role: 'user', content: 'Test' }
  ]
});

console.log(response.usage);
// Should show: prompt_tokens_details.cached_tokens or cache_creation_tokens
```

---

## 💡 Key Insights

1. **First call never saves**: It writes to cache
2. **Savings on 2nd+ calls**: Within 5-minute window
3. **Huge savings**: 90% discount on cached tokens
4. **Automatic**: No code changes needed
5. **Works for all agents**: Database, Calendar, Gmail, SecondBrain

---

## 📊 Monitoring Cache Performance

Check stats anytime:
```typescript
import { PromptCacheService } from './src/services/ai/PromptCacheService';

const stats = PromptCacheService.getInstance().getStats();
console.log({
  totalRequests: stats.totalRequests,
  cacheHits: stats.cacheHits,
  hitRate: `${(stats.cacheHitRate * 100).toFixed(1)}%`,
  tokensSaved: stats.tokensSaved.toLocaleString(),
  costSaved: `$${stats.costSaved.toFixed(2)}`
});
```

---

## ✅ Success Indicators

You'll know caching is working when you see:

1. ✅ `🔖 Marking system prompt for caching` in logs
2. ✅ `📝 Cache WRITE` on first request
3. ✅ `✅ Cache HIT` on subsequent requests
4. ✅ `💰 Cache savings` showing dollar amount
5. ✅ Token count much lower on 2nd+ requests
6. ✅ Cache hit rate increasing over time

---

**Remember**: Make 2 requests to see the magic! 🎩✨

