# Dashboard Statistics Implementation Prompt

## Context

The WhatsApp AI Assistant now tracks **actual paid tokens** (excluding cached tokens) in addition to total tokens. This document provides instructions for updating the dashboard statistics to use accurate token counts.

## Key Changes

### Database Schema Update

The `performance_logs` table now has **two sets of token columns**:

1. **Original columns (for analytics):**
   - `request_tokens` - Total request tokens including cached
   - `response_tokens` - Response tokens (never cached)
   - `total_tokens` - Total tokens including cached

2. **New columns (for cost reporting):**
   - `actual_request_tokens` - Actual paid request tokens (request_tokens - cached_tokens)
   - `actual_total_tokens` - Actual paid total tokens (total_tokens - cached_tokens)

### Important Notes

- **Cached tokens** are stored in `metadata->>'cachedTokens'` (JSONB field)
- **Response tokens are never cached** - use `response_tokens` directly
- **For cost reporting and statistics:** Always use `actual_request_tokens` and `actual_total_tokens`
- **For cache analytics:** Use `request_tokens` and `total_tokens` to calculate cache hit rates

---

## Required Database Migration

**Before updating the dashboard, run this SQL migration:**

```sql
-- File: scripts/add-actual-tokens-columns.sql
-- This adds the new columns and backfills data from existing records
```

**Migration Steps:**
1. Run `scripts/add-actual-tokens-columns.sql` in your Supabase SQL Editor
2. Verify migration: `SELECT COUNT(*) FROM performance_logs WHERE actual_total_tokens = 0 AND total_tokens > 0;` should return 0 or only records with no cached tokens

---

## Dashboard Statistics Updates

### 1. User Statistics

**Current Query (WRONG - uses inflated tokens):**
```sql
SELECT 
  user_phone,
  COUNT(DISTINCT session_id) as sessions,
  COUNT(*) as calls,
  SUM(total_tokens) as total_tokens,
  -- ... cost calculation
FROM performance_logs
WHERE user_phone = '+972507564671'
GROUP BY user_phone;
```

**Updated Query (CORRECT - uses actual paid tokens):**
```sql
SELECT 
  user_phone,
  COUNT(DISTINCT session_id) as sessions,
  COUNT(*) as calls,
  SUM(actual_total_tokens) as total_tokens,  -- ✅ Use actual_total_tokens
  SUM(actual_request_tokens) as request_tokens,  -- ✅ Use actual_request_tokens
  SUM(response_tokens) as response_tokens,
  -- Cost calculation (already correct - uses cached pricing)
  -- ... other fields
FROM performance_logs
WHERE user_phone = '+972507564671'
GROUP BY user_phone;
```

**Example Output:**
```
User: +972507564671
Sessions: 2
Calls: 109
Total Tokens: 510,000  (was: 762,400 - now shows actual paid tokens)
Cost: $1.0239  (unchanged - already uses correct pricing)
```

### 2. Agent Statistics

**Updated Query:**
```sql
SELECT 
  agent,
  COUNT(*) as calls,
  SUM(actual_total_tokens) as total_tokens,  -- ✅ Use actual_total_tokens
  AVG(actual_total_tokens) as avg_tokens_per_call,
  SUM(actual_request_tokens) as request_tokens,
  SUM(response_tokens) as response_tokens,
  AVG(duration_ms) as avg_duration_ms
FROM performance_logs
WHERE timestamp > NOW() - INTERVAL '7 days'
  AND agent IS NOT NULL
GROUP BY agent
ORDER BY total_tokens DESC;
```

### 3. Model Statistics

**Updated Query:**
```sql
SELECT 
  model,
  COUNT(*) as calls,
  SUM(actual_total_tokens) as total_tokens,  -- ✅ Use actual_total_tokens
  AVG(actual_total_tokens) as avg_tokens_per_call,
  SUM(actual_request_tokens) as request_tokens,
  SUM(response_tokens) as response_tokens
FROM performance_logs
WHERE timestamp > NOW() - INTERVAL '7 days'
  AND model IS NOT NULL
GROUP BY model
ORDER BY total_tokens DESC;
```

### 4. Session Statistics

**Updated Query:**
```sql
SELECT 
  session_id,
  user_phone,
  COUNT(DISTINCT request_id) as requests,
  COUNT(*) as calls,
  SUM(actual_total_tokens) as total_tokens,  -- ✅ Use actual_total_tokens
  MIN(timestamp) as first_call,
  MAX(timestamp) as last_call
FROM performance_logs
WHERE session_id = 'session-id-here'
GROUP BY session_id, user_phone;
```

### 5. Cost Calculation

**IMPORTANT:** Cost calculation is **already correct** and doesn't need changes. It uses:
- `cached_tokens` from metadata for cached pricing (90% discount)
- `non_cached_tokens` for regular pricing

**Current Cost Logic (KEEP AS IS):**
```typescript
// Cost calculation already handles cached tokens correctly
const cachedTokens = metadata->>'cachedTokens';
const nonCachedTokens = request_tokens - cachedTokens;
const cost = (nonCachedTokens * regularPrice) + (cachedTokens * cachedPrice);
```

**What Changed:** Only the **token counts** displayed in statistics, not the cost calculation.

---

## Cache Analytics (New Feature)

You can now add cache analytics to the dashboard:

### Cache Hit Rate by Agent

```sql
SELECT 
  agent,
  COUNT(*) as total_calls,
  SUM(CASE WHEN (metadata->>'cachedTokens')::integer > 0 THEN 1 ELSE 0 END) as cache_hits,
  ROUND(100.0 * SUM(CASE WHEN (metadata->>'cachedTokens')::integer > 0 THEN 1 ELSE 0 END) / COUNT(*), 2) as cache_hit_rate_percent,
  SUM((metadata->>'cachedTokens')::integer) as total_cached_tokens,
  SUM(request_tokens) as total_request_tokens,
  ROUND(100.0 * SUM((metadata->>'cachedTokens')::integer) / SUM(request_tokens), 2) as cache_percentage
FROM performance_logs
WHERE timestamp > NOW() - INTERVAL '7 days'
  AND agent IS NOT NULL
GROUP BY agent
ORDER BY cache_hit_rate_percent DESC;
```

### Cache Savings

```sql
SELECT 
  DATE(timestamp) as date,
  SUM((metadata->>'cachedTokens')::integer) as cached_tokens,
  SUM(request_tokens) as total_request_tokens,
  ROUND(100.0 * SUM((metadata->>'cachedTokens')::integer) / SUM(request_tokens), 2) as cache_percentage
FROM performance_logs
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp)
ORDER BY date DESC;
```

---

## Validation Queries

**Run these queries to verify data integrity:**

### 1. Verify Actual Tokens Calculation

```sql
-- Should return 0 rows (all records should have actual <= total)
SELECT 
  id,
  request_tokens,
  actual_request_tokens,
  total_tokens,
  actual_total_tokens,
  (metadata->>'cachedTokens')::integer as cached_tokens
FROM performance_logs
WHERE actual_request_tokens > request_tokens
   OR actual_total_tokens > total_tokens;
```

### 2. Verify Actual Tokens Formula

```sql
-- Should return 0 rows (actual should equal total - cached)
SELECT 
  id,
  request_tokens,
  actual_request_tokens,
  (metadata->>'cachedTokens')::integer as cached_tokens,
  request_tokens - (metadata->>'cachedTokens')::integer as calculated_actual
FROM performance_logs
WHERE actual_request_tokens != (request_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0))
  AND (metadata->>'cachedTokens')::integer IS NOT NULL;
```

### 3. Check for Missing Actual Tokens

```sql
-- Should return 0 rows (all records should have actual tokens)
SELECT COUNT(*) as missing_actual_tokens
FROM performance_logs
WHERE actual_total_tokens = 0 
  AND total_tokens > 0
  AND timestamp > NOW() - INTERVAL '1 day';
```

---

## Migration Checklist

- [ ] Run `scripts/add-actual-tokens-columns.sql` migration
- [ ] Verify migration with validation queries above
- [ ] Update all user statistics queries to use `actual_total_tokens`
- [ ] Update all agent statistics queries to use `actual_total_tokens`
- [ ] Update all model statistics queries to use `actual_total_tokens`
- [ ] Update all session statistics queries to use `actual_total_tokens`
- [ ] **DO NOT** change cost calculation (already correct)
- [ ] Add cache analytics dashboard (optional but recommended)
- [ ] Test with real data to verify token counts are accurate
- [ ] Update frontend displays to show "Paid Tokens" vs "Total Tokens (including cached)"

---

## Example: Before vs After

### Before (Inflated):
```
User: +972507564671
Calls: 109
Sessions: 2
Tokens: 762,400  ❌ (includes 252,400 cached tokens)
Cost: $1.0239
```

### After (Accurate):
```
User: +972507564671
Calls: 109
Sessions: 2
Tokens: 510,000  ✅ (actual paid tokens only)
Cached: 252,400  (shown separately for analytics)
Cost: $1.0239  (unchanged - already correct)
```

---

## Frontend Display Recommendations

### Option 1: Show Both Metrics
```
Total Tokens: 510,000 (Paid)
Cached Tokens: 252,400 (90% savings)
Total with Cache: 762,400 (for reference)
```

### Option 2: Primary Metric Only
```
Tokens: 510,000
(Cached: 252,400 saved)
```

### Option 3: Detailed Breakdown
```
Request Tokens: 450,000 (Paid: 300,000, Cached: 150,000)
Response Tokens: 60,000
Total: 510,000 (Paid)
```

---

## Questions?

If you encounter any issues:
1. Check that the migration script ran successfully
2. Verify `actual_total_tokens` column exists: `SELECT column_name FROM information_schema.columns WHERE table_name = 'performance_logs' AND column_name LIKE 'actual%';`
3. Check for null values: `SELECT COUNT(*) FROM performance_logs WHERE actual_total_tokens IS NULL;`
4. Review the validation queries above

---

## Summary

**Key Takeaway:** 
- Use `actual_total_tokens` and `actual_request_tokens` for all statistics and displays
- Keep `total_tokens` and `request_tokens` for cache analytics only
- Cost calculation is already correct - don't change it
- Response tokens are never cached - use `response_tokens` directly

**Impact:**
- Token counts will now accurately reflect what users actually paid for
- Statistics will show realistic token usage (not inflated by cached tokens)
- Cache savings can be displayed separately for transparency

