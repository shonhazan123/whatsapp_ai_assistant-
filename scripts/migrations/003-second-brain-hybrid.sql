-- ============================================
-- Migration: Second Brain Hybrid Table (Phase 3)
-- ============================================
-- Creates the new second_brain_memories table with:
--   - 3 memory types: note | contact | kv
--   - pgvector cosine index for vector search
--   - tsvector full-text index for keyword search (BM25-like)
--   - JSONB metadata for structured fields
--
-- This is a FRESH START table. Old second_brain_memory is NOT migrated.

-- ============================================
-- Step 1: Enable required extensions
-- ============================================
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- Step 2: Create Hybrid Memory Table
-- ============================================
CREATE TABLE IF NOT EXISTS second_brain_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('note', 'contact', 'kv')),
    content TEXT NOT NULL,
    summary TEXT,
    tags TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    embedding VECTOR(1536)
);

COMMENT ON TABLE second_brain_memories IS 'Semantic long-term memory vault with hybrid retrieval (vector + full-text). Types: note, contact, kv.';

-- ============================================
-- Step 3: Add generated tsvector column for full-text search
-- ============================================
ALTER TABLE second_brain_memories
ADD COLUMN content_tsv tsvector
GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

-- ============================================
-- Step 4: Indexes
-- ============================================

-- GIN index on tsvector for fast full-text search
CREATE INDEX IF NOT EXISTS idx_sb_memories_tsv
ON second_brain_memories USING GIN (content_tsv);

-- IVFFlat cosine index on embedding for vector similarity search
CREATE INDEX IF NOT EXISTS idx_sb_memories_embedding
ON second_brain_memories
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- User ID index (privacy isolation)
CREATE INDEX IF NOT EXISTS idx_sb_memories_user_id
ON second_brain_memories(user_id);

-- Composite: user + type (for filtered queries)
CREATE INDEX IF NOT EXISTS idx_sb_memories_user_type
ON second_brain_memories(user_id, type);

-- Composite: user + created_at (for chronological listing)
CREATE INDEX IF NOT EXISTS idx_sb_memories_user_created
ON second_brain_memories(user_id, created_at DESC);

-- ============================================
-- Step 5: Row Level Security
-- ============================================
ALTER TABLE second_brain_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own second brain memories"
ON second_brain_memories
FOR ALL
USING (auth.uid() = user_id);

-- ============================================
-- Migration Complete
-- ============================================
-- Verify with:
--   SELECT table_name FROM information_schema.tables WHERE table_name = 'second_brain_memories';
--   SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'second_brain_memories';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'second_brain_memories';
