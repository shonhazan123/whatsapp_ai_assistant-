-- ============================================
-- Migration: Add Second Brain Memory Table (Phase 2)
-- ============================================
-- Run this script in Supabase SQL Editor
-- This creates the second_brain_memory table with pgvector support
-- for storing and searching unstructured user memories

-- ============================================
-- Step 1: Enable pgvector extension
-- ============================================
-- pgvector is required for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify extension is enabled
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        RAISE EXCEPTION 'pgvector extension could not be enabled. Please check Supabase configuration.';
    END IF;
END $$;

-- ============================================
-- Step 2: Create Second Brain Memory Table
-- ============================================
CREATE TABLE IF NOT EXISTS second_brain_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comment to table
COMMENT ON TABLE second_brain_memory IS 'Stores unstructured user memories with vector embeddings for semantic search';

-- Add comments to columns
COMMENT ON COLUMN second_brain_memory.id IS 'Unique identifier for the memory';
COMMENT ON COLUMN second_brain_memory.user_id IS 'Foreign key to users table - ensures per-user isolation';
COMMENT ON COLUMN second_brain_memory.text IS 'The actual memory text content';
COMMENT ON COLUMN second_brain_memory.embedding IS 'Vector embedding (1536 dimensions) for semantic search using OpenAI embeddings';
COMMENT ON COLUMN second_brain_memory.metadata IS 'Optional JSON metadata (tags, category, language, etc.)';
COMMENT ON COLUMN second_brain_memory.created_at IS 'Timestamp when memory was created';
COMMENT ON COLUMN second_brain_memory.updated_at IS 'Timestamp when memory was last updated';

-- ============================================
-- Step 3: Create Indexes for Performance
-- ============================================

-- HNSW index for fast approximate vector similarity search
-- This index uses cosine distance for semantic search
CREATE INDEX IF NOT EXISTS second_brain_memory_embedding_idx 
ON second_brain_memory 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- User ID index for filtering (critical for privacy isolation)
CREATE INDEX IF NOT EXISTS second_brain_memory_user_id_idx 
ON second_brain_memory(user_id);

-- Composite index for user + time queries (useful for getAllMemory with date filtering)
CREATE INDEX IF NOT EXISTS second_brain_memory_user_created_idx 
ON second_brain_memory(user_id, created_at DESC);

-- ============================================
-- Step 4: Row Level Security (RLS) - Optional
-- ============================================
-- Enable RLS for additional security layer
-- Note: If using service role (not Supabase Auth), RLS may not apply.
-- In that case, ensure all queries filter by user_id in application code.

ALTER TABLE second_brain_memory ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own memories
-- This policy uses Supabase Auth. If not using Supabase Auth,
-- the application code must enforce user_id filtering.
CREATE POLICY "Users can only access their own memories"
ON second_brain_memory
FOR ALL
USING (auth.uid() = user_id);

-- ============================================
-- Step 5: Create Trigger for updated_at
-- ============================================
-- Automatically update updated_at timestamp on row update
CREATE OR REPLACE FUNCTION update_second_brain_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER second_brain_memory_updated_at_trigger
    BEFORE UPDATE ON second_brain_memory
    FOR EACH ROW
    EXECUTE FUNCTION update_second_brain_memory_updated_at();

-- ============================================
-- Step 6: Verification Queries
-- ============================================
-- Run these queries to verify the migration was successful

-- Check if table exists
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'second_brain_memory';

-- Check table structure
-- SELECT 
--     column_name, 
--     data_type,
--     is_nullable
-- FROM information_schema.columns 
-- WHERE table_name = 'second_brain_memory'
-- ORDER BY ordinal_position;

-- Check indexes
-- SELECT 
--     indexname,
--     indexdef
-- FROM pg_indexes 
-- WHERE tablename = 'second_brain_memory';

-- Check if pgvector extension is enabled
-- SELECT * FROM pg_extension WHERE extname = 'vector';

-- ============================================
-- Migration Complete
-- ============================================
-- The second_brain_memory table is now ready for use.
-- Next steps:
-- 1. Test basic insert with sample data
-- 2. Verify vector similarity search works
-- 3. Test user isolation (user_id filtering)

