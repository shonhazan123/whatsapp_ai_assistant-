import { CreateMultipleRequest, CreateRequest, DeleteRequest, GetRequest, IResponse, UpdateRequest } from '../../core/types/AgentTypes';
import { logger } from '../../utils/logger';
import { BaseService } from './BaseService';

export interface List {
  id: string;
  list_id: string;
  list_name: string;
  content?: string | null;
  is_checklist: boolean;
  items?: Array<{
    text: string;
    checked: boolean;
    addedAt?: string;
  }> | null;
  created_at: string;
}

export interface CreateListRequest {
  listName: string;
  content?: string;
  isChecklist?: boolean;
  items?: string[];
}

export interface UpdateListRequest {
  listName?: string;
  content?: string;
  items?: Array<{
    text: string;
    checked: boolean;
    addedAt?: string;
  }>;
}

export interface ListFilters {
  listName?: string;
  isChecklist?: boolean;
  content?: string;
}

export class ListService extends BaseService {
  constructor(loggerInstance: any = logger) {
    super(loggerInstance);
  }

  async create(request: CreateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['listName']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const isChecklist = data.isChecklist || false;
      // Convert items to array if it's an object
      let items = [];
      if (Array.isArray(data.items)) {
        items = data.items;
      } else if (data.items && typeof data.items === 'object') {
        items = Object.values(data.items);
      }
      
      const itemsArray = isChecklist ? items.map((item: string) => ({
        text: item,
        checked: false,
        addedAt: new Date().toISOString()
      })) : null;
      
      this.logger.info(`📝 Creating ${isChecklist ? 'checklist' : 'note'}: "${data.listName}"`);
      
      const result = await this.executeSingleQuery<List>(
        `INSERT INTO lists (list_id, list_name, content, is_checklist, items) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, list_name, content, is_checklist, items, created_at`,
        [userId, data.listName, data.content || null, isChecklist, itemsArray ? JSON.stringify(itemsArray) : null]
      );

      this.logger.info(`✅ List created: "${data.listName}" (${isChecklist ? 'checklist' : 'note'})`);
      
      return this.createSuccessResponse(result, `List created successfully`);
    } catch (error) {
      this.logger.error('Error creating list:', error);
      return this.createErrorResponse('Failed to create list');
    }
  }

  async createMultiple(request: CreateMultipleRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const results = [];
      const errors = [];

      for (const item of request.items) {
        try {
          const sanitizedItem = this.sanitizeInput(item);
          const validation = this.validateRequiredFields(sanitizedItem, ['listName']);
          
          if (validation) {
            errors.push({ item, error: validation });
            continue;
          }

          const isChecklist = sanitizedItem.isChecklist || false;
          // Convert items to array if it's an object
          let items = [];
          if (Array.isArray(sanitizedItem.items)) {
            items = sanitizedItem.items;
          } else if (sanitizedItem.items && typeof sanitizedItem.items === 'object') {
            items = Object.values(sanitizedItem.items);
          }
          const itemsArray = isChecklist ? items.map((itemText: string) => ({
            text: itemText,
            checked: false,
            addedAt: new Date().toISOString()
          })) : null;

          const result = await this.executeSingleQuery<List>(
            `INSERT INTO lists (list_id, list_name, content, is_checklist, items) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING id, list_name, content, is_checklist, items, created_at`,
            [userId, sanitizedItem.listName, sanitizedItem.content || null, isChecklist, itemsArray ? JSON.stringify(itemsArray) : null]
          );

          results.push(result);
        } catch (error) {
          errors.push({ item, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      this.logger.info(`✅ Created ${results.length} lists for user: ${userId}`);
      
      return this.createSuccessResponse({
        created: results,
        errors: errors.length > 0 ? errors : undefined,
        count: results.length
      }, `Created ${results.length} lists`);
    } catch (error) {
      this.logger.error('Error creating multiple lists:', error);
      return this.createErrorResponse('Failed to create lists');
    }
  }

  async getById(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      const list = await this.executeSingleQuery<List>(
        `SELECT id, list_name, content, is_checklist, items, created_at
         FROM lists 
         WHERE list_id = $1 AND id = $2`,
        [userId, request.id]
      );

      if (!list) {
        return this.createErrorResponse('List not found');
      }

      return this.createSuccessResponse(list);
    } catch (error) {
      this.logger.error('Error getting list by ID:', error);
      return this.createErrorResponse('Failed to get list');
    }
  }

  async getAll(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      let query = `
        SELECT id, list_name, content, is_checklist, items, created_at
        FROM lists 
        WHERE list_id = $1
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      if (request.filters) {
        if (request.filters.listName) {
          paramCount++;
          query += ` AND list_name ILIKE $${paramCount}`;
          params.push(`%${request.filters.listName}%`);
        }

        if (request.filters.isChecklist !== undefined) {
          paramCount++;
          query += ` AND is_checklist = $${paramCount}`;
          params.push(request.filters.isChecklist);
        }

        if (request.filters.content) {
          paramCount++;
          query += ` AND content ILIKE $${paramCount}`;
          params.push(`%${request.filters.content}%`);
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

      const lists = await this.executeQuery<List>(query, params);

      return this.createSuccessResponse({
        lists,
        count: lists.length
      });
    } catch (error) {
      this.logger.error('Error getting lists:', error);
      return this.createErrorResponse('Failed to get lists');
    }
  }

  async update(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const updateFields: string[] = [];
      const params: any[] = [userId, request.id];
      let paramCount = 2;

      if (data.listName) {
        paramCount++;
        updateFields.push(`list_name = $${paramCount}`);
        params.push(data.listName);
      }

      if (data.content !== undefined) {
        paramCount++;
        updateFields.push(`content = $${paramCount}`);
        params.push(data.content);
      }

      if (data.items) {
        paramCount++;
        updateFields.push(`items = $${paramCount}`);
        params.push(JSON.stringify(data.items));
      }

      if (updateFields.length === 0) {
        return this.createErrorResponse('No fields to update');
      }

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET ${updateFields.join(', ')}
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, is_checklist, items, created_at`,
        params
      );

      if (!result) {
        return this.createErrorResponse('List not found');
      }

      this.logger.info(`✅ List updated: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'List updated successfully');
    } catch (error) {
      this.logger.error('Error updating list:', error);
      return this.createErrorResponse('Failed to update list');
    }
  }

  async delete(request: DeleteRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);

      const result = await this.executeSingleQuery<List>(
        `DELETE FROM lists 
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content`,
        [userId, request.id]
      );

      if (!result) {
        return this.createErrorResponse('List not found');
      }

      this.logger.info(`✅ List deleted: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'List deleted successfully');
    } catch (error) {
      this.logger.error('Error deleting list:', error);
      return this.createErrorResponse('Failed to delete list');
    }
  }

  async addItem(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['listId', 'itemText']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const currentList = await this.executeSingleQuery<List>(
        'SELECT items FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList) {
        return this.createErrorResponse('List not found');
      }

      const currentItems = currentList.items || [];
      const newItem = {
        text: data.itemText,
        checked: false,
        addedAt: new Date().toISOString()
      };

      const updatedItems = [...currentItems, newItem];

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET items = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, is_checklist, items, created_at`,
        [userId, data.listId, JSON.stringify(updatedItems)]
      );

      this.logger.info(`✅ Item added to list: ${data.listId} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Item added successfully');
    } catch (error) {
      this.logger.error('Error adding item to list:', error);
      return this.createErrorResponse('Failed to add item');
    }
  }

  async toggleItem(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['listId', 'itemIndex']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const currentList = await this.executeSingleQuery<List>(
        'SELECT items FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList || !currentList.items) {
        return this.createErrorResponse('List not found or not a checklist');
      }

      if (data.itemIndex >= currentList.items.length) {
        return this.createErrorResponse('Item not found');
      }

      const updatedItems = [...currentList.items];
      updatedItems[data.itemIndex].checked = !updatedItems[data.itemIndex].checked;

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET items = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, is_checklist, items, created_at`,
        [userId, data.listId, JSON.stringify(updatedItems)]
      );

      this.logger.info(`✅ Item toggled in list: ${data.listId} for user: ${userId}`);
      
      return this.createSuccessResponse(result, 'Item toggled successfully');
    } catch (error) {
      this.logger.error('Error toggling item:', error);
      return this.createErrorResponse('Failed to toggle item');
    }
  }

  async deleteItem(request: UpdateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['listId', 'itemIndex']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const currentList = await this.executeSingleQuery<List>(
        'SELECT items FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList || !currentList.items) {
        return this.createErrorResponse('List not found or not a checklist');
      }

      if (data.itemIndex >= currentList.items.length) {
        return this.createErrorResponse('Item not found');
      }

      const updatedItems = [...currentList.items];
      const deletedItem = updatedItems[data.itemIndex];
      updatedItems.splice(data.itemIndex, 1);

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET items = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, is_checklist, items, created_at`,
        [userId, data.listId, JSON.stringify(updatedItems)]
      );

      this.logger.info(`✅ Item deleted from list: ${data.listId} for user: ${userId}, item: "${deletedItem.text}"`);
      
      return this.createSuccessResponse({
        ...result,
        deletedItem: deletedItem.text
      }, `Item "${deletedItem.text}" deleted successfully`);
    } catch (error) {
      this.logger.error('Error deleting item:', error);
      return this.createErrorResponse('Failed to delete item');
    }
  }
}
