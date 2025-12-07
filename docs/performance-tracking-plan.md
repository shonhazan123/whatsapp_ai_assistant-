# Performance Tracking & Statistics System

## Overview

This document outlines the complete plan for implementing a comprehensive performance tracking and statistics system for the WhatsApp AI Assistant. The system will track token usage, execution times, agent performance, function performance, and provide detailed analytics for optimization and cost management.

## Goals

1. **Track Token Usage**: Monitor all OpenAI API token consumption per call
2. **Measure Execution Time**: Track duration of all operations (AI calls, functions, agents)
3. **Identify Expensive Operations**: Find which agents/functions/calls are most costly
4. **Track Call Hierarchy**: Understand the flow: Request → Agent → AI → Function → AI
5. **Calculate Costs**: Estimate costs based on token usage (if pricing data available)
6. **Generate Statistics**: Create aggregated performance reports and analytics
7. **Enable Dashboard Integration**: Provide APIs/data retrieval for future web dashboard

---

## Architecture

### Core Components

1. **PerformanceTracker Service** - Main tracking service
2. **RequestContext Manager** - Request ID and session management
3. **StatisticsAggregator** - Daily statistics calculation
4. **Data Retrieval API** - Interface for dashboard data access

### Data Flow

```
User Request (Webhook)
  ↓
RequestContext (Generate Request ID)
  ↓
Agent.processRequest()
  ↓
BaseAgent.executeWithAI() [Track Agent Start]
  ↓
OpenAIService.createCompletion() [Track AI Call]
  ↓
FunctionHandler.executeFunction() [Track Function]
  ↓
[More AI Calls if needed]
  ↓
PerformanceTracker.logRequest() [Track Request End]
  ↓
StatisticsAggregator.updateDailyStats()
```

---

## Data Model

### Individual Call Log Entry

```typescript
interface CallLogEntry {
  // Identification
  id: string;                    // Unique call ID
  timestamp: string;             // ISO timestamp
  requestId: string;             // Links all calls in one user request
  sessionId: string;             // Links all requests in one session
  
  // Hierarchy Tracking
  agent: string | null;           // "database" | "calendar" | "gmail" | "second-brain" | "main" | null
  functionName: string | null;   // "taskOperations" | "calendarOperations" | null
  callType: "completion" | "embedding" | "vision" | "transcription" | "function" | "agent";
  callSequence: number;          // Order within request
  
  // AI Call Details
  model: string | null;          // "gpt-4o" | "gpt-4o-mini" | "text-embedding-3-small" | null
  requestTokens: number;         // Input tokens
  responseTokens: number;        // Output tokens
  totalTokens: number;           // Total tokens
  
  // Timing
  startTime: string;            // ISO timestamp
  endTime: string;              // ISO timestamp
  durationMs: number;           // Execution duration in milliseconds
  
  // Request/Response Data
  messages: Array<{              // Truncated if too long
    role: string;
    content: string;
  }>;
  responseContent: string;       // Truncated response
  functionCall?: {               // If function was called
    name: string;
    arguments: any;
  };
  
  // Status
  success: boolean;
  error: string | null;
  
  // Metadata
  userPhone: string;
  metadata: {
    method: string;              // "createCompletion", "analyzeImage", etc.
    hasFunctionCall: boolean;
    retryAttempt: number;
    [key: string]: any;
  };
}
```

### Function Execution Entry

```typescript
interface FunctionLogEntry {
  id: string;
  timestamp: string;
  requestId: string;
  callType: "function";
  functionName: string;
  agent: string;
  operation: string;            // "create", "update", "delete", etc.
  startTime: string;
  endTime: string;
  durationMs: number;
  success: boolean;
  error: string | null;
  arguments: any;               // Truncated
  result: any;                  // Truncated
}
```

### Request Summary Entry

```typescript
interface RequestSummary {
  requestId: string;
  sessionId: string;
  userPhone: string;
  startTime: string;
  endTime: string;
  totalDurationMs: number;
  
  // Token Summary
  totalTokens: number;
  requestTokens: number;
  responseTokens: number;
  
  // Call Summary
  totalAICalls: number;
  totalFunctionCalls: number;
  agentsUsed: string[];
  functionsUsed: string[];
  
  // Status
  success: boolean;
  error: string | null;
  
  // Cost (if pricing available)
  estimatedCost: number;
}
```

### Daily Statistics

```typescript
interface DailyStatistics {
  date: string;                 // YYYY-MM-DD
  summary: {
    totalRequests: number;
    totalAICalls: number;
    totalFunctionCalls: number;
    totalTokens: number;
    totalDurationMs: number;
    averageTokensPerRequest: number;
    averageDurationPerRequest: number;
    estimatedTotalCost: number;
  };
  byAgent: {
    [agentName: string]: {
      calls: number;
      tokens: number;
      durationMs: number;
      averageTokens: number;
      averageDuration: number;
      successRate: number;
    };
  };
  byFunction: {
    [functionName: string]: {
      calls: number;
      durationMs: number;
      averageDuration: number;
      successRate: number;
      operations: {
        [operation: string]: number;  // Count per operation
      };
    };
  };
  byModel: {
    [modelName: string]: {
      calls: number;
      tokens: number;
      averageTokens: number;
      estimatedCost: number;
    };
  };
  topExpensiveCalls: Array<{
    id: string;
    agent: string;
    function: string | null;
    tokens: number;
    durationMs: number;
    timestamp: string;
  }>;
  slowCalls: Array<{
    id: string;
    durationMs: number;
    agent: string;
    function: string | null;
    reason: string;
    timestamp: string;
  }>;
  errorRate: {
    totalErrors: number;
    errorRate: number;          // Percentage
    errorsByAgent: {
      [agentName: string]: number;
    };
    errorsByFunction: {
      [functionName: string]: number;
    };
  };
}
```

---

## File Structure

```
src/
  services/
    performance/
      PerformanceTracker.ts      # Main tracking service
      RequestContext.ts           # Request ID management
      StatisticsAggregator.ts    # Daily stats calculation
      DataRetrievalService.ts     # API for dashboard data access
      types.ts                    # TypeScript interfaces
      config.ts                   # Configuration (pricing, thresholds)

logs/
  performance/
    calls-YYYY-MM-DD.json         # Individual call logs (daily rotation)
    stats-YYYY-MM-DD.json         # Daily aggregated statistics
    requests-YYYY-MM-DD.json      # Request summaries (optional)
```

---

## Implementation Phases

### Phase 1: Core Tracking Infrastructure

**Goal**: Basic token and timing tracking for AI calls

**Tasks**:
1. Create `PerformanceTracker` service with singleton pattern
2. Create `RequestContext` manager for request ID generation
3. Add request ID generation at webhook entry point
4. Modify `OpenAIService.createCompletion()` to:
   - Start timer before API call
   - Capture request metadata
   - Extract usage from response
   - Calculate duration
   - Call `PerformanceTracker.logAICall()`
5. Implement basic JSON file logging
6. Test with single AI call

**Files to Create**:
- `src/services/performance/PerformanceTracker.ts`
- `src/services/performance/RequestContext.ts`
- `src/services/performance/types.ts`

**Files to Modify**:
- `src/services/ai/OpenAIService.ts` (createCompletion method)
- `src/routes/webhook.ts` (add request context)

**Success Criteria**:
- AI calls are logged with tokens and timing
- Logs written to JSON file
- No breaking changes to existing functionality

---

### Phase 2: Agent and Function Tracking

**Goal**: Track agent and function execution with call hierarchy

**Tasks**:
1. Modify `BaseAgent.executeWithAI()` to:
   - Get current agent name (from class or context)
   - Start agent-level timer
   - Track agent execution start
   - Track agent execution end
   - Log agent execution summary
2. Modify `FunctionHandler.executeFunction()` to:
   - Start function timer
   - Log function execution start
   - Track function arguments (truncated)
   - Log function completion with duration
   - Track success/failure
3. Implement call hierarchy tracking (agent → AI → function → AI)
4. Add agent name detection mechanism
5. Test with full agent flow (agent → AI → function → AI)

**Files to Modify**:
- `src/core/base/BaseAgent.ts` (executeWithAI method)
- `src/core/base/FunctionHandler.ts` (executeFunction method)
- `src/services/performance/PerformanceTracker.ts` (add agent/function tracking)

**Success Criteria**:
- Agent executions are tracked
- Function executions are tracked
- Call hierarchy is maintained
- Can trace full request flow

---

### Phase 3: Additional Call Types

**Goal**: Track all types of AI calls (vision, embeddings, transcription, intent detection)

**Tasks**:
1. Track `OpenAIService.analyzeImage()` calls:
   - Mark as "vision" type
   - Track image processing time separately
   - Include image metadata (size, format)
2. Track `OpenAIService.createEmbedding()` calls:
   - Mark as "embedding" type
   - Note: embeddings API may not return usage in same format
3. Track `transcription.ts` calls:
   - Mark as "transcription" type
   - Track audio metadata (duration, format)
4. Track `OpenAIService.detectIntent()` calls:
   - Often hidden cost, important to track
   - Mark as "intent" type
5. Test all call types

**Files to Modify**:
- `src/services/ai/OpenAIService.ts` (analyzeImage, createEmbedding, detectIntent methods)
- `src/services/transcription.ts` (transcribeAudio method)

**Success Criteria**:
- All AI call types are tracked
- Token usage captured where available
- Timing captured for all calls

---

### Phase 4: Statistics and Reporting

**Goal**: Generate aggregated statistics and console output

**Tasks**:
1. Create `StatisticsAggregator` service:
   - Calculate daily statistics
   - Aggregate by agent, function, model
   - Identify top expensive calls
   - Identify slow calls
   - Calculate success rates
2. Implement daily statistics file generation
3. Add console output for request summaries:
   - Total tokens (request + response)
   - Total duration
   - Agents used
   - Functions used
   - Estimated cost
4. Add cost calculation (if pricing data available)
5. Implement slow call detection (threshold configurable)
6. Test statistics generation

**Files to Create**:
- `src/services/performance/StatisticsAggregator.ts`
- `src/services/performance/config.ts` (pricing, thresholds)

**Files to Modify**:
- `src/services/performance/PerformanceTracker.ts` (add statistics methods)

**Success Criteria**:
- Daily statistics generated correctly
- Console output shows request summaries
- Cost calculation works (if pricing configured)
- Slow calls identified

---

### Phase 5: Database Upload Service

**Goal**: Upload performance logs to Supabase database for external dashboard consumption

**Tasks**:
1. Create SQL migration for `performance_logs` table:
   - Each row represents one call/function within a session
   - All fields from JSON logs stored as columns
   - JSONB columns for complex data (messages, function_call, metadata)
   - Indexes for efficient queries
2. Create `PerformanceLogService`:
   - Aggregate all calls and functions for a requestId
   - Upload each call/function as a separate database row
   - Transform data to match database schema
   - Handle errors gracefully (don't break requests)
3. Modify `PerformanceTracker`:
   - Keep all calls and functions in memory during request
   - Provide methods to retrieve all data for a requestId
   - Clear in-memory data after successful upload
4. Integrate upload into webhook handler:
   - Upload logs after response is sent to user
   - Upload even on errors (if data was collected)
   - Non-blocking (errors don't fail the request)

**Files Created**:
- `scripts/create-performance-logs-table.sql` - Database migration
- `src/services/performance/PerformanceLogService.ts` - Upload service

**Files Modified**:
- `src/services/performance/PerformanceTracker.ts` - Added in-memory storage
- `src/routes/webhook.ts` - Integrated upload after response

**Success Criteria**:
- All session data uploaded to database after each request
- Each call/function becomes a separate row in database
- Database schema matches Zod schema from external application
- Upload failures don't break user requests
- Data is queryable by requestId, sessionId, userPhone, agent, etc.

---

### Phase 6: Optimization and Polish

**Goal**: Production-ready features and optimizations

**Tasks**:
1. Implement log rotation:
   - Keep last N days (configurable, default 30)
   - Archive old logs
   - Cleanup old files
2. Add performance thresholds and alerts:
   - Alert on calls > threshold (configurable)
   - Alert on token usage > threshold
   - Alert on high failure rates
3. Add configuration options:
   - Enable/disable tracking via env var
   - Configure log retention
   - Configure thresholds
   - Configure pricing (for cost calculation)
4. Optimize file I/O:
   - Async file writes
   - Batch writes if needed
   - Error handling
5. Add data truncation:
   - Truncate long messages/responses
   - Configurable max length
6. Add privacy features:
   - Mask sensitive data option
   - Configurable data sanitization
7. Performance testing:
   - Ensure minimal overhead
   - Test with high load
8. Documentation:
   - API documentation
   - Configuration guide
   - Usage examples

**Files to Modify**:
- `src/services/performance/PerformanceTracker.ts` (add rotation, optimization)
- `src/services/performance/config.ts` (add all configuration)
- Create `.env.example` entries

**Success Criteria**:
- Log rotation works
- Alerts function correctly
- Configuration is flexible
- Minimal performance overhead
- Well-documented

---

## Database Schema

### Performance Logs Table

The `performance_logs` table stores all performance data. Each row represents one call or function execution within a session.

**Table Structure**:
- `id` (UUID) - Primary key
- `timestamp` (TIMESTAMP) - When the call occurred
- `request_id` (TEXT) - Links all calls in one user request
- `session_id` (TEXT) - Links all requests in one session
- `user_phone` (TEXT) - User identifier
- `agent` (TEXT) - Agent name (null/unknown → 'Unknown')
- `function_name` (TEXT) - Function name if applicable
- `call_type` (TEXT) - Type of call (completion, embedding, vision, transcription, function, agent)
- `call_sequence` (INTEGER) - Order within request
- `model` (TEXT) - AI model used
- `request_tokens` (INTEGER) - Input tokens
- `response_tokens` (INTEGER) - Output tokens
- `total_tokens` (INTEGER) - Total tokens
- `start_time` (TIMESTAMP) - Call start time
- `end_time` (TIMESTAMP) - Call end time
- `duration_ms` (INTEGER) - Execution duration
- `messages` (JSONB) - Request messages (for completion calls)
- `response_content` (TEXT) - Response content
- `function_call` (JSONB) - Function call details
- `success` (BOOLEAN) - Success status
- `error` (TEXT) - Error message if failed
- `metadata` (JSONB) - Additional metadata
- `created_at` (TIMESTAMP) - Record creation time
- `updated_at` (TIMESTAMP) - Last update time

**Indexes**:
- `request_id` - Fast lookup by request
- `session_id` - Fast lookup by session
- `user_phone` - Fast lookup by user
- `timestamp` - Time-based queries
- `agent` - Agent-based queries
- `call_type` - Type-based queries
- `model` - Model-based queries

### Data Retrieval

The external dashboard application can query the database directly using standard SQL. Example queries:

```sql
-- Get all calls for a request
SELECT * FROM performance_logs WHERE request_id = '...';

-- Get all calls for a session
SELECT * FROM performance_logs WHERE session_id = '...' ORDER BY call_sequence;

-- Get calls by agent
SELECT * FROM performance_logs WHERE agent = 'calendar' AND timestamp > NOW() - INTERVAL '24 hours';

-- Get token usage by model
SELECT model, SUM(total_tokens) as total_tokens, COUNT(*) as calls
FROM performance_logs
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY model;
```

## Legacy: Data Retrieval API Interface (Deprecated)

**Note**: Phase 5 was changed to upload directly to database instead of creating an API service. The external dashboard queries the database directly.

The following interface was planned but not implemented:

```typescript
class DataRetrievalService {
  // Get call logs with filtering
  getCallLogs(options: {
    date?: string;                    // YYYY-MM-DD, defaults to today
    dateRange?: { start: string; end: string };
    agent?: string;
    functionName?: string;
    callType?: string;
    model?: string;
    minTokens?: number;
    maxDuration?: number;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<CallLogEntry[]>;

  // Get daily statistics
  getDailyStatistics(date: string): Promise<DailyStatistics | null>;

  // Get statistics for date range
  getStatisticsRange(options: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'week' | 'month';
  }): Promise<DailyStatistics[]>;

  // Get request trace
  getRequestSummary(requestId: string): Promise<RequestSummary | null>;

  // Get agent statistics
  getAgentStatistics(options: {
    agentName: string;
    dateRange?: { start: string; end: string };
  }): Promise<{
    totalCalls: number;
    totalTokens: number;
    averageTokens: number;
    totalDuration: number;
    averageDuration: number;
    successRate: number;
    calls: CallLogEntry[];
  }>;

  // Get function statistics
  getFunctionStatistics(options: {
    functionName: string;
    dateRange?: { start: string; end: string };
  }): Promise<{
    totalCalls: number;
    totalDuration: number;
    averageDuration: number;
    successRate: number;
    operations: { [operation: string]: number };
    calls: FunctionLogEntry[];
  }>;

  // Get model statistics
  getModelStatistics(options: {
    modelName: string;
    dateRange?: { start: string; end: string };
  }): Promise<{
    totalCalls: number;
    totalTokens: number;
    averageTokens: number;
    estimatedCost: number;
    calls: CallLogEntry[];
  }>;

  // Get top expensive calls
  getTopExpensiveCalls(options: {
    dateRange?: { start: string; end: string };
    limit?: number;
    sortBy?: 'tokens' | 'duration' | 'cost';
  }): Promise<CallLogEntry[]>;

  // Get slow calls
  getSlowCalls(options: {
    dateRange?: { start: string; end: string };
    threshold?: number;  // milliseconds
    limit?: number;
  }): Promise<CallLogEntry[]>;

  // Get error statistics
  getErrorRate(options: {
    dateRange?: { start: string; end: string };
    groupBy?: 'agent' | 'function' | 'model';
  }): Promise<{
    totalErrors: number;
    errorRate: number;
    errorsByGroup: { [key: string]: number };
  }>;

  // Get cost summary
  getCostSummary(options: {
    dateRange?: { start: string; end: string };
    groupBy?: 'day' | 'agent' | 'model';
  }): Promise<{
    totalCost: number;
    breakdown: { [key: string]: number };
  }>;

  // Get real-time statistics (last N minutes)
  getRealTimeStats(minutes: number): Promise<{
    requests: number;
    tokens: number;
    averageDuration: number;
    activeAgents: string[];
  }>;
}
```

### Optional REST API Endpoints

For future dashboard, we can add REST endpoints:

```
GET  /api/performance/calls?date=2025-01-15&agent=database
GET  /api/performance/stats?date=2025-01-15
GET  /api/performance/stats/range?start=2025-01-01&end=2025-01-15
GET  /api/performance/request/:requestId
GET  /api/performance/agent/:agentName?start=2025-01-01&end=2025-01-15
GET  /api/performance/function/:functionName?start=2025-01-01&end=2025-01-15
GET  /api/performance/model/:modelName?start=2025-01-01&end=2025-01-15
GET  /api/performance/expensive?limit=10&sortBy=tokens
GET  /api/performance/slow?threshold=5000&limit=10
GET  /api/performance/errors?start=2025-01-01&end=2025-01-15
GET  /api/performance/cost?start=2025-01-01&end=2025-01-15&groupBy=day
GET  /api/performance/realtime?minutes=5
```

---

## Console Output

### Per-Request Summary (End of Request)

```
💰 Request Performance Summary:
   📊 Total Tokens: 1,250 (Request: 800, Response: 450)
   ⏱️  Total Duration: 2.3s
   🤖 Agents: database (1 call, 500ms)
   🔧 Functions: taskOperations (1 call, 300ms)
   💵 Estimated Cost: $0.012
```

### Daily Summary (Optional, on Startup)

```
📈 Yesterday's Performance:
   Total Requests: 150
   Total Tokens: 125,000
   Total Cost: ~$1.25
   Most Expensive Agent: database (45k tokens)
   Slowest Function: calendarOperations (avg 800ms)
```

---

## Configuration

### Environment Variables

```env
# Performance Tracking
PERFORMANCE_TRACKING_ENABLED=true
PERFORMANCE_LOG_RETENTION_DAYS=30
PERFORMANCE_SLOW_CALL_THRESHOLD_MS=5000
PERFORMANCE_HIGH_TOKEN_THRESHOLD=2000
PERFORMANCE_ENABLE_COST_CALCULATION=true

# Model Pricing (for cost calculation)
OPENAI_GPT4O_PRICE_PER_1K_INPUT=0.005
OPENAI_GPT4O_PRICE_PER_1K_OUTPUT=0.015
OPENAI_GPT4O_MINI_PRICE_PER_1K_INPUT=0.00015
OPENAI_GPT4O_MINI_PRICE_PER_1K_OUTPUT=0.0006
OPENAI_EMBEDDING_PRICE_PER_1K=0.00002

# Logging
PERFORMANCE_LOG_LEVEL=info
PERFORMANCE_TRUNCATE_MESSAGES=true
PERFORMANCE_MAX_MESSAGE_LENGTH=1000
PERFORMANCE_MASK_SENSITIVE_DATA=false
```

### Configuration File

```typescript
// src/services/performance/config.ts
export const PerformanceConfig = {
  enabled: process.env.PERFORMANCE_TRACKING_ENABLED === 'true',
  logRetentionDays: parseInt(process.env.PERFORMANCE_LOG_RETENTION_DAYS || '30'),
  slowCallThresholdMs: parseInt(process.env.PERFORMANCE_SLOW_CALL_THRESHOLD_MS || '5000'),
  highTokenThreshold: parseInt(process.env.PERFORMANCE_HIGH_TOKEN_THRESHOLD || '2000'),
  enableCostCalculation: process.env.PERFORMANCE_ENABLE_COST_CALCULATION === 'true',
  
  modelPricing: {
    'gpt-4o': {
      input: parseFloat(process.env.OPENAI_GPT4O_PRICE_PER_1K_INPUT || '0.005'),
      output: parseFloat(process.env.OPENAI_GPT4O_PRICE_PER_1K_OUTPUT || '0.015'),
    },
    'gpt-4o-mini': {
      input: parseFloat(process.env.OPENAI_GPT4O_MINI_PRICE_PER_1K_INPUT || '0.00015'),
      output: parseFloat(process.env.OPENAI_GPT4O_MINI_PRICE_PER_1K_OUTPUT || '0.0006'),
    },
    'text-embedding-3-small': {
      input: parseFloat(process.env.OPENAI_EMBEDDING_PRICE_PER_1K || '0.00002'),
      output: 0,
    },
  },
  
  truncateMessages: process.env.PERFORMANCE_TRUNCATE_MESSAGES !== 'false',
  maxMessageLength: parseInt(process.env.PERFORMANCE_MAX_MESSAGE_LENGTH || '1000'),
  maskSensitiveData: process.env.PERFORMANCE_MASK_SENSITIVE_DATA === 'true',
};
```

---

## Additional Features & Suggestions

### 1. Cost Calculation
- Add model pricing configuration
- Calculate estimated cost per call
- Track daily/weekly costs
- Alert on high-cost operations
- Cost breakdown by agent/function/model

### 2. Performance Alerts
- Alert on calls > threshold (configurable)
- Alert on token usage > threshold
- Alert on high failure rates
- Alert on cost spikes
- Configurable alert channels (console, webhook, email)

### 3. Request Tracing
- Visualize call flow: Request → Agent → AI → Function → AI
- Identify bottlenecks
- Find redundant calls
- Optimize call patterns

### 4. Agent Comparison
- Compare token usage across agents
- Compare execution time
- Identify optimization opportunities
- A/B testing support

### 5. Function Performance
- Track which operations are slow
- Identify functions with high token usage
- Optimize expensive functions
- Function-level cost analysis

### 6. Model Comparison
- Track which models are used most
- Compare costs per model
- Optimize model selection
- Model performance metrics

### 7. User-Level Statistics (Optional)
- Track per-user usage
- Identify power users
- Cost allocation
- Usage patterns

### 8. Dashboard Features (Future)
- Real-time monitoring
- Interactive charts and graphs
- Export capabilities (CSV, JSON)
- Custom date range selection
- Filtering and search
- Alerts and notifications
- Cost projections

---

## Benefits

1. **Full Visibility**: Complete insight into token usage and costs
2. **Performance Insights**: Identify slow operations and bottlenecks
3. **Cost Management**: Track and optimize costs
4. **Agent Optimization**: Compare and optimize agent performance
5. **Function Optimization**: Identify and optimize expensive functions
6. **Debugging Support**: Full call traces for debugging
7. **Data-Driven Decisions**: Make informed optimization decisions
8. **Dashboard Ready**: Data available for web dashboard

---

## Considerations

1. **Performance Overhead**: Minimal (async logging, non-blocking)
2. **Log File Size**: Implement rotation and truncation
3. **Privacy**: Option to mask sensitive data in logs
4. **Error Handling**: Logging failures shouldn't break requests
5. **Configuration**: Enable/disable via env vars
6. **Scalability**: Consider database storage for high-volume (future)
7. **Data Retention**: Configurable retention policy
8. **Security**: Secure API endpoints if exposed (future)

---

## Testing Strategy

1. **Unit Tests**: Test each component individually
2. **Integration Tests**: Test full request flow
3. **Performance Tests**: Ensure minimal overhead
4. **Load Tests**: Test with high volume
5. **Error Handling Tests**: Test error scenarios
6. **Data Accuracy Tests**: Verify token counts and timing

---

## Migration Path

1. **Phase 1-3**: Core tracking (non-breaking)
2. **Phase 4**: Statistics (additive)
3. **Phase 5**: Dashboard API (additive)
4. **Phase 6**: Polish and optimization

Each phase can be deployed independently without breaking existing functionality.

---

## Future Enhancements

1. **Database Storage**: Move from file-based to database for scalability
2. **Real-time Streaming**: WebSocket support for real-time dashboard updates
3. **Machine Learning**: Predict costs and optimize automatically
4. **Advanced Analytics**: Trend analysis, anomaly detection
5. **Multi-tenant Support**: Per-tenant statistics and cost allocation
6. **API Rate Limiting**: Track and limit based on cost/tokens
7. **Automated Optimization**: Suggest and apply optimizations

---

## Documentation Requirements

1. **API Documentation**: Complete API reference for DataRetrievalService
2. **Configuration Guide**: How to configure all options
3. **Usage Examples**: Code examples for common use cases
4. **Dashboard Integration Guide**: How to integrate with dashboard
5. **Troubleshooting Guide**: Common issues and solutions

---

## Success Metrics

- All AI calls tracked with tokens and timing
- Agent and function execution tracked
- Daily statistics generated correctly
- Console output shows useful summaries
- Dashboard can retrieve all necessary data
- Minimal performance overhead (< 5ms per call)
- No breaking changes to existing functionality
- Well-documented and maintainable code

---

## Notes

- This system is designed to be non-intrusive and optional
- All tracking can be disabled via configuration
- Data is stored in JSON files for simplicity (can migrate to DB later)
- Dashboard integration is designed to be flexible and extensible
- Cost calculation is optional and requires pricing configuration
- The system is designed to scale from file-based to database-based storage

---

**Last Updated**: 2025-01-15
**Status**: Planning Phase
**Next Step**: Begin Phase 1 Implementation

