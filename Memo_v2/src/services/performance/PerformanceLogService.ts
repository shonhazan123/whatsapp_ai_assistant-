/**
 * Performance Log Service
 * Uploads session performance data to Supabase database
 */

import { query } from '../../legacy/config/database';
import { logger } from '../../legacy/utils/logger';
import { CallLogEntry, FunctionLogEntry } from '../../legacy/services/performance/types';

export class PerformanceLogService {
  private static instance: PerformanceLogService;

  private constructor() {}

  static getInstance(): PerformanceLogService {
    if (!PerformanceLogService.instance) {
      PerformanceLogService.instance = new PerformanceLogService();
    }
    return PerformanceLogService.instance;
  }

  /**
   * Upload all calls for a session to the database
   * Each call becomes a separate row in the database
   */
  async uploadSessionLogs(
    calls: CallLogEntry[],
    functions: FunctionLogEntry[]
  ): Promise<void> {
    if (calls.length === 0 && functions.length === 0) {
      logger.debug('No logs to upload for session');
      return;
    }

    try {
      // Combine calls and functions into a single array
      const allEntries: Array<CallLogEntry | FunctionLogEntry> = [
        ...calls,
        ...functions,
      ];

      // Sort by callSequence to maintain order
      allEntries.sort((a, b) => (a.callSequence || 0) - (b.callSequence || 0));

      // Upload each entry as a separate row
      for (const entry of allEntries) {
        await this.uploadSingleLog(entry);
      }

      logger.info(
        `✅ Uploaded ${allEntries.length} log entries to database (${calls.length} calls, ${functions.length} functions)`
      );
    } catch (error) {
      logger.error('Error uploading session logs to database:', error);
      // Don't throw - logging failures shouldn't break the app
    }
  }

  /**
   * Upload a single log entry to the database
   */
  private async uploadSingleLog(
    entry: CallLogEntry | FunctionLogEntry
  ): Promise<void> {
    try {
      // Transform agent name: null/unknown -> 'Unknown'
      let agentName = entry.agent;
      if (!agentName || agentName === 'unknown') {
        agentName = 'Unknown';
      }

      // Prepare messages as JSONB (only for CallLogEntry)
      let messagesJson: any = null;
      if ('messages' in entry && entry.messages) {
        messagesJson = JSON.stringify(entry.messages);
      }

      // Prepare function_call as JSONB
      let functionCallJson: any = null;
      if ('functionCall' in entry && entry.functionCall) {
        functionCallJson = JSON.stringify(entry.functionCall);
      } else if ('arguments' in entry && entry.arguments) {
        // For FunctionLogEntry, use arguments as function_call
        functionCallJson = JSON.stringify({ arguments: entry.arguments });
      }

      // Prepare metadata as JSONB
      const metadataJson =
        'metadata' in entry && entry.metadata
          ? JSON.stringify(entry.metadata)
          : '{}';

      // Prepare response_content
      let responseContent: string | null = null;
      if ('responseContent' in entry && entry.responseContent) {
        responseContent = entry.responseContent;
      } else if ('result' in entry && entry.result) {
        // For FunctionLogEntry, use result as response_content
        responseContent =
          typeof entry.result === 'string'
            ? entry.result
            : JSON.stringify(entry.result);
      }

      // Get function_name
      // For CallLogEntry: check functionCall.name first, then functionName
      // For FunctionLogEntry: use functionName directly
      let functionName: string | null = null;
      if ('functionCall' in entry && entry.functionCall && typeof entry.functionCall === 'object' && 'name' in entry.functionCall) {
        // CallLogEntry with function call - extract name from functionCall
        functionName = entry.functionCall.name as string;
      } else if ('functionName' in entry) {
        // Use functionName field (works for both CallLogEntry and FunctionLogEntry)
        functionName = entry.functionName || null;
      }

      // Calculate actual paid tokens (excluding cached tokens)
      const cachedTokens = ('cachedTokens' in entry && entry.cachedTokens) 
        ? entry.cachedTokens 
        : (metadataJson && JSON.parse(metadataJson).cachedTokens) || 0;
      
      const actualRequestTokens = ('actualRequestTokens' in entry && entry.actualRequestTokens !== undefined)
        ? entry.actualRequestTokens
        : (entry.requestTokens || 0) - cachedTokens;
      
      const actualTotalTokens = ('actualTotalTokens' in entry && entry.actualTotalTokens !== undefined)
        ? entry.actualTotalTokens
        : (entry.totalTokens || 0) - cachedTokens;

      const insertQuery = `
        INSERT INTO performance_logs (
          timestamp,
          request_id,
          session_id,
          user_phone,
          agent,
          function_name,
          call_type,
          call_sequence,
          model,
          request_tokens,
          response_tokens,
          total_tokens,
          actual_request_tokens,
          actual_total_tokens,
          start_time,
          end_time,
          duration_ms,
          messages,
          response_content,
          function_call,
          success,
          error,
          metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
        )
      `;

      await query(insertQuery, [
        entry.timestamp,
        entry.requestId,
        entry.sessionId || 'unknown',
        entry.userPhone || null,
        agentName,
        functionName,
        entry.callType,
        entry.callSequence || 1,
        entry.model || 'unknown',
        entry.requestTokens || 0,  // Keep original for analytics
        entry.responseTokens || 0,
        entry.totalTokens || 0,     // Keep original for analytics
        actualRequestTokens,        // Actual paid tokens
        actualTotalTokens,           // Actual paid tokens
        entry.startTime,
        entry.endTime,
        entry.durationMs,
        messagesJson,
        responseContent,
        functionCallJson,
        entry.success,
        entry.error || null,
        metadataJson,
      ]);
    } catch (error: any) {
      logger.error('Error uploading single log entry:', {
        error: error.message,
        requestId: entry.requestId,
        callType: entry.callType,
      });
      // Don't throw - continue with other entries
    }
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Performance log service database connection test failed:', error);
      return false;
    }
  }
}

