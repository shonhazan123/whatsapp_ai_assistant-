-- ============================================
-- Performance Logs Table for Supabase
-- ============================================
-- This script creates the performance_logs table
-- Each row represents one complete session (user request -> response)
-- All calls for that session are stored as JSONB

CREATE TABLE IF NOT EXISTS performance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Core identification
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    request_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT 'unknown',
    user_phone TEXT,
    
    -- Agent and function tracking
    agent TEXT,
    function_name TEXT,
    call_type TEXT NOT NULL,
    call_sequence INTEGER DEFAULT 1,
    
    -- Model and token information
    model TEXT DEFAULT 'unknown',
    request_tokens INTEGER DEFAULT 0,
    response_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    
    -- Timing information
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_ms INTEGER NOT NULL,
    
    -- Request/Response data (stored as JSONB)
    messages JSONB,
    response_content TEXT,
    function_call JSONB,
    
    -- Status
    success BOOLEAN NOT NULL,
    error TEXT,
    
    -- Metadata (stored as JSONB)
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_performance_logs_request_id ON performance_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_performance_logs_session_id ON performance_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_performance_logs_user_phone ON performance_logs(user_phone);
CREATE INDEX IF NOT EXISTS idx_performance_logs_timestamp ON performance_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_performance_logs_agent ON performance_logs(agent);
CREATE INDEX IF NOT EXISTS idx_performance_logs_call_type ON performance_logs(call_type);
CREATE INDEX IF NOT EXISTS idx_performance_logs_model ON performance_logs(model);

-- Create a function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_performance_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_performance_logs_updated_at
    BEFORE UPDATE ON performance_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_performance_logs_updated_at();

-- Add comment to table
COMMENT ON TABLE performance_logs IS 'Stores performance tracking data for each AI call/session. Each row represents one call within a session.';


