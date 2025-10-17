import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { TaskService } from '../../services/database/TaskService';
import { ContactService } from '../../services/database/ContactService';
import { ListService } from '../../services/database/ListService';
import { UserDataService } from '../../services/database/UserDataService';
import { logger } from '../../utils/logger';

// Task Functions
export class TaskFunction implements IFunction {
  name = 'taskOperations';
  description = 'Handle all task-related operations including create, read, update, delete, and complete tasks';

  parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['create', 'createMultiple', 'get', 'getAll', 'update', 'updateMultiple', 'delete', 'deleteMultiple', 'complete', 'addSubtask'],
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
          if (!params.taskId) {
            return { success: false, error: 'Task ID is required for get operation' };
          }
          return await this.taskService.getById({
            userPhone: userId,
            id: params.taskId
          });

        case 'getAll':
          return await this.taskService.getAll({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        case 'update':
          if (!params.taskId) {
            return { success: false, error: 'Task ID is required for update operation' };
          }
          return await this.taskService.update({
            userPhone: userId,
            id: params.taskId,
            data: params
          });

        case 'updateMultiple':
          if (!params.updates || !Array.isArray(params.updates) || params.updates.length === 0) {
            return { success: false, error: 'Updates array is required for updateMultiple operation' };
          }
          const updateResults = [];
          const updateErrors = [];
          for (const update of params.updates) {
            try {
              const result = await this.taskService.update({
                userPhone: userId,
                id: update.taskId,
                data: update
              });
              if (result.success) {
                updateResults.push(result.data);
              } else {
                updateErrors.push({ taskId: update.taskId, error: result.error });
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
          if (!params.taskId) {
            return { success: false, error: 'Task ID is required for delete operation' };
          }
          return await this.taskService.delete({
            userPhone: userId,
            id: params.taskId
          });

        case 'deleteMultiple':
          if (!params.taskIds || !Array.isArray(params.taskIds) || params.taskIds.length === 0) {
            return { success: false, error: 'Task IDs array is required for deleteMultiple operation' };
          }
          const deleteResults = [];
          const deleteErrors = [];
          for (const taskId of params.taskIds) {
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

        case 'complete':
          if (!params.taskId) {
            return { success: false, error: 'Task ID is required for complete operation' };
          }
          return await this.taskService.complete({
            userPhone: userId,
            id: params.taskId,
            data: {}
          });

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
          if (!params.contactId) {
            return { success: false, error: 'Contact ID is required for get operation' };
          }
          return await this.contactService.getById({
            userPhone: userId,
            id: params.contactId
          });

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
          if (!params.contactId) {
            return { success: false, error: 'Contact ID is required for update operation' };
          }
          return await this.contactService.update({
            userPhone: userId,
            id: params.contactId,
            data: params
          });

        case 'updateMultiple':
          if (!params.updates || !Array.isArray(params.updates) || params.updates.length === 0) {
            return { success: false, error: 'Updates array is required for updateMultiple operation' };
          }
          const updateResults = [];
          const updateErrors = [];
          for (const update of params.updates) {
            try {
              const result = await this.contactService.update({
                userPhone: userId,
                id: update.contactId,
                data: update
              });
              if (result.success) {
                updateResults.push(result.data);
              } else {
                updateErrors.push({ contactId: update.contactId, error: result.error });
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
          if (!params.contactId) {
            return { success: false, error: 'Contact ID is required for delete operation' };
          }
          return await this.contactService.delete({
            userPhone: userId,
            id: params.contactId
          });

        case 'deleteMultiple':
          if (!params.contactIds || !Array.isArray(params.contactIds) || params.contactIds.length === 0) {
            return { success: false, error: 'Contact IDs array is required for deleteMultiple operation' };
          }
          const deleteResults = [];
          const deleteErrors = [];
          for (const contactId of params.contactIds) {
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
      listType: {
        type: 'string',
        enum: ['note', 'checklist'],
        description: 'Type of list for create operation'
      },
      title: {
        type: 'string',
        description: 'List title'
      },
      items: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of items for checklist'
      },
      filters: {
        type: 'object',
        properties: {
          listType: { type: 'string', enum: ['note', 'checklist'] },
          title: { type: 'string' }
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
            listType: { type: 'string', enum: ['note', 'checklist'] },
            title: { type: 'string' },
            items: { type: 'array', items: { type: 'string' } }
          },
          required: ['listType']
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
            title: { type: 'string' },
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
          if (!params.listId) {
            return { success: false, error: 'List ID is required for get operation' };
          }
          return await this.listService.getById({
            userPhone: userId,
            id: params.listId
          });

        case 'getAll':
          return await this.listService.getAll({
            userPhone: userId,
            filters: params.filters,
            limit: params.limit,
            offset: params.offset
          });

        case 'update':
          if (!params.listId) {
            return { success: false, error: 'List ID is required for update operation' };
          }
          return await this.listService.update({
            userPhone: userId,
            id: params.listId,
            data: params
          });

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
          if (!params.listId) {
            return { success: false, error: 'List ID is required for delete operation' };
          }
          return await this.listService.delete({
            userPhone: userId,
            id: params.listId
          });

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
          if (!params.listId || !params.itemText) {
            return { success: false, error: 'List ID and item text are required for addItem operation' };
          }
          return await this.listService.addItem({
            userPhone: userId,
            id: params.listId,
            data: {
              listId: params.listId,
              itemText: params.itemText
            }
          });

        case 'toggleItem':
          if (!params.listId || params.itemIndex === undefined) {
            return { success: false, error: 'List ID and item index are required for toggleItem operation' };
          }
          return await this.listService.toggleItem({
            userPhone: userId,
            id: params.listId,
            data: {
              listId: params.listId,
              itemIndex: params.itemIndex
            }
          });

        case 'deleteItem':
          if (!params.listId || params.itemIndex === undefined) {
            return { success: false, error: 'List ID and item index are required for deleteItem operation' };
          }
          return await this.listService.deleteItem({
            userPhone: userId,
            id: params.listId,
            data: {
              listId: params.listId,
              itemIndex: params.itemIndex
            }
          });

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
