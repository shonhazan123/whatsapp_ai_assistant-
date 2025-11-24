import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { ConversationWindow, RecentTaskSnapshot } from '../../core/memory/ConversationWindow';
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
      reminder: {
        type: 'string',
        description: 'Reminder interval before due date (e.g., "30 minutes", "1 hour", "2 days"). Defaults to 30 minutes if dueDate is set. Cannot be used with reminderRecurrence.'
      },
      reminderRecurrence: {
        type: 'object',
        description: 'Recurrence pattern for recurring reminders. Cannot be used with dueDate+reminder.',
        properties: {
          type: {
            type: 'string',
            enum: ['daily', 'weekly', 'monthly'],
            description: 'Recurrence type'
          },
          time: {
            type: 'string',
            description: 'Time of day in HH:mm format (e.g., "08:00", "14:30")'
          },
          days: {
            type: 'array',
            items: { type: 'number' },
            description: 'For weekly: array of day numbers [0-6] where 0=Sunday, 6=Saturday'
          },
          dayOfMonth: {
            type: 'number',
            description: 'For monthly: day of month (1-31)'
          },
          until: {
            type: 'string',
            description: 'Optional end date in ISO format'
          },
          timezone: {
            type: 'string',
            description: 'Optional timezone override (defaults to user timezone)'
          }
        },
        required: ['type', 'time']
      },
      reminderDetails: {
        type: 'object',
        description: 'Structured reminder payload containing dueDate/reminder/reminderRecurrence information',
        properties: {
          dueDate: { type: 'string', description: 'ISO date for reminder target (also used as dueDate)' },
          reminder: { type: 'string', description: 'Reminder interval (e.g., "30 minutes", "2 hours")' },
          reminderRecurrence: {
            type: 'object',
            description: 'Recurring reminder payload',
            properties: {
              type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
              time: { type: 'string' },
              days: { type: 'array', items: { type: 'number' } },
              dayOfMonth: { type: 'number' },
              until: { type: 'string' },
              timezone: { type: 'string' }
            }
          }
        }
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
      selectedIndex: {
        type: 'number',
        description: 'Selected index from disambiguation (when user responds with a number like "2")'
      },
      tasks: {
        type: 'array',
        description: 'Array of tasks for createMultiple operation',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            category: { type: 'string' },
            dueDate: { type: 'string' },
            reminder: { type: 'string' },
            reminderDetails: {
              type: 'object',
              properties: {
                dueDate: { type: 'string' },
                reminder: { type: 'string' },
                reminderRecurrence: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
                    time: { type: 'string' },
                    days: { type: 'array', items: { type: 'number' } },
                    dayOfMonth: { type: 'number' },
                    until: { type: 'string' },
                    timezone: { type: 'string' }
                  }
                }
              }
            },
            reminderRecurrence: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
                time: { type: 'string' },
                days: { type: 'array', items: { type: 'number' } },
                dayOfMonth: { type: 'number' },
                until: { type: 'string' },
                timezone: { type: 'string' }
              },
              required: ['type', 'time']
            }
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
            reminder: { type: 'string' },
            reminderDetails: {
              type: 'object',
              properties: {
                dueDate: { type: 'string' },
                reminder: { type: 'string' },
                reminderRecurrence: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
                    time: { type: 'string' },
                    days: { type: 'array', items: { type: 'number' } },
                    dayOfMonth: { type: 'number' },
                    until: { type: 'string' },
                    timezone: { type: 'string' }
                  }
                }
              }
            },
            reminderRecurrence: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
                time: { type: 'string' },
                days: { type: 'array', items: { type: 'number' } },
                dayOfMonth: { type: 'number' },
                until: { type: 'string' },
                timezone: { type: 'string' }
              },
              required: ['type', 'time']
            },
            completed: { type: 'boolean' }
          },
          required: []
        }
      }
    },
    required: ['operation']
  };

  constructor(
    private taskService: TaskService,
    private logger: any = logger,
    private conversationWindow: ConversationWindow = ConversationWindow.getInstance()
  ) {}

  private applyReminderDetails(target: Record<string, any>, reminderDetails?: any): void {
    if (!reminderDetails || typeof reminderDetails !== 'object') {
      return;
    }

    if (reminderDetails.dueDate !== undefined) {
      target.dueDate = reminderDetails.dueDate;
    }

    if (reminderDetails.reminder !== undefined) {
      target.reminder = reminderDetails.reminder;
    }

    if (reminderDetails.reminderRecurrence !== undefined) {
      target.reminderRecurrence = reminderDetails.reminderRecurrence;
    }
  }

  private storeRecentTasks(userPhone: string, tasks: RecentTaskSnapshot[] | RecentTaskSnapshot | null | undefined): void {
    if (!tasks) {
      return;
    }
    const taskList = Array.isArray(tasks) ? tasks : [tasks];
    this.conversationWindow.pushRecentTasks(userPhone, taskList);
  }

  async execute(args: any, userId: string): Promise<IResponse> {
    try {
      const { operation, ...params } = args;

      // Helper: resolve a taskId from natural language text when missing
      const resolveTaskId = async (): Promise<{ id: string | null; disambiguation?: string }> => {
        const resolver = new QueryResolver();
        return await resolver.resolveWithDisambiguationHandling(params, userId, 'task');
      };

      switch (operation) {
        case 'create':
          {
            const payload = { ...params };
            this.applyReminderDetails(payload, (payload as any).reminderDetails);
            delete (payload as any).reminderDetails;

            const response = await this.taskService.create({
              userPhone: userId,
              data: payload
            });

            if (response?.success && response.data) {
              this.storeRecentTasks(userId, response.data);
            }

            return response;
          }

        case 'createMultiple':
          if (!params.tasks || !Array.isArray(params.tasks) || params.tasks.length === 0) {
            return { success: false, error: 'Tasks array is required for createMultiple operation' };
          }
          {
            const items = params.tasks.map((task: any) => {
              const taskPayload = { ...task };
              this.applyReminderDetails(taskPayload, taskPayload.reminderDetails);
              delete taskPayload.reminderDetails;
              return taskPayload;
            });

            const response = await this.taskService.createMultiple({
              userPhone: userId,
              items
            });

            if (response?.success && response.data?.created) {
              this.storeRecentTasks(userId, response.data.created);
            }

            return response;
          }

        case 'get':
          {
            const resolved = await resolveTaskId();
            if (resolved.disambiguation) {
              return { success: false, error: resolved.disambiguation };
            }
            if (!resolved.id) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }
            const response = await this.taskService.getById({
              userPhone: userId,
              id: resolved.id
            });

            if (response?.success && response.data) {
              this.storeRecentTasks(userId, response.data);
            }

            return response;
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
            const payload = { ...params };
            this.applyReminderDetails(payload, (payload as any).reminderDetails);
            delete (payload as any).reminderDetails;

            const response = await this.taskService.update({
              userPhone: userId,
              id: resolved.id,
              data: payload
            });

            if (response?.success && response.data) {
              this.storeRecentTasks(userId, response.data);
            }

            return response;
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
              const updatePayload = { ...update };
              this.applyReminderDetails(updatePayload, (updatePayload as any).reminderDetails);
              delete (updatePayload as any).reminderDetails;

              const result = await this.taskService.update({
                userPhone: userId,
                id: resolvedId,
                data: updatePayload
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

          if (updateResults.length > 0) {
            this.storeRecentTasks(userId, updateResults);
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
            const response = await this.taskService.delete({
              userPhone: userId,
              id: resolved.id
            });

            if (response?.success && response.data?.id) {
              // Remove deleted task from recent context
              const remaining = this.conversationWindow
                .getRecentTasks(userId)
                .filter(task => task.id !== response.data.id && task.text !== response.data.text);
              if (remaining.length === 0) {
                this.conversationWindow.clearRecentTasks(userId);
              } else {
                this.conversationWindow.pushRecentTasks(userId, remaining, { replace: true });
              }
            }

            return response;
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

            if (deleteResults.length > 0) {
              const deletedIds = new Set(deleteResults.map((task: any) => task.id));
              const remaining = this.conversationWindow
                .getRecentTasks(userId)
                .filter(task => !deletedIds.has(task.id || ''));
              if (remaining.length === 0) {
                this.conversationWindow.clearRecentTasks(userId);
              } else {
                this.conversationWindow.pushRecentTasks(userId, remaining, { replace: true });
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
            const response = await this.taskService.complete({
              userPhone: userId,
              id: resolved.id,
              data: {}
            });

            if (response?.success && response.data) {
              this.storeRecentTasks(userId, response.data);
            }

            return response;
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
      selectedIndex: {
        type: 'number',
        description: 'Selected index from disambiguation (when user responds with a number like "2")'
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
        return await resolver.resolveWithDisambiguationHandling(params, userId, 'contact');
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
      selectedIndex: {
        type: 'number',
        description: 'Selected index from disambiguation (when user responds with a number like "2")'
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
        return await resolver.resolveWithDisambiguationHandling(params, userId, 'list');
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
