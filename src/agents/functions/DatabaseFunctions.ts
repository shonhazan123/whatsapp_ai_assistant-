import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
import { ContactService } from '../../services/database/ContactService';
import { ListService } from '../../services/database/ListService';
import { TaskService } from '../../services/database/TaskService';
import { UserDataService } from '../../services/database/UserDataService';

// Task Functions
export class TaskFunction implements IFunction {
  name = 'taskOperations';
  description = 'Handle all task-related operations including create, read, update, delete, and complete tasks';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'delete', 'deleteMultiple', 'deleteAll', 'updateAll', 'complete', 'completeAll', 'addSubtask'],
        description: 'The operation to perform on tasks'
      },
      taskId: {
        type: 'string',
        description: 'Task ID for get, update, delete operations'
      },
      text: {
        type: 'string',
        description: 'Task description for create and update operations'
      },
      category: {
        type: 'string',
        description: 'Task category'
      },
      dueDate: {
        type: 'string',
        description: 'Due date in ISO format'
      },
      filters: {
        type: 'object',
        properties: {
          completed: { type: 'boolean' },
          category: { type: 'string' },
          dueDateFrom: { type: 'string' },
          dueDateTo: { type: 'string' }
        }
      },
      subtaskText: {
        type: 'string',
        description: 'Subtask description for addSubtask operation'
      },
      tasks: {
        type: 'array',
        description: 'Array of tasks for createMultiple operation',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            category: { type: 'string' },
            dueDate: { type: 'string' }
          },
          required: ['text']
        }
      },
      taskIds: {
        type: 'array',
        description: 'Array of task IDs for deleteMultiple or updateMultiple operations',
        items: { type: 'string' }
      },
      updates: {
        type: 'array',
        description: 'Array of updates for updateMultiple operation',
        items: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            text: { type: 'string' },
            category: { type: 'string' },
            dueDate: { type: 'string' },
            completed: { type: 'boolean' }
          },
          required: ['taskId']
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private taskService: TaskService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      // Helper: resolve a taskId from natural language text when missing
      const resolveTaskId = async (): Promise<{ id: string | null; disambiguation?: string }> => {
        if (params.taskId) return { id: params.taskId };
        if (!params.text) return { id: null };
        const resolver = new QueryResolver();
        const result = await resolver.resolveOneOrAsk(params.text, userId, 'task');
        if (result.disambiguation) {
          return { 
            id: null, 
            disambiguation: resolver.formatDisambiguation('task', result.disambiguation.candidates) 
          };
        }
        return { id: result.entity?.id || null };
      };

      switch (operation) {
        case 'create':
          return await this.taskService.create({
            userPhone: userId,
            data: params
          });

        case 'createMultiple':
          if (!params.tasks || !Array.isArray(params.tasks) || params.tasks.length === 0) {
            return { success: false, error: 'Tasks array is required for createMultiple operation' };
          }
          return await this.taskService.createMultiple({
            userPhone: userId,
            items: params.tasks
          });

        case 'get':
          {
            const resolved = await resolveTaskId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }
            return await this.taskService.getById({
              userPhone: userId,
              id: resolved.id
            });
          }

        case 'getAll':
          return await this.taskService.getAll({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        case 'update':
          {
            const resolved = await resolveTaskId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }
            return await this.taskService.update({
              userPhone: userId,
              id: resolved.id,
              data: params
            });
          }

        case 'updateMultiple':
          if (!params.updates || !Array.isArray(params.updates) || params.updates.length === 0) {
            return { success: false, error: 'Updates array is required for updateMultiple operation' };
          }
          const updateResults = [];
          const updateErrors = [];
          for (const update of params.updates) {
            try {
              // Natural language: resolve missing taskId from update.text if needed
              let resolvedId = update.taskId;
              if (!resolvedId && update.text) {
                const r = await new QueryResolver().resolveOneOrAsk(update.text, userId, 'task');
                if (r.disambiguation) {
                  updateErrors.push({ taskText: update.text, error: r.disambiguation });
                  continue;
                }
                resolvedId = r.entity?.id || null;
              }
              if (!resolvedId) {
                updateErrors.push({ taskText: update.text, error: 'Task not found' });
                continue;
              }
              const result = await this.taskService.update({
                userPhone: userId,
                id: resolvedId,
                data: update
              });
              if (result.success) {
                updateResults.push(result.data);
              } else {
                updateErrors.push({ taskId: resolvedId, error: result.error });
              }
            } catch (error) {
              updateErrors.push({ taskId: update.taskId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
          }
          return {
            success: updateErrors.length === 0,
            data: {
              updated: updateResults,
              errors: updateErrors.length > 0 ? updateErrors : undefined,
              count: updateResults.length
            }
          };

        case 'delete':
          {
            const resolved = await resolveTaskId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }
            return await this.taskService.delete({
              userPhone: userId,
              id: resolved.id
            });
          }

        case 'deleteMultiple':
          {
            const deleteResults = [];
            const deleteErrors = [];
            let ids: string[] = Array.isArray(params.taskIds) ? params.taskIds : [];
            // Natural language: if no ids provided, try params.tasks (array of { text })
            if ((!ids || ids.length === 0) && Array.isArray(params.tasks)) {
              for (const t of params.tasks) {
                if (!t?.text) continue;
                const r = await new QueryResolver().resolveOneOrAsk(t.text, userId, 'task');
                if (r.disambiguation) {
                  deleteErrors.push({ taskText: t.text, error: r.disambiguation });
                  continue;
                }
                if (r.entity?.id) ids.push(r.entity.id);
              }
            }
            if (!ids || ids.length === 0) {
              return { success: false, error: 'Provide taskIds or tasks with text to delete' };
            }
            for (const taskId of ids) {
            try {
              const result = await this.taskService.delete({
                userPhone: userId,
                id: taskId
              });
              if (result.success) {
                deleteResults.push(result.data);
              } else {
                deleteErrors.push({ taskId, error: result.error });
              }
            } catch (error) {
              deleteErrors.push({ taskId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
            }
            return {
              success: deleteErrors.length === 0,
              data: {
                deleted: deleteResults,
                errors: deleteErrors.length > 0 ? deleteErrors : undefined,
                count: deleteResults.length
              }
            };
          }

        case 'complete':
          {
            const resolved = await resolveTaskId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }
            return await this.taskService.complete({
              userPhone: userId,
              id: resolved.id,
              data: {}
            });
          }

        case 'deleteAll':
          // Note: deleteAll uses filters from TaskService.deleteAll
          // Should use where filters and preview flag
          const deleteAllFilter = params.where || params.filters || {};
          return await this.taskService.deleteAll(userId, deleteAllFilter, params.preview === true);

        case 'updateAll':
          // Note: updateAll uses filters and patch from TaskService.updateAll
          const updateAllFilter = params.where || params.filters || {};
          const patch = params.patch || {};
          return await this.taskService.updateAll(userId, updateAllFilter, patch, params.preview === true);

        case 'completeAll':
          // Note: completeAll is a wrapper for updateAll with completed=true
          const completeAllFilter = params.where || params.filters || {};
          return await this.taskService.completeAll(userId, completeAllFilter, params.preview === true);

        case 'addSubtask':
          if (!params.taskId || !params.subtaskText) {
            return { success: false, error: 'Task ID and subtask text are required for addSubtask operation' };
          }
          return await this.taskService.addSubtask({
            userPhone: userId,
            data: {
              taskId: params.taskId,
              text: params.subtaskText
            }
          });

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in TaskFunction:', error);
      return { success: false, error: 'Failed to execute task operation' };
    }
  }
}

// Contact Functions
export class ContactFunction implements IFunction {
  name = 'contactOperations';
  description = 'Handle all contact-related operations including create, read, update, delete, and search contacts';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'delete', 'deleteMultiple', 'search'],
        description: 'The operation to perform on contacts'
      },
      contactId: {
        type: 'string',
        description: 'Contact ID for get, update, delete operations'
      },
      name: {
        type: 'string',
        description: 'Contact name (for create, update, or search operations)'
      },
      phone: {
        type: 'string',
        description: 'Contact phone number'
      },
      email: {
        type: 'string',
        description: 'Contact email address'
      },
      address: {
        type: 'string',
        description: 'Contact physical address'
      },
      filters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' }
        }
      },
      contacts: {
        type: 'array',
        description: 'Array of contacts for createMultiple operation',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' }
          },
          required: ['name']
        }
      },
      contactIds: {
        type: 'array',
        description: 'Array of contact IDs for deleteMultiple or updateMultiple operations',
        items: { type: 'string' }
      },
      updates: {
        type: 'array',
        description: 'Array of updates for updateMultiple operation',
        items: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            name: { type: 'string' },
            phone: { type: 'string' },
            email: { type: 'string' },
            address: { type: 'string' }
          },
          required: ['contactId']
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private contactService: ContactService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;
      const resolver = new QueryResolver();
      const resolveContactId = async (): Promise<{ id: string | null; disambiguation?: string }> => {
        if (params.contactId) return { id: params.contactId };
        const query = params.name || params.email || params.phone;
        if (!query) return { id: null };
        const one = await resolver.resolveOneOrAsk(query, userId, 'contact');
        if (one.disambiguation) {
          return { 
            id: null, 
            disambiguation: resolver.formatDisambiguation('contact', one.disambiguation.candidates) 
          };
        }
        return { id: one.entity?.id || null };
      };

      switch (operation) {
        case 'create':
          return await this.contactService.create({
            userPhone: userId,
            data: params
          });

        case 'createMultiple':
          if (!params.contacts || !Array.isArray(params.contacts) || params.contacts.length === 0) {
            return { success: false, error: 'Contacts array is required for createMultiple operation' };
          }
          return await this.contactService.createMultiple({
            userPhone: userId,
            items: params.contacts
          });

        case 'get':
          {
            const resolved = await resolveContactId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'Contact not found (provide name/email/phone)' };
            return await this.contactService.getById({ userPhone: userId, id: resolved.id });
          }

        case 'getAll':
          return await this.contactService.getAll({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        case 'search':
          if (!params.name) {
            return { success: false, error: 'Name is required for search operation' };
          }
          
          this.logger.info(`🔍 Searching for contact: "${params.name}" for user: ${userId}`);
          
          // Search for contacts by name
          const allContacts = await this.contactService.getAll({
            userPhone: userId
          });
          
          this.logger.info(`📋 ContactService response:`, allContacts);
          
          if (!allContacts.success || !allContacts.data) {
            return { success: false, error: 'No contacts found' };
          }
          
          // Handle the response structure from ContactService.getAll()
          // It returns { contacts: [...], count: number }
          let contacts: any[] = [];
          if (allContacts.data.contacts && Array.isArray(allContacts.data.contacts)) {
            contacts = allContacts.data.contacts;
          } else if (Array.isArray(allContacts.data)) {
            contacts = allContacts.data;
          }
          
          this.logger.info(`📋 Found ${contacts.length} total contacts:`, contacts);
          const searchName = params.name.toLowerCase().trim();
          
          // More flexible search - check if search name is contained in contact name
          const matchingContacts = contacts.filter((contact: any) => {
            if (!contact.name) return false;
            const contactName = contact.name.toLowerCase().trim();
            
            // Exact match
            if (contactName === searchName) return true;
            
            // Partial match - search name is contained in contact name
            if (contactName.includes(searchName)) return true;
            
            // Reverse partial match - contact name is contained in search name
            if (searchName.includes(contactName)) return true;
            
            // Word-by-word match for Hebrew names
            const searchWords = searchName.split(/\s+/);
            const contactWords = contactName.split(/\s+/);
            
            // Check if any search word matches any contact word
            return searchWords.some((searchWord: string) => 
              contactWords.some((contactWord: string) => 
                contactWord.includes(searchWord) || searchWord.includes(contactWord)
              )
            );
          });
          
          if (matchingContacts.length === 0) {
            return { success: false, error: `No contact found with name "${params.name}"` };
          }
          
          // Return the first matching contact with proper format
          const foundContact = matchingContacts[0];
          const responseMessage = `מצאתי איש קשר: שם: ${foundContact.name}, מייל: ${foundContact.email || 'לא זמין'}, טלפון: ${foundContact.phone || 'לא זמין'}`;
          
          this.logger.info(`✅ Contact search successful: ${foundContact.name} - ${foundContact.email}`);
          
          return {
            success: true,
            data: foundContact,
            message: responseMessage
          };

        case 'update':
          {
            const resolved = await resolveContactId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'Contact not found (provide name/email/phone)' };
            return await this.contactService.update({ userPhone: userId, id: resolved.id, data: params });
          }

        case 'updateMultiple':
          if (!params.updates || !Array.isArray(params.updates) || params.updates.length === 0) {
            return { success: false, error: 'Updates array is required for updateMultiple operation' };
          }
          const updateResults = [];
          const updateErrors = [];
          for (const update of params.updates) {
            try {
              let resolvedId = update.contactId;
              if (!resolvedId) {
                const q = update.name || update.email || update.phone;
                if (q) {
                  const one = await resolver.resolveOneOrAsk(q, userId, 'contact');
                  if (one.disambiguation) {
                    updateErrors.push({ contactText: q, error: one.disambiguation });
                    continue;
                  }
                  resolvedId = one.entity?.id || null;
                }
              }
              if (!resolvedId) {
                updateErrors.push({ contactText: update.name || update.email || update.phone, error: 'Contact not found' });
                continue;
              }
              const result = await this.contactService.update({
                userPhone: userId,
                id: resolvedId,
                data: update
              });
              if (result.success) {
                updateResults.push(result.data);
              } else {
                updateErrors.push({ contactId: resolvedId, error: result.error });
              }
            } catch (error) {
              updateErrors.push({ contactId: update.contactId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
          }
          return {
            success: updateErrors.length === 0,
            data: {
              updated: updateResults,
              errors: updateErrors.length > 0 ? updateErrors : undefined,
              count: updateResults.length
            }
          };

        case 'delete':
          {
            const resolved = await resolveContactId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'Contact not found (provide name/email/phone)' };
            return await this.contactService.delete({ userPhone: userId, id: resolved.id });
          }

        case 'deleteMultiple':
          {
            const deleteResults = [];
            const deleteErrors = [];
            let ids: string[] = Array.isArray(params.contactIds) ? params.contactIds : [];
            if ((!ids || ids.length === 0) && Array.isArray(params.contacts)) {
              for (const c of params.contacts) {
                const q = c?.name || c?.email || c?.phone;
                if (!q) continue;
                const one = await resolver.resolveOneOrAsk(q, userId, 'contact');
                if (one.disambiguation) {
                  deleteErrors.push({ contactText: q, error: one.disambiguation });
                  continue;
                }
                if (one.entity?.id) ids.push(one.entity.id);
              }
            }
            if (!ids || ids.length === 0) {
              return { success: false, error: 'Provide contactIds or contacts with name/email/phone to delete' };
            }
            for (const contactId of ids) {
            try {
              const result = await this.contactService.delete({
                userPhone: userId,
                id: contactId
              });
              if (result.success) {
                deleteResults.push(result.data);
              } else {
                deleteErrors.push({ contactId, error: result.error });
              }
            } catch (error) {
              deleteErrors.push({ contactId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
            }
            return {
              success: deleteErrors.length === 0,
              data: {
                deleted: deleteResults,
                errors: deleteErrors.length > 0 ? deleteErrors : undefined,
                count: deleteResults.length
              }
            };
          }

        case 'search':
          return await this.contactService.search({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in ContactFunction:', error);
      return { success: false, error: 'Failed to execute contact operation' };
    }
  }
}

// List Functions
export class ListFunction implements IFunction {
  name = 'listOperations';
  description = 'Handle all list-related operations including create, read, update, delete, and manage list items';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'delete', 'deleteMultiple', 'addItem', 'toggleItem', 'deleteItem'],
        description: 'The operation to perform on lists'
      },
      listId: {
        type: 'string',
        description: 'List ID for get, update, delete operations'
      },
      listName: {
        type: 'string',
        description: 'List name/title for create operation'
      },
      isChecklist: {
        type: 'boolean',
        description: 'true for checklist, false for note'
      },
      content: {
        type: 'string',
        description: 'Plain text content for notes'
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of items for checklist'
      },
      filters: {
        type: 'object',
        properties: {
          listName: { type: 'string' },
          isChecklist: { type: 'boolean' },
          content: { type: 'string' }
        }
      },
      itemText: {
        type: 'string',
        description: 'Item text for addItem operation'
      },
      itemIndex: {
        type: 'number',
        description: 'Item index for toggleItem operation'
      },
      lists: {
        type: 'array',
        description: 'Array of lists for createMultiple operation',
        items: {
          type: 'object',
          properties: {
            listName: { type: 'string' },
            isChecklist: { type: 'boolean' },
            content: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } }
          },
          required: ['listName']
        }
      },
      listIds: {
        type: 'array',
        description: 'Array of list IDs for deleteMultiple or updateMultiple operations',
        items: { type: 'string' }
      },
      updates: {
        type: 'array',
        description: 'Array of updates for updateMultiple operation',
        items: {
          type: 'object',
          properties: {
            listId: { type: 'string' },
            listName: { type: 'string' },
            content: { type: 'string' },
            items: { 
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['listId']
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private listService: ListService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;
      const resolver = new QueryResolver();
      const resolveListId = async (): Promise<{ id: string | null; disambiguation?: string }> => {
        if (params.listId) return { id: params.listId };
        const query = params.title;
        if (!query) return { id: null };
        const one = await resolver.resolveOneOrAsk(query, userId, 'list');
        if (one.disambiguation) {
          return { 
            id: null, 
            disambiguation: resolver.formatDisambiguation('list', one.disambiguation.candidates) 
          };
        }
        return { id: one.entity?.id || null };
      };

      switch (operation) {
        case 'create':
          return await this.listService.create({
            userPhone: userId,
            data: params
          });

        case 'createMultiple':
          if (!params.lists || !Array.isArray(params.lists) || params.lists.length === 0) {
            return { success: false, error: 'Lists array is required for createMultiple operation' };
          }
          return await this.listService.createMultiple({
            userPhone: userId,
            items: params.lists
          });

        case 'get':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'List not found (provide title)' };
            return await this.listService.getById({ userPhone: userId, id: resolved.id });
          }

        case 'getAll':
          return await this.listService.getAll({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        case 'update':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'List not found (provide title)' };
            return await this.listService.update({ userPhone: userId, id: resolved.id, data: params });
          }

        case 'updateMultiple':
          if (!params.updates || !Array.isArray(params.updates) || params.updates.length === 0) {
            return { success: false, error: 'Updates array is required for updateMultiple operation' };
          }
          const updateResults = [];
          const updateErrors = [];
          for (const update of params.updates) {
            try {
              const result = await this.listService.update({
                userPhone: userId,
                id: update.listId,
                data: update
              });
              if (result.success) {
                updateResults.push(result.data);
              } else {
                updateErrors.push({ listId: update.listId, error: result.error });
              }
            } catch (error) {
              updateErrors.push({ listId: update.listId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
          }
          return {
            success: updateErrors.length === 0,
            data: {
              updated: updateResults,
              errors: updateErrors.length > 0 ? updateErrors : undefined,
              count: updateResults.length
            }
          };

        case 'delete':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) return { success: false, error: 'List not found (provide title)' };
            return await this.listService.delete({ userPhone: userId, id: resolved.id });
          }

        case 'deleteMultiple':
          if (!params.listIds || !Array.isArray(params.listIds) || params.listIds.length === 0) {
            return { success: false, error: 'List IDs array is required for deleteMultiple operation' };
          }
          const deleteResults = [];
          const deleteErrors = [];
          for (const listId of params.listIds) {
            try {
              const result = await this.listService.delete({
                userPhone: userId,
                id: listId
              });
              if (result.success) {
                deleteResults.push(result.data);
              } else {
                deleteErrors.push({ listId, error: result.error });
              }
            } catch (error) {
              deleteErrors.push({ listId, error: error instanceof Error ? error.message : 'Unknown error' });
            }
          }
          return {
            success: deleteErrors.length === 0,
            data: {
              deleted: deleteResults,
              errors: deleteErrors.length > 0 ? deleteErrors : undefined,
              count: deleteResults.length
            }
          };

        case 'addItem':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id || !params.itemText) return { success: false, error: 'Provide list title and item text' };
            return await this.listService.addItem({ userPhone: userId, id: resolved.id, data: { listId: resolved.id, itemText: params.itemText } });
          }

        case 'toggleItem':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id || params.itemIndex === undefined) return { success: false, error: 'Provide list title and item index' };
            return await this.listService.toggleItem({ userPhone: userId, id: resolved.id, data: { listId: resolved.id, itemIndex: params.itemIndex } });
          }

        case 'deleteItem':
          {
            const resolved = await resolveListId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id || params.itemIndex === undefined) return { success: false, error: 'Provide list title and item index' };
            return await this.listService.deleteItem({ userPhone: userId, id: resolved.id, data: { listId: resolved.id, itemIndex: params.itemIndex } });
          }

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in ListFunction:', error);
      return { success: false, error: 'Failed to execute list operation' };
    }
  }
}

// User Data Functions
export class UserDataFunction implements IFunction {
  name = 'userDataOperations';
  description = 'Get comprehensive user data including tasks, contacts, lists, and statistics';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['getOverview', 'getAllData', 'search', 'getStatistics'],
        description: 'The operation to perform on user data'
      },
      includeTasks: {
        type: 'boolean',
        description: 'Include tasks in the response'
      },
      includeContacts: {
        type: 'boolean',
        description: 'Include contacts in the response'
      },
      includeLists: {
        type: 'boolean',
        description: 'Include lists in the response'
      },
      query: {
        type: 'string',
        description: 'Search query for search operation'
      },
      taskFilters: {
        type: 'object',
        properties: {
          completed: { type: 'boolean' },
          category: { type: 'string' }
        }
      },
      contactFilters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string' }
        }
      },
      listFilters: {
        type: 'object',
        properties: {
          listType: { type: 'string', enum: ['note', 'checklist'] },
          title: { type: 'string' }
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private userDataService: UserDataService,
    private logger: any = logger
  ) {}

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      switch (operation) {
        case 'getOverview':
          return await this.userDataService.getOverview({
            userPhone: userId
          });

        case 'getAllData':
          return await this.userDataService.getAllData({
            userPhone: userId,
            includeTasks: params.includeTasks,
            includeContacts: params.includeContacts,
            includeLists: params.includeLists,
            taskFilters: params.taskFilters,
            contactFilters: params.contactFilters,
            listFilters: params.listFilters
          });

        case 'search':
          if (!params.query) {
            return { success: false, error: 'Search query is required for search operation' };
          }
          return await this.userDataService.searchAll({
            userPhone: userId,
            query: params.query
          });

        case 'getStatistics':
          return await this.userDataService.getStatistics({
            userPhone: userId
          });

        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      this.logger.error('Error in UserDataFunction:', error);
      return { success: false, error: 'Failed to execute user data operation' };
    }
  }
}
