import { BaseService } from './BaseService';
import { logger } from '../../utils/logger';
import { IResponse, CreateRequest, UpdateRequest, DeleteRequest, GetRequest, BulkRequest } from '../../core/types/AgentTypes';

export interface List {
  id: string;
  list_id: string;
  list_name: 'note' | 'checklist';
  content: {
    title: string;
    items?: Array<{
      text: string;
      checked: boolean;
      addedAt: string;
    }>;
    createdAt: string;
    updatedAt?: string;
  };
  created_at: string;
}

export interface CreateListRequest {
  listType: 'note' | 'checklist';
  title?: string;
  items?: string[];
}

export interface UpdateListRequest {
  title?: string;
  items?: Array<{
    text: string;
    checked: boolean;
    addedAt?: string;
  }>;
}

export interface ListFilters {
  listType?: 'note' | 'checklist';
  title?: string;
}

export class ListService extends BaseService {
  constructor(loggerInstance: any = logger) {
    super(loggerInstance);
  }

  async create(request: CreateRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const data = this.sanitizeInput(request.data);

      const validation = this.validateRequiredFields(data, ['listType']);
      if (validation) {
        return this.createErrorResponse(validation);
      }

      const itemCount = data.items?.length || 0;
      this.logger.info(`📝 Creating ${data.listType}: "${data.title}" with ${itemCount} items`);
      
      // Format content as structured JSON
      const content = {
        title: data.title || (data.listType === 'checklist' ? 'רשימת בדיקה' : 'הערה'),
        items: (data.items || []).map((item: string) => ({
          text: item,
          checked: false,
          addedAt: new Date().toISOString()
        })),
        createdAt: new Date().toISOString()
      };
      
      const result = await this.executeSingleQuery<List>(
        `INSERT INTO lists (list_id, list_name, content) 
         VALUES ($1, $2, $3) 
         RETURNING id, list_name, content, created_at`,
        [userId, data.listType, JSON.stringify(content)]
      );

      this.logger.info(`✅ List created: "${content.title}" with ${itemCount} items`);
      
      return this.createSuccessResponse({
        ...result,
        content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null
      }, `List created with ${itemCount} items`);
    } catch (error) {
      this.logger.error('Error creating list:', error);
      return this.createErrorResponse('Failed to create list');
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
          const validation = this.validateRequiredFields(sanitizedItem, ['listType']);
          
          if (validation) {
            errors.push({ item, error: validation });
            continue;
          }

          const itemCount = sanitizedItem.items?.length || 0;
          const content = {
            title: sanitizedItem.title || (sanitizedItem.listType === 'checklist' ? 'רשימת בדיקה' : 'הערה'),
            items: (sanitizedItem.items || []).map((itemText: string) => ({
              text: itemText,
              checked: false,
              addedAt: new Date().toISOString()
            })),
            createdAt: new Date().toISOString()
          };

          const result = await this.executeSingleQuery<List>(
            `INSERT INTO lists (list_id, list_name, content) 
             VALUES ($1, $2, $3) 
             RETURNING id, list_name, content, created_at`,
            [userId, sanitizedItem.listType, JSON.stringify(content)]
          );

          results.push({
            ...result,
            content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null
          });
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
        `SELECT id, list_name, content, created_at
         FROM lists 
         WHERE list_id = $1 AND id = $2`,
        [userId, request.id]
      );

      if (!list) {
        return this.createErrorResponse('List not found');
      }

      return this.createSuccessResponse({
        ...list,
        content: list ? (typeof list.content === 'string' ? JSON.parse(list.content) : list.content) : null
      });
    } catch (error) {
      this.logger.error('Error getting list by ID:', error);
      return this.createErrorResponse('Failed to get list');
    }
  }

  async getAll(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      let query = `
        SELECT id, list_name, content, created_at
        FROM lists 
        WHERE list_id = $1
      `;

      const params: any[] = [userId];
      let paramCount = 1;

      // Apply filters
      if (request.filters) {
        if (request.filters.listType) {
          paramCount++;
          query += ` AND list_name = $${paramCount}`;
          params.push(request.filters.listType);
        }

        if (request.filters.title) {
          paramCount++;
          query += ` AND content->>'title' ILIKE $${paramCount}`;
          params.push(`%${request.filters.title}%`);
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

      const processedLists = lists.map(list => ({
        ...list,
        content: typeof list.content === 'string' ? JSON.parse(list.content) : list.content
      }));

      return this.createSuccessResponse({
        lists: processedLists,
        count: processedLists.length
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

      // Get current list to merge content
      const currentList = await this.executeSingleQuery<List>(
        'SELECT content FROM lists WHERE list_id = $1 AND id = $2',
        [userId, request.id]
      );

      if (!currentList) {
        return this.createErrorResponse('List not found');
      }

      const currentContent = typeof currentList.content === 'string' 
        ? JSON.parse(currentList.content) 
        : currentList.content;

      // Merge updates with current content
      const updatedContent = {
        ...currentContent,
        ...(data.title && { title: data.title }),
        ...(data.items && { items: data.items }),
        updatedAt: new Date().toISOString()
      };

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET content = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, created_at`,
        [userId, request.id, JSON.stringify(updatedContent)]
      );

      this.logger.info(`✅ List updated: ${request.id} for user: ${userId}`);
      
      return this.createSuccessResponse({
        ...result,
        content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null
      }, 'List updated successfully');
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

      // Get current list
      const currentList = await this.executeSingleQuery<List>(
        'SELECT content FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList) {
        return this.createErrorResponse('List not found');
      }

      const currentContent = typeof currentList.content === 'string' 
        ? JSON.parse(currentList.content) 
        : currentList.content;

      // Add new item
      const newItem = {
        text: data.itemText,
        checked: false,
        addedAt: new Date().toISOString()
      };

      const updatedContent = {
        ...currentContent,
        items: [...(currentContent.items || []), newItem],
        updatedAt: new Date().toISOString()
      };

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET content = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, created_at`,
        [userId, data.listId, JSON.stringify(updatedContent)]
      );

      this.logger.info(`✅ Item added to list: ${data.listId} for user: ${userId}`);
      
      return this.createSuccessResponse({
        ...result,
        content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null
      }, 'Item added successfully');
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

      // Get current list
      const currentList = await this.executeSingleQuery<List>(
        'SELECT content FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList) {
        return this.createErrorResponse('List not found');
      }

      const currentContent = typeof currentList.content === 'string' 
        ? JSON.parse(currentList.content) 
        : currentList.content;

      if (!currentContent.items || data.itemIndex >= currentContent.items.length) {
        return this.createErrorResponse('Item not found');
      }

      // Toggle item
      const updatedItems = [...currentContent.items];
      updatedItems[data.itemIndex].checked = !updatedItems[data.itemIndex].checked;

      const updatedContent = {
        ...currentContent,
        items: updatedItems,
        updatedAt: new Date().toISOString()
      };

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET content = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, created_at`,
        [userId, data.listId, JSON.stringify(updatedContent)]
      );

      this.logger.info(`✅ Item toggled in list: ${data.listId} for user: ${userId}`);
      
      return this.createSuccessResponse({
        ...result,
        content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null
      }, 'Item toggled successfully');
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

      // Get current list
      const currentList = await this.executeSingleQuery<List>(
        'SELECT content FROM lists WHERE list_id = $1 AND id = $2',
        [userId, data.listId]
      );

      if (!currentList) {
        return this.createErrorResponse('List not found');
      }

      const currentContent = typeof currentList.content === 'string' 
        ? JSON.parse(currentList.content) 
        : currentList.content;

      if (!currentContent.items || data.itemIndex >= currentContent.items.length) {
        return this.createErrorResponse('Item not found');
      }

      // Delete item
      const updatedItems = [...currentContent.items];
      const deletedItem = updatedItems[data.itemIndex];
      updatedItems.splice(data.itemIndex, 1);

      const updatedContent = {
        ...currentContent,
        items: updatedItems,
        updatedAt: new Date().toISOString()
      };

      const result = await this.executeSingleQuery<List>(
        `UPDATE lists 
         SET content = $3
         WHERE list_id = $1 AND id = $2
         RETURNING id, list_name, content, created_at`,
        [userId, data.listId, JSON.stringify(updatedContent)]
      );

      this.logger.info(`✅ Item deleted from list: ${data.listId} for user: ${userId}, item: "${deletedItem.text}"`);
      
      return this.createSuccessResponse({
        ...result,
        content: result ? (typeof result.content === 'string' ? JSON.parse(result.content) : result.content) : null,
        deletedItem: deletedItem.text
      }, `Item "${deletedItem.text}" deleted successfully`);
    } catch (error) {
      this.logger.error('Error deleting item:', error);
      return this.createErrorResponse('Failed to delete item');
    }
  }
}
