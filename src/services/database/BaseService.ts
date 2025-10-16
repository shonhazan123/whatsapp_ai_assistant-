import { query } from '../../config/database';
import { logger } from '../../utils/logger';
import { IResponse, CreateRequest, UpdateRequest, DeleteRequest, GetRequest, BulkRequest } from '../../core/types/AgentTypes';

export abstract class BaseService {
  constructor(protected logger: any = logger) {}

  protected async executeQuery<T = any>( sql: string, params: any[] = [] ): Promise<T[]> {
    try {
      const result = await query(sql, params);
      return result.rows;
    } catch (error) {
      this.logger.error(`Database query error: ${sql}`, error);
      throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  protected async executeSingleQuery<T = any>( sql: string, params: any[] = [] ): Promise<T | null> {
    const results = await this.executeQuery<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  protected async ensureUserExists(userPhone: string): Promise<string> {
    const result = await this.executeSingleQuery<{ user_id: string }>(
      'SELECT get_or_create_user($1) as user_id',
      [userPhone]
    );
    return result?.user_id || '';
  }

  protected createSuccessResponse(data?: any, message?: string): IResponse {
    return {
      success: true,
      data,
      message
    };
  }

  protected createErrorResponse(error: string): IResponse {
    return {
      success: false,
      error
    };
  }

  protected validateRequiredFields(data: any, requiredFields: string[]): string | null {
    for (const field of requiredFields) {
      if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
        return `Missing required field: ${field}`;
      }
    }
    return null;
  }

  protected sanitizeInput(input: any): any {
    if (typeof input === 'string') {
      return input.trim();
    }
    if (typeof input === 'object' && input !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = this.sanitizeInput(value);
      }
      return sanitized;
    }
    return input;
  }
}
