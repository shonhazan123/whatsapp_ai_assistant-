import { BaseService } from './BaseService';
import { logger } from '../../utils/logger';
import { IResponse, CreateRequest, UpdateRequest, DeleteRequest, GetRequest, BulkRequest } from '../../core/types/AgentTypes';

export interface Contact {
  id: string;
  contact_list_id: string;
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
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['name']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const result = await this.executeSingleQuery<Contact>(
        `INSERT INTO contact_list (contact_list_id, name, phone_number, email, address) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, name, phone_number, email, address, created_at`,
        [userId, data.name, data.phone || null, data.email || null, data.address || null]
      );

      this.logger.info(`✅ Contact created: "${data.name}" for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Contact created successfully');
    } catch (error) {
      this.logger.error('Error creating contact:', error);
      return this.createErrorResponse('Failed to create contact');
    }
  }

  async createMultiple(request: BulkRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
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
            `INSERT INTO contact_list (contact_list_id, name, phone_number, email, address) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING id, name, phone_number, email, address, created_at`,
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
      const userId = await this.ensureUserExists(request.userPhone);
      
      const contact = await this.executeSingleQuery<Contact>(
        `SELECT id, name, phone_number, email, address, created_at
         FROM contact_list 
         WHERE contact_list_id = $1 AND id = $2`,
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
      const userId = await this.ensureUserExists(request.userPhone);
      
      let query = `
        SELECT id, name, phone_number, email, address, created_at
        FROM contact_list 
        WHERE contact_list_id = $1
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
      const userId = await this.ensureUserExists(request.userPhone);
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
         WHERE contact_list_id = $1 AND id = $2
         RETURNING id, name, phone_number, email, address, created_at`,
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
      const userId = await this.ensureUserExists(request.userPhone);

      const result = await this.executeSingleQuery<Contact>(
        `DELETE FROM contact_list 
         WHERE contact_list_id = $1 AND id = $2
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
      const userId = await this.ensureUserExists(request.userPhone);
      
      if (!request.filters?.name && !request.filters?.phone && !request.filters?.email) {
        return this.createErrorResponse('Search query is required');
      }

      let query = `
        SELECT id, name, phone_number, email, address, created_at
        FROM contact_list 
        WHERE contact_list_id = $1 AND (
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
}
