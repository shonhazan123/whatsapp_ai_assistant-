import { CreateMultipleRequest, CreateRequest, DeleteRequest, GetRequest, IResponse, UpdateRequest } from '../../core/types/AgentTypes';
import { BulkPatch, ContactFilter } from '../../core/types/Filters';
import { SQLCompiler } from '../../utils/SQLCompiler';
import { logger } from '../../utils/logger';
import { BaseService } from './BaseService';

export interface Contact {
  id: string;
  user_id: string;
  name: string;
  phone_number?: string;
  email?: string;
  address?: string;
  created_at: string;
}

export interface CreateContactRequest {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface UpdateContactRequest {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface ContactFilters {
  name?: string;
  phone?: string;
  email?: string;
}

export class ContactService extends BaseService {
  constructor(loggerInstance: any = logger) {
    super(loggerInstance);
  }

  async create(request: CreateRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['name']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const result = await this.executeSingleQuery<Contact>(
        `INSERT INTO contact_list (user_id, name, phone_number, email, address) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, user_id, name, phone_number, email, address, created_at`,
        [userId, data.name, data.phone || null, data.email || null, data.address || null]
      );

      this.logger.info(`✅ Contact created: "${data.name}" for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Contact created successfully');
    } catch (error) {
      this.logger.error('Error creating contact:', error);
      return this.createErrorResponse('Failed to create contact');
    }
  }

  async createMultiple(request: CreateMultipleRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      const results = [];
      const errors = [];

      for (const item of request.items) {
        try {
          const sanitizedItem = this.sanitizeInput(item);
          const validation = this.validateRequiredFields(sanitizedItem, ['name']);
          
          if (validation) {
            errors.push({ item, error: validation });
            continue;
          }

          const result = await this.executeSingleQuery<Contact>(
            `INSERT INTO contact_list (user_id, name, phone_number, email, address) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING id, user_id, name, phone_number, email, address, created_at`,
            [userId, sanitizedItem.name, sanitizedItem.phone || null, sanitizedItem.email || null, sanitizedItem.address || null]
          );

          results.push(result);
        } catch (error) {
          errors.push({ item, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      this.logger.info(`✅ Created ${results.length} contacts for user: ${userId}`);
      
      return this.createSuccessResponse({
        created: results,
        errors: errors.length > 0 ? errors : undefined,
        count: results.length
      }, `Created ${results.length} contacts`);
    } catch (error) {
      this.logger.error('Error creating multiple contacts:', error);
      return this.createErrorResponse('Failed to create contacts');
    }
  }

  async getById(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      
      const contact = await this.executeSingleQuery<Contact>(
        `SELECT id, user_id, name, phone_number, email, address, created_at
         FROM contact_list 
         WHERE user_id = $1 AND id = $2`,
        [userId, request.id]
      );

      if (!contact) {
        return this.createErrorResponse('Contact not found');
      }

      return this.createSuccessResponse(contact);
    } catch (error) {
      this.logger.error('Error getting contact by ID:', error);
      return this.createErrorResponse('Failed to get contact');
    }
  }

  async getAll(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      
      let query = `
        SELECT id, user_id, name, phone_number, email, address, created_at
        FROM contact_list
        WHERE user_id = $1
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Apply filters
      if (request.filters) {
        if (request.filters.name) {
          paramCount++;
          query += ` AND name ILIKE $${paramCount}`;
          params.push(`%${request.filters.name}%`);
        }

        if (request.filters.phone) {
          paramCount++;
          query += ` AND phone_number ILIKE $${paramCount}`;
          params.push(`%${request.filters.phone}%`);
        }

        if (request.filters.email) {
          paramCount++;
          query += ` AND email ILIKE $${paramCount}`;
          params.push(`%${request.filters.email}%`);
        }
      }

      query += ` ORDER BY created_at DESC`;

      if (request.limit) {
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(request.limit);
      }

      if (request.offset) {
        paramCount++;
        query += ` OFFSET $${paramCount}`;
        params.push(request.offset);
      }

      const contacts = await this.executeQuery<Contact>(query, params);

      this.logger.info(`📋 ContactService.getAll() - Query: ${query}`);
      this.logger.info(`📋 ContactService.getAll() - Params:`, params);
      this.logger.info(`📋 ContactService.getAll() - Found ${contacts.length} contacts:`, contacts);

      return this.createSuccessResponse({
        contacts,
        count: contacts.length
      });
    } catch (error) {
      this.logger.error('Error getting contacts:', error);
      return this.createErrorResponse('Failed to get contacts');
    }
  }

  async update(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      const data = this.sanitizeInput(request.data);

      const updateFields = [];
      const params: any[] = [userId, request.id];
      let paramCount = 2;

      if (data.name !== undefined) {
        paramCount++;
        updateFields.push(`name = $${paramCount}`);
        params.push(data.name);
      }

      if (data.phone !== undefined) {
        paramCount++;
        updateFields.push(`phone_number = $${paramCount}`);
        params.push(data.phone);
      }

      if (data.email !== undefined) {
        paramCount++;
        updateFields.push(`email = $${paramCount}`);
        params.push(data.email);
      }

      if (data.address !== undefined) {
        paramCount++;
        updateFields.push(`address = $${paramCount}`);
        params.push(data.address);
      }

      if (updateFields.length === 0) {
        return this.createErrorResponse('No fields to update');
      }

      const result = await this.executeSingleQuery<Contact>(
        `UPDATE contact_list 
         SET ${updateFields.join(', ')}
         WHERE user_id = $1 AND id = $2
         RETURNING id, user_id, name, phone_number, email, address, created_at`,
        params
      );

      if (!result) {
        return this.createErrorResponse('Contact not found');
      }

      this.logger.info(`✅ Contact updated: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Contact updated successfully');
    } catch (error) {
      this.logger.error('Error updating contact:', error);
      return this.createErrorResponse('Failed to update contact');
    }
  }

  async delete(request: DeleteRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);

      const result = await this.executeSingleQuery<Contact>(
        `DELETE FROM contact_list 
         WHERE user_id = $1 AND id = $2
         RETURNING id, name`,
        [userId, request.id]
      );

      if (!result) {
        return this.createErrorResponse('Contact not found');
      }

      this.logger.info(`✅ Contact deleted: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Contact deleted successfully');
    } catch (error) {
      this.logger.error('Error deleting contact:', error);
      return this.createErrorResponse('Failed to delete contact');
    }
  }

  async search(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.resolveUserId(request.userId, request.userPhone);
      
      if (!request.filters?.name && !request.filters?.phone && !request.filters?.email) {
        return this.createErrorResponse('Search query is required');
      }

      let query = `
        SELECT id, user_id, name, phone_number, email, address, created_at
        FROM contact_list 
        WHERE user_id = $1 AND (
      `;

      const params: any[] = [userId];
      let paramCount = 1;
      const conditions = [];

      if (request.filters?.name) {
        paramCount++;
        conditions.push(`name ILIKE $${paramCount}`);
        params.push(`%${request.filters.name}%`);
      }

      if (request.filters?.phone) {
        paramCount++;
        conditions.push(`phone_number ILIKE $${paramCount}`);
        params.push(`%${request.filters.phone}%`);
      }

      if (request.filters?.email) {
        paramCount++;
        conditions.push(`email ILIKE $${paramCount}`);
        params.push(`%${request.filters.email}%`);
      }

      query += conditions.join(' OR ') + ') ORDER BY created_at DESC';

      if (request.limit) {
        paramCount++;
        query += ` LIMIT $${paramCount}`;
        params.push(request.limit);
      }

      const contacts = await this.executeQuery<Contact>(query, params);

      return this.createSuccessResponse({
        contacts,
        count: contacts.length
      });
    } catch (error) {
      this.logger.error('Error searching contacts:', error);
      return this.createErrorResponse('Failed to search contacts');
    }
  }

  // Bulk operations
  async deleteAll(userPhone: string, filter: ContactFilter, preview = false): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(userPhone);

      // Compile WHERE clause using SQLCompiler
      const { whereSql, params } = SQLCompiler.compileWhere('contacts', userId, filter);

      // Safety check: refuse empty where unless preview
      if (!whereSql.trim() && !preview) {
        return this.createErrorResponse(
          'Bulk delete requires filter conditions. Set preview=true to review affected rows.'
        );
      }

      let query: string;
      
      if (preview) {
        query = `SELECT c.id, c.name, c.phone_number, c.email, c.address, c.created_at 
                 FROM contact_list c 
                 WHERE ${whereSql}`;
      } else {
        query = `DELETE FROM contact_list c 
                 WHERE ${whereSql}
                 RETURNING c.id, c.name, c.phone_number, c.email, c.address, c.created_at`;
      }

      const results = await this.executeQuery<Contact>(query, params);

      this.logger.info(`✅ ${preview ? 'Preview' : 'Deleted'} ${results.length} contacts for user: ${userId}`);

      return this.createSuccessResponse({
        contacts: results,
        count: results.length,
        preview
      }, preview ? `Preview: ${results.length} contacts would be deleted` : `${results.length} contacts deleted`);
    } catch (error) {
      this.logger.error('Error in bulk delete contacts:', error);
      return this.createErrorResponse('Failed to delete contacts');
    }
  }

  async updateAll(userPhone: string, filter: ContactFilter, patch: BulkPatch, preview = false): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(userPhone);
      const allowedColumns = SQLCompiler.getAllowedColumns('contacts');

      // Compile SET clause
      const { setSql, setParams } = SQLCompiler.compileSet(patch, allowedColumns, 1);
      
      if (!setSql) {
        return this.createErrorResponse('No valid fields to update');
      }

      // Compile WHERE clause
      const { whereSql, params } = SQLCompiler.compileWhere('contacts', userId, filter);

      // Safety check: refuse empty where unless preview
      if (!whereSql.trim() && !preview) {
        return this.createErrorResponse(
          'Bulk update requires filter conditions. Set preview=true to review affected rows.'
        );
      }

      // Combine params: setParams first, then where params
      const allParams = [...setParams, ...params];

      let query: string;
      
      if (preview) {
        query = `SELECT c.id, c.name, c.phone_number, c.email, c.address, c.created_at 
                 FROM contact_list c 
                 WHERE ${whereSql}`;
      } else {
        query = `UPDATE contact_list c 
                 SET ${setSql}
                 WHERE ${whereSql}
                 RETURNING c.id, c.name, c.phone_number, c.email, c.address, c.created_at`;
      }

      const results = await this.executeQuery<Contact>(query, preview ? params : allParams);

      this.logger.info(`✅ ${preview ? 'Preview' : 'Updated'} ${results.length} contacts for user: ${userId}`);

      return this.createSuccessResponse({
        contacts: results,
        count: results.length,
        preview
      }, preview ? `Preview: ${results.length} contacts would be updated` : `${results.length} contacts updated`);
    } catch (error) {
      this.logger.error('Error in bulk update contacts:', error);
      return this.createErrorResponse('Failed to update contacts');
    }
  }
}
