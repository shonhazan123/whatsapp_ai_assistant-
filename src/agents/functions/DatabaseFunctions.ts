import { IFunction, IResponse } from '../../core/interfaces/IAgent';
import { ConversationWindow, RecentTaskSnapshot } from '../../core/memory/ConversationWindow';
import { QueryResolver } from '../../core/orchestrator/QueryResolver';
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
            enum: ['daily', 'weekly', 'monthly', 'nudge'],
            description: 'Recurrence type: daily/weekly/monthly for scheduled, nudge for interval-based (every X minutes/hours)'
          },
          time: {
            type: 'string',
            description: 'Time of day in HH:mm format (e.g., "08:00", "14:30") - ONLY for daily/weekly/monthly, NOT for nudge'
          },
          interval: {
            type: 'string',
            description: 'Interval for nudge type ONLY (e.g., "5 minutes", "10 minutes", "1 hour") - NOT for daily/weekly/monthly'
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
        required: ['type']
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
              type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
              time: { type: 'string', description: 'ONLY for daily/weekly/monthly' },
              interval: { type: 'string', description: 'ONLY for nudge (e.g., "5 minutes", "1 hour")' },
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
                    type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
                    time: { type: 'string', description: 'ONLY for daily/weekly/monthly' },
                    interval: { type: 'string', description: 'ONLY for nudge (e.g., "5 minutes")' },
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
                type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
                time: { type: 'string', description: 'ONLY for daily/weekly/monthly' },
                interval: { type: 'string', description: 'ONLY for nudge' },
                days: { type: 'array', items: { type: 'number' } },
                dayOfMonth: { type: 'number' },
                until: { type: 'string' },
                timezone: { type: 'string' }
              },
              required: ['type']
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
                    type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
                    time: { type: 'string', description: 'ONLY for daily/weekly/monthly' },
                    interval: { type: 'string', description: 'ONLY for nudge (e.g., "5 minutes")' },
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
                type: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'nudge'] },
                time: { type: 'string', description: 'ONLY for daily/weekly/monthly' },
                interval: { type: 'string', description: 'ONLY for nudge' },
                days: { type: 'array', items: { type: 'number' } },
                dayOfMonth: { type: 'number' },
                until: { type: 'string' },
                timezone: { type: 'string' }
              },
              required: ['type']
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
            // Use resolve() directly to get ALL matching tasks, not just one
            // This allows deleting multiple tasks with the same text without disambiguation
            const resolver = new QueryResolver();
            const queryText = params.text || params.taskId;
            
            if (!queryText) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }

            // If taskId is provided directly (UUID), use it
            if (params.taskId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.taskId)) {
              const response = await this.taskService.delete({
                userPhone: userId,
                id: params.taskId
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

            // Otherwise, resolve by text and delete ALL matching tasks
            const resolutionResult = await resolver.resolve(queryText, userId, 'task');
            if (resolutionResult.candidates.length === 0) {
              return { success: false, error: 'Task not found (provide taskId or recognizable text)' };
            }

            // Delete all matching tasks
            const deleteResults = [];
            const deleteErrors = [];
            const deletedIds = new Set<string>();

            for (const candidate of resolutionResult.candidates) {
              if (!candidate.entity?.id) continue;
              
              try {
                const result = await this.taskService.delete({
                  userPhone: userId,
                  id: candidate.entity.id
                });

                if (result.success && result.data) {
                  deleteResults.push(result.data);
                  deletedIds.add(result.data.id);
                } else {
                  deleteErrors.push({ taskId: candidate.entity.id, error: result.error });
                }
              } catch (error) {
                deleteErrors.push({ 
                  taskId: candidate.entity.id, 
                  error: error instanceof Error ? error.message : 'Unknown error' 
                });
              }
            }

            // Update recent tasks context
            if (deletedIds.size > 0) {
              const remaining = this.conversationWindow
                .getRecentTasks(userId)
                .filter(task => !deletedIds.has(task.id || ''));
              if (remaining.length === 0) {
                this.conversationWindow.clearRecentTasks(userId);
              } else {
                this.conversationWindow.pushRecentTasks(userId, remaining, { replace: true });
              }
            }

            // Return success if at least one task was deleted
            if (deleteResults.length > 0) {
              return {
                success: deleteErrors.length === 0,
                data: deleteResults.length === 1 ? deleteResults[0] : { deleted: deleteResults, count: deleteResults.length },
                error: deleteErrors.length > 0 ? `Some tasks could not be deleted: ${deleteErrors.map(e => e.error).join(', ')}` : undefined
              };
            }

            return { 
              success: false, 
              error: deleteErrors.length > 0 
                ? deleteErrors.map(e => e.error).join(', ') 
                : 'Failed to delete tasks' 
            };
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
                // Use resolve() directly to get ALL matching tasks, not just one
                // This allows deleting multiple tasks with the same text without disambiguation
                const resolutionResult = await new QueryResolver().resolve(t.text, userId, 'task');
                if (resolutionResult.candidates.length === 0) {
                  deleteErrors.push({ taskText: t.text, error: 'Task not found' });
                  continue;
                }
                // Collect IDs from ALL candidates (handles multiple tasks with same text)
                for (const candidate of resolutionResult.candidates) {
                  if (candidate.entity?.id && !ids.includes(candidate.entity.id)) {
                    ids.push(candidate.entity.id);
                  }
                }
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
  description = 'Get comprehensive user data including tasks , lists, and statistics';

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
            includeLists: params.includeLists,
            taskFilters: params.taskFilters,
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
