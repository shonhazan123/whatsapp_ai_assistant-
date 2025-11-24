import { query } from '../../config/database';
import { IResponse } from '../../core/types/AgentTypes';

export class DuplicateEntryError extends Error {
  constructor(
    public readonly constraint?: string,
    public readonly detail?: string
  ) {
    super('Duplicate entry');
    this.name = 'DuplicateEntryError';
  }
}

export class InvalidIdentifierError extends Error {
  constructor(public readonly detail?: string) {
    super('Invalid identifier');
    this.name = 'InvalidIdentifierError';
  }
}

export abstract class BaseService {
  constructor(protected logger: any = logger) {}

  protected async executeQuery<T = any>( sql: string, params: any[] = [] ): Promise<T[]> {
    try {
      const result = await query(sql, params);
      return result.rows;
    } catch (error: any) {
      if (error?.code === '23505') {
        this.logger.warn?.('Duplicate key violation', { constraint: error.constraint, detail: error.detail });
        throw new DuplicateEntryError(error.constraint, error.detail);
      }
      if (error?.code === '22P02') {
        this.logger.warn?.('Invalid identifier supplied to query', { detail: error.detail });
        throw new InvalidIdentifierError(error.detail);
      }
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

  protected async resolveUserId(userId: string | undefined, userPhone: string): Promise<string> {
    if (userId) {
      return userId;
    }
    if (!userPhone) {
      throw new Error('User identifier is required');
    }
    return this.ensureUserExists(userPhone);
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
