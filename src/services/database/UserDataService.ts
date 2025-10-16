import { BaseService } from './BaseService';
import { TaskService, TaskFilters } from './TaskService';
import { ContactService, ContactFilters } from './ContactService';
import { ListService, ListFilters } from './ListService';
import { logger } from '../../utils/logger';
import { IResponse, GetRequest } from '../../core/types/AgentTypes';

export interface UserDataOverview {
  tasks: {
    total: number;
    completed: number;
    pending: number;
    recent: any[];
  };
  contacts: {
    total: number;
    recent: any[];
  };
  lists: {
    total: number;
    notes: number;
    checklists: number;
    recent: any[];
  };
}

export interface UserDataRequest extends GetRequest {
  includeTasks?: boolean;
  includeContacts?: boolean;
  includeLists?: boolean;
  taskFilters?: TaskFilters;
  contactFilters?: ContactFilters;
  listFilters?: ListFilters;
  limit?: number;
}

export class UserDataService extends BaseService {
  constructor(
    private taskService: TaskService,
    private contactService: ContactService,
    private listService: ListService,
    loggerInstance: any = logger
  ) {
    super(loggerInstance);
  }

  async getOverview(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      // Get tasks summary
      const tasksResponse = await this.taskService.getAll({
        ...request,
        limit: 10
      });

      const tasks = tasksResponse.success ? tasksResponse.data?.tasks || [] : [];
      const completedTasks = tasks.filter((task: any) => task.completed);
      const pendingTasks = tasks.filter((task: any) => !task.completed);

      // Get contacts summary
      const contactsResponse = await this.contactService.getAll({
        ...request,
        limit: 10
      });

      const contacts = contactsResponse.success ? contactsResponse.data?.contacts || [] : [];

      // Get lists summary
      const listsResponse = await this.listService.getAll({
        ...request,
        limit: 10
      });

      const lists = listsResponse.success ? listsResponse.data?.lists || [] : [];
      const notes = lists.filter((list: any) => list.list_name === 'note');
      const checklists = lists.filter((list: any) => list.list_name === 'checklist');

      const overview: UserDataOverview = {
        tasks: {
          total: tasks.length,
          completed: completedTasks.length,
          pending: pendingTasks.length,
          recent: tasks.slice(0, 5)
        },
        contacts: {
          total: contacts.length,
          recent: contacts.slice(0, 5)
        },
        lists: {
          total: lists.length,
          notes: notes.length,
          checklists: checklists.length,
          recent: lists.slice(0, 5)
        }
      };

      this.logger.info(`✅ User data overview retrieved for user: ${userId}`);
      
      return this.createSuccessResponse(overview);
    } catch (error) {
      this.logger.error('Error getting user data overview:', error);
      return this.createErrorResponse('Failed to get user data overview');
    }
  }

  async getAllData(request: UserDataRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const results: any = {};

      // Get tasks if requested
      if (request.includeTasks !== false) {
        const tasksResponse = await this.taskService.getAll({
          ...request,
          filters: request.taskFilters
        });
        results.tasks = tasksResponse.success ? tasksResponse.data : null;
        results.tasksError = tasksResponse.success ? null : tasksResponse.error;
      }

      // Get contacts if requested
      if (request.includeContacts !== false) {
        const contactsResponse = await this.contactService.getAll({
          ...request,
          filters: request.contactFilters
        });
        results.contacts = contactsResponse.success ? contactsResponse.data : null;
        results.contactsError = contactsResponse.success ? null : contactsResponse.error;
      }

      // Get lists if requested
      if (request.includeLists !== false) {
        const listsResponse = await this.listService.getAll({
          ...request,
          filters: request.listFilters
        });
        results.lists = listsResponse.success ? listsResponse.data : null;
        results.listsError = listsResponse.success ? null : listsResponse.error;
      }

      // Calculate totals
      const totals = {
        tasks: results.tasks?.count || 0,
        contacts: results.contacts?.count || 0,
        lists: results.lists?.count || 0
      };

      this.logger.info(`✅ All user data retrieved for user: ${userId}`);
      
      return this.createSuccessResponse({
        data: results,
        totals,
        userId
      });
    } catch (error) {
      this.logger.error('Error getting all user data:', error);
      return this.createErrorResponse('Failed to get user data');
    }
  }

  async searchAll(request: GetRequest & { query: string }): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      const results: any = {};

      // Search tasks
      const tasksResponse = await this.taskService.getAll({
        ...request,
        filters: { text: request.query } as any
      });
      results.tasks = tasksResponse.success ? tasksResponse.data : null;

      // Search contacts
      const contactsResponse = await this.contactService.search({
        ...request,
        filters: { name: request.query }
      });
      results.contacts = contactsResponse.success ? contactsResponse.data : null;

      // Search lists
      const listsResponse = await this.listService.getAll({
        ...request,
        filters: { title: request.query }
      });
      results.lists = listsResponse.success ? listsResponse.data : null;

      this.logger.info(`✅ Search completed for user: ${userId}, query: ${request.query}`);
      
      return this.createSuccessResponse(results);
    } catch (error) {
      this.logger.error('Error searching user data:', error);
      return this.createErrorResponse('Failed to search user data');
    }
  }

  async getStatistics(request: GetRequest): Promise<IResponse> {
    try {
      const userId = await this.ensureUserExists(request.userPhone);
      
      // Get all tasks for statistics
      const tasksResponse = await this.taskService.getAll(request);
      const tasks = tasksResponse.success ? tasksResponse.data?.tasks || [] : [];

      // Get all contacts for statistics
      const contactsResponse = await this.contactService.getAll(request);
      const contacts = contactsResponse.success ? contactsResponse.data?.contacts || [] : [];

      // Get all lists for statistics
      const listsResponse = await this.listService.getAll(request);
      const lists = listsResponse.success ? listsResponse.data?.lists || [] : [];

      // Calculate statistics
      const stats = {
        tasks: {
          total: tasks.length,
          completed: tasks.filter((task: any) => task.completed).length,
          pending: tasks.filter((task: any) => !task.completed).length,
          byCategory: this.groupBy(tasks, 'category'),
          completionRate: tasks.length > 0 ? (tasks.filter((task: any) => task.completed).length / tasks.length) * 100 : 0
        },
        contacts: {
          total: contacts.length,
          withEmail: contacts.filter((contact: any) => contact.email).length,
          withPhone: contacts.filter((contact: any) => contact.phone_number).length
        },
        lists: {
          total: lists.length,
          notes: lists.filter((list: any) => list.list_name === 'note').length,
          checklists: lists.filter((list: any) => list.list_name === 'checklist').length,
          totalItems: lists.reduce((sum: number, list: any) => sum + (list.content?.items?.length || 0), 0)
        }
      };

      this.logger.info(`✅ Statistics generated for user: ${userId}`);
      
      return this.createSuccessResponse(stats);
    } catch (error) {
      this.logger.error('Error getting user statistics:', error);
      return this.createErrorResponse('Failed to get user statistics');
    }
  }

  private groupBy(array: any[], key: string): Record<string, number> {
    return array.reduce((groups: Record<string, number>, item: any) => {
      const value = item[key] || 'Uncategorized';
      groups[value] = (groups[value] || 0) + 1;
      return groups;
    }, {});
  }
}
