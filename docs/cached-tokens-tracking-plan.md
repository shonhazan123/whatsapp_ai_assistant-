# Plan: Track Only Non-Cached (Paid) Tokens

## Problem Statement

Currently, the performance tracking system logs **total tokens** (including cached tokens) in the database and statistics. However, OpenAI charges differently for cached vs non-cached tokens:

- **Cached tokens**: 90% discount (e.g., $0.125 per 1M instead of $1.25 per 1M)
- **Non-cached tokens**: Full price

**Current Issue:**

- Database shows: `request_tokens: 24,182`, `total_tokens: 24,439`
- But user only paid for: `24,182 - 8,192 = 16,190` request tokens
- Statistics are inflated, making it look like more tokens were used than actually paid for

**Goal:**

- Report only **actual paid tokens** in the database and statistics
- Keep cached token information as metadata for analytics
- Each AI call should report: `actualTokens = totalTokens - cachedTokens`

---

## Current State Analysis

### 1. Token Data Flow

```
OpenAI API Response
  ↓
OpenAIService.createCompletion()
  - Extracts: cachedTokens, requestTokens, responseTokens, totalTokens
  - Logs to PerformanceTracker.logAICall()
    ↓
PerformanceTracker.logAICall()
  - Stores: requestTokens, responseTokens, totalTokens (WITH cached tokens)
  - Also stores: cachedTokens (as metadata)
    ↓
PerformanceLogService.uploadSingleLog()
  - Inserts to DB: request_tokens, response_tokens, total_tokens (WITH cached tokens)
    ↓
Database (performance_logs table)
  - Stores inflated token counts
```

### 2. Key Files Involved

1. **`src/services/ai/OpenAIService.ts`** (Lines 149-240)

   - Extracts `cachedTokens` from API response
   - Passes full token counts to `logAICall()`

2. **`src/services/performance/PerformanceTracker.ts`**

   - `logAICall()` (Lines 99-175): Stores full token counts
   - `updateRequestSummary()` (Lines 343-365): Aggregates full token counts
   - `endRequest()` (Lines 400-500): Prints summary with full token counts

3. **`src/services/performance/PerformanceLogService.ts`** (Lines 145-167)

   - `uploadSingleLog()`: Inserts full token counts to database

4. **`src/services/performance/types.ts`**

   - `CallLogEntry`: Defines token fields
   - `RequestSummary`: Defines aggregated token fields

5. **`scripts/create-performance-logs-table.sql`**
   - Database schema for `performance_logs` table

---

## Solution Design

### Approach: Calculate Actual Tokens at Logging Time

**Principle:** Calculate `actualTokens = totalTokens - cachedTokens` when logging, and use actual tokens for all reporting/statistics.

### Token Calculation Logic

For each AI call:

- `actualRequestTokens = requestTokens - cachedTokens`
- `actualResponseTokens = responseTokens` (response tokens are never cached)
- `actualTotalTokens = actualRequestTokens + actualResponseTokens`

**Note:** `totalTokens` from API = `requestTokens + responseTokens`, so:

- `actualTotalTokens = totalTokens - cachedTokens`

---

## Implementation Plan

### Phase 1: Update Type Definitions

**File:** `src/services/performance/types.ts`

**Changes:**

1. Add new fields to `CallLogEntry`:

   ```typescript
   // Existing fields (keep for backward compatibility)
   requestTokens: number;  // Total request tokens (including cached)
   responseTokens: number; // Response tokens (never cached)
   totalTokens: number;    // Total tokens (including cached)
   cachedTokens?: number;  // Cached tokens (metadata)

   // NEW fields (actual paid tokens)
   actualRequestTokens?: number;  // requestTokens - cachedTokens
   actualTotalTokens?: number;     // totalTokens - cachedTokens
   ```

2. Add new fields to `RequestSummary`:

   ```typescript
   // Existing fields (keep for analytics)
   totalTokens: number;           // Total including cached
   requestTokens: number;         // Total including cached
   totalCachedTokens?: number;     // Total cached tokens

   // NEW fields (actual paid tokens)
   actualTotalTokens?: number;    // Sum of actualTotalTokens from all calls
   actualRequestTokens?: number;  // Sum of actualRequestTokens from all calls
   ```

**Rationale:** Keep existing fields for backward compatibility and analytics, add new fields for accurate cost reporting.

---

### Phase 2: Update PerformanceTracker.logAICall()

**File:** `src/services/performance/PerformanceTracker.ts`

**Location:** Lines 132-163 (entry creation)

**Changes:**

1. Calculate actual tokens when creating `CallLogEntry`:

   ```typescript
   const cachedTokens = options.cachedTokens || 0;
   const actualRequestTokens = options.requestTokens - cachedTokens;
   const actualTotalTokens = options.totalTokens - cachedTokens;

   const entry: CallLogEntry = {
   	// ... existing fields ...
   	requestTokens: options.requestTokens, // Keep original
   	responseTokens: options.responseTokens,
   	totalTokens: options.totalTokens, // Keep original
   	cachedTokens: cachedTokens, // Keep for analytics

   	// NEW: Actual paid tokens
   	actualRequestTokens: actualRequestTokens,
   	actualTotalTokens: actualTotalTokens,
   	// ...
   };
   ```

2. Update `updateRequestSummary()` (Lines 343-365):
   - When aggregating, use `actualRequestTokens` and `actualTotalTokens` instead of raw values
   - Keep original fields for cache analytics

**Impact:** All AI calls will now have accurate paid token counts.

---

### Phase 3: Update Function Execution Logging

**File:** `src/services/performance/PerformanceTracker.ts`

**Location:** `logFunctionExecution()` (Lines 233-297)

**Changes:**

1. When inheriting from parent AI call, also inherit actual tokens:

   ```typescript
   const parentActualRequestTokens = parentAICall?.requestTokens
   	? parentAICall.requestTokens - (parentAICall.cachedTokens || 0)
   	: 0;
   const parentActualTotalTokens = parentAICall?.totalTokens
   	? parentAICall.totalTokens - (parentAICall.cachedTokens || 0)
   	: 0;

   const entry: FunctionLogEntry = {
   	// ... existing fields ...
   	requestTokens: parentAICall?.requestTokens || 0, // Keep original
   	totalTokens: parentAICall?.totalTokens || 0, // Keep original

   	// NEW: Actual paid tokens
   	actualRequestTokens: parentActualRequestTokens,
   	actualTotalTokens: parentActualTotalTokens,
   	// ...
   };
   ```

**Note:** Need to pass `cachedTokens` in `parentAICall` parameter.

**Impact:** Function calls will inherit accurate paid token counts from parent AI calls.

---

### Phase 4: Update OpenAIService to Pass Cached Tokens

**File:** `src/services/ai/OpenAIService.ts`

**Location:** Lines 200-240 (AI call info and logging)

**Changes:**

1. Include `cachedTokens` in `aiCallInfo`:

   ```typescript
   const aiCallInfo = {
   	model: request.model || DEFAULT_MODEL,
   	requestTokens: usage.prompt_tokens || 0,
   	responseTokens: usage.completion_tokens || 0,
   	totalTokens: usage.total_tokens || 0,
   	cachedTokens: cachedTokens, // ADD THIS
   };
   ```

2. Update `setLastAICall()` to include `cachedTokens`:
   - Modify `PerformanceRequestContext.setLastAICall()` to accept `cachedTokens`
   - Update `getLastAICall()` to return `cachedTokens`

**Impact:** Function calls can now access cached tokens from parent AI calls.

---

### Phase 5: Update PerformanceLogService Database Upload

**File:** `src/services/performance/PerformanceLogService.ts`

**Location:** `uploadSingleLog()` (Lines 145-167)

**Changes:**

1. Use `actualRequestTokens` and `actualTotalTokens` for database insertion:

   ```typescript
   const actualRequestTokens =
   	entry.actualRequestTokens ??
   	entry.requestTokens - (entry.cachedTokens || 0);
   const actualTotalTokens =
   	entry.actualTotalTokens ?? entry.totalTokens - (entry.cachedTokens || 0);

   await query(insertQuery, [
   	// ... other fields ...
   	actualRequestTokens, // Use actual instead of entry.requestTokens
   	entry.responseTokens, // Response tokens are never cached
   	actualTotalTokens, // Use actual instead of entry.totalTokens
   	// ... rest of fields ...
   ]);
   ```

2. **Database Schema Update:**
   - Add new columns: `actual_request_tokens`, `actual_total_tokens`
   - Keep existing columns for backward compatibility
   - Update insert query to use new columns

**Impact:** Database will store accurate paid token counts.

---

### Phase 6: Update Request Summary and Console Output

**File:** `src/services/performance/PerformanceTracker.ts`

**Location:** `endRequest()` (Lines 400-500)

**Changes:**

1. Use `actualTotalTokens` and `actualRequestTokens` in summary calculations:

   ```typescript
   const actualTotalTokens = summary.actualTotalTokens || 0;
   const actualRequestTokens = summary.actualRequestTokens || 0;

   logger.info(
   	`   📊 Total Tokens: ${actualTotalTokens.toLocaleString()} (Request: ${actualRequestTokens.toLocaleString()}, Response: ${summary.responseTokens.toLocaleString()})`
   );
   ```

2. Update cost calculation to use actual tokens:
   - Cost calculation already uses cached tokens correctly (separate pricing)
   - But token counts in console should show actual paid tokens

**Impact:** Console output will show accurate token counts.

---

### Phase 7: Update Database Schema

**File:** `scripts/create-performance-logs-table.sql`

**Changes:**

1. Add new columns for actual tokens:

   ```sql
   ALTER TABLE performance_logs
   ADD COLUMN IF NOT EXISTS actual_request_tokens INTEGER DEFAULT 0,
   ADD COLUMN IF NOT EXISTS actual_total_tokens INTEGER DEFAULT 0;
   ```

2. Add comments:

   ```sql
   COMMENT ON COLUMN performance_logs.request_tokens IS 'Total request tokens including cached (for analytics)';
   COMMENT ON COLUMN performance_logs.actual_request_tokens IS 'Actual paid request tokens (request_tokens - cached_tokens)';
   COMMENT ON COLUMN performance_logs.total_tokens IS 'Total tokens including cached (for analytics)';
   COMMENT ON COLUMN performance_logs.actual_total_tokens IS 'Actual paid total tokens (total_tokens - cached_tokens)';
   ```

3. Create migration script for existing data:
   ```sql
   -- Backfill actual tokens for existing records
   UPDATE performance_logs
   SET
     actual_request_tokens = request_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0),
     actual_total_tokens = total_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0)
   WHERE metadata->>'cachedTokens' IS NOT NULL;
   ```

**Impact:** Database schema supports both original and actual token counts.

---

### Phase 8: Update Other AI Call Types

**Files to Update:**

1. `src/services/ai/OpenAIService.ts`:

   - `analyzeImage()` (Lines 492-540): Extract cached tokens from vision API
   - `createEmbedding()`: Embeddings don't support caching, but ensure consistency
   - `transcribeAudio()`: Transcriptions don't support caching, but ensure consistency

2. `src/services/transcription.ts`:
   - Ensure transcription calls use same token calculation pattern

**Changes:**

- Apply same `actualTokens = totalTokens - cachedTokens` logic
- For APIs without caching, `actualTokens = totalTokens` (no change)

**Impact:** All AI call types will have consistent token reporting.

---

## Data Migration Strategy

### For Existing Data

1. **Backfill Script:**

   ```sql
   -- Calculate actual tokens from metadata
   UPDATE performance_logs
   SET
     actual_request_tokens = request_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0),
     actual_total_tokens = total_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0)
   WHERE metadata->>'cachedTokens' IS NOT NULL;

   -- For records without cached tokens, actual = total
   UPDATE performance_logs
   SET
     actual_request_tokens = request_tokens,
     actual_total_tokens = total_tokens
   WHERE actual_request_tokens IS NULL OR actual_request_tokens = 0;
   ```

2. **Validation Query:**
   ```sql
   -- Verify: actual_request_tokens should always be <= request_tokens
   SELECT COUNT(*) as invalid_records
   FROM performance_logs
   WHERE actual_request_tokens > request_tokens;
   -- Should return 0
   ```

---

## Testing Strategy

### Unit Tests

1. **Token Calculation Tests:**

   - Test `actualRequestTokens = requestTokens - cachedTokens`
   - Test `actualTotalTokens = totalTokens - cachedTokens`
   - Test edge cases: `cachedTokens = 0`, `cachedTokens = requestTokens`

2. **Database Insertion Tests:**
   - Verify `actual_request_tokens` and `actual_total_tokens` are stored correctly
   - Verify existing columns still work for backward compatibility

### Integration Tests

1. **End-to-End Flow:**

   - Send a message that triggers AI calls with caching
   - Verify database has correct `actual_request_tokens` and `actual_total_tokens`
   - Verify console output shows actual tokens

2. **Function Call Inheritance:**
   - Verify function calls inherit actual tokens from parent AI calls
   - Verify function calls show correct token counts in database

### Manual Testing

1. **Console Output Verification:**

   - Send a message and check console summary
   - Verify token counts match: `actualTotalTokens = totalTokens - cachedTokens`

2. **Database Verification:**
   - Query `performance_logs` table
   - Verify `actual_request_tokens <= request_tokens`
   - Verify `actual_total_tokens <= total_tokens`
   - Verify `actual_request_tokens = request_tokens - cached_tokens` (from metadata)

---

## Dashboard/Statistics Impact

### Updated Queries

**Old Query (Inflated):**

```sql
SELECT SUM(total_tokens) as total_tokens
FROM performance_logs
WHERE user_phone = '+972507564671';
-- Returns: 762,400 (includes cached)
```

**New Query (Accurate):**

```sql
SELECT SUM(actual_total_tokens) as total_tokens
FROM performance_logs
WHERE user_phone = '+972507564671';
-- Returns: ~510,000 (actual paid tokens)
```

### Statistics to Update

1. **User Statistics:**

   - Total Tokens: Use `actual_total_tokens`
   - Cost Calculation: Already correct (uses cached pricing)
   - Token Usage Trends: Use `actual_total_tokens`

2. **Agent Statistics:**

   - Tokens per Agent: Use `actual_total_tokens`
   - Average Tokens per Call: Use `actual_total_tokens`

3. **Model Statistics:**
   - Tokens per Model: Use `actual_total_tokens`
   - Cost per Model: Already correct (uses cached pricing)

---

## Backward Compatibility

### Strategy

1. **Keep Original Fields:**

   - `request_tokens`, `response_tokens`, `total_tokens` remain in database
   - `CallLogEntry` and `RequestSummary` keep original fields

2. **Add New Fields:**

   - `actual_request_tokens`, `actual_total_tokens` are new additions
   - Default to calculated value if not present

3. **Gradual Migration:**
   - Old code can still read `request_tokens` (for analytics)
   - New code should use `actual_request_tokens` (for cost reporting)
   - Dashboard can show both: "Total Tokens (including cached)" and "Paid Tokens"

---

## Implementation Order

1. ✅ **Phase 1**: Update Type Definitions
2. ✅ **Phase 2**: Update PerformanceTracker.logAICall()
3. ✅ **Phase 3**: Update Function Execution Logging
4. ✅ **Phase 4**: Update OpenAIService to Pass Cached Tokens
5. ✅ **Phase 5**: Update PerformanceLogService Database Upload
6. ✅ **Phase 6**: Update Request Summary and Console Output
7. ✅ **Phase 7**: Update Database Schema
8. ✅ **Phase 8**: Update Other AI Call Types

**Estimated Time:** 2-3 hours

---

## Success Criteria

✅ **Database:**

- `actual_request_tokens` and `actual_total_tokens` are stored correctly
- `actual_request_tokens = request_tokens - cached_tokens` (from metadata)
- All new records have actual token fields populated

✅ **Console Output:**

- Token counts show actual paid tokens
- Cache savings are still displayed separately

✅ **Statistics:**

- Dashboard shows accurate token usage (actual paid tokens)
- Cost calculations remain correct (already use cached pricing)

✅ **Backward Compatibility:**

- Existing queries still work (using original fields)
- New queries use actual fields for accurate reporting

---

## Notes

- **Cached tokens are still valuable for analytics:** Keep them in metadata to track cache hit rates
- **Response tokens are never cached:** No need to calculate `actualResponseTokens`
- **Cost calculation is already correct:** Uses separate pricing for cached vs non-cached tokens
- **This change only affects token counting:** Not cost calculation or caching logic
