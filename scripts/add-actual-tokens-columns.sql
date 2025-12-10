-- ============================================
-- Add Actual Token Columns to performance_logs
-- ============================================
-- This migration adds columns for actual paid tokens (excluding cached tokens)
-- Run this after the initial table creation

-- Add new columns for actual paid tokens
ALTER TABLE performance_logs 
ADD COLUMN IF NOT EXISTS actual_request_tokens INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS actual_total_tokens INTEGER DEFAULT 0;

-- Add comments to explain the difference
COMMENT ON COLUMN performance_logs.request_tokens IS 'Total request tokens including cached (for analytics)';
COMMENT ON COLUMN performance_logs.actual_request_tokens IS 'Actual paid request tokens (request_tokens - cached_tokens)';
COMMENT ON COLUMN performance_logs.total_tokens IS 'Total tokens including cached (for analytics)';
COMMENT ON COLUMN performance_logs.actual_total_tokens IS 'Actual paid total tokens (total_tokens - cached_tokens)';

-- Backfill actual tokens for existing records from metadata
-- This calculates actual tokens from cached_tokens stored in metadata
UPDATE performance_logs
SET 
  actual_request_tokens = request_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0),
  actual_total_tokens = total_tokens - COALESCE((metadata->>'cachedTokens')::integer, 0)
WHERE metadata->>'cachedTokens' IS NOT NULL
  AND (actual_request_tokens = 0 OR actual_request_tokens IS NULL);

-- For records without cached tokens, actual = total
UPDATE performance_logs
SET 
  actual_request_tokens = request_tokens,
  actual_total_tokens = total_tokens
WHERE (actual_request_tokens = 0 OR actual_request_tokens IS NULL)
  AND (metadata->>'cachedTokens' IS NULL OR (metadata->>'cachedTokens')::integer = 0);

-- Create index on actual_total_tokens for efficient queries
CREATE INDEX IF NOT EXISTS idx_performance_logs_actual_total_tokens ON performance_logs(actual_total_tokens);

-- Validation: Ensure actual_request_tokens <= request_tokens
-- This query should return 0 rows (no invalid records)
-- SELECT COUNT(*) as invalid_records
-- FROM performance_logs
-- WHERE actual_request_tokens > request_tokens;

