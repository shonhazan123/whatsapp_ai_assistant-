import { ContactService } from '../services/database/ContactService';
import { ListService } from '../services/database/ListService';
import { TaskService } from '../services/database/TaskService';
import { IToolset, ToolResult } from '../types/interfaces';
import { ContactSchema, TaskSchema } from '../types/schema';
import { logger } from '../utils/logger';

/**
 * DatabaseToolset - Clean CRUD operations for tasks, contacts, and lists
 * No LLM, just pure database operations
 */
export class DatabaseToolset implements IToolset {
  name = 'DatabaseToolset';
  description = 'Handles all Supabase/PostgreSQL CRUD operations for tasks, contacts, and lists';

  private taskService: TaskService;
  private contactService: ContactService;
  private listService: ListService;

  constructor() {
    this.taskService = new TaskService(logger);
    this.contactService = new ContactService(logger);
    this.listService = new ListService(logger);
  }

  async execute(operation: string, params: any): Promise<ToolResult> {
    try {
      logger.info(`🔧 DatabaseToolset.${operation}`, { params });

      switch (operation) {
        // Task operations
        case 'task.create':
          return await this.createTask(params);
        case 'task.createMultiple':
          return await this.createMultipleTasks(params);
        case 'task.getAll':
          return await this.getAllTasks(params);
        case 'task.getById':
          return await this.getTaskById(params);
        case 'task.update':
          return await this.updateTask(params);
        case 'task.updateMultiple':
          return await this.updateMultipleTasks(params);
        case 'task.delete':
          return await this.deleteTask(params);
        case 'task.deleteMultiple':
          return await this.deleteMultipleTasks(params);
        case 'task.complete':
          return await this.completeTask(params);
        case 'task.addSubtask':
          return await this.addSubtask(params);

        // Contact operations
        case 'contact.create':
          return await this.createContact(params);
        case 'contact.createMultiple':
          return await this.createMultipleContacts(params);
        case 'contact.getAll':
          return await this.getAllContacts(params);
        case 'contact.search':
          return await this.searchContact(params);
        case 'contact.update':
          return await this.updateContact(params);
        case 'contact.delete':
          return await this.deleteContact(params);

        // List operations
        case 'list.create':
          return await this.createList(params);
        case 'list.getAll':
          return await this.getAllLists(params);
        case 'list.update':
          return await this.updateList(params);
        case 'list.delete':
          return await this.deleteList(params);
        case 'list.addItem':
          return await this.addListItem(params);
        case 'list.toggleItem':
          return await this.toggleListItem(params);
        case 'list.deleteItem':
          return await this.deleteListItem(params);

        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`
          };
      }
    } catch (error) {
      logger.error(`DatabaseToolset error in ${operation}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // ============ TASK OPERATIONS ============

  private async createTask(params: any): Promise<ToolResult> {
    // Restructure params: LLM sends flat structure, service expects { data: {...} }
    const data = {
      text: params.text,
      priority: params.priority,
      dueDate: params.dueDate
    };
    const validated = TaskSchema.parse(data);
    const response = await this.taskService.create({
      userPhone: params.userPhone,
      data: validated
    });
    return this.toToolResult(response);
  }

  private async createMultipleTasks(params: any): Promise<ToolResult> {
    const response = await this.taskService.createMultiple({
      userPhone: params.userPhone,
      items: params.items
    });
    return this.toToolResult(response);
  }

  private async getAllTasks(params: any): Promise<ToolResult> {
    const response = await this.taskService.getAll({
      userPhone: params.userPhone,
      filters: params.filters,
      limit: params.limit,
      offset: params.offset
    });
    return this.toToolResult(response);
  }

  private async getTaskById(params: any): Promise<ToolResult> {
    const response = await this.taskService.getById({
      userPhone: params.userPhone,
      id: params.id
    });
    return this.toToolResult(response);
  }

  private async updateTask(params: any): Promise<ToolResult> {
    const response = await this.taskService.update({
      userPhone: params.userPhone,
      id: params.id,
      data: params.data
    });
    return this.toToolResult(response);
  }

  private async updateMultipleTasks(params: any): Promise<ToolResult> {
    const results = [];
    const errors = [];

    for (const item of params.items) {
      try {
        const response = await this.taskService.update({
          userPhone: params.userPhone,
          id: item.id,
          data: item.data
        });
        if (response.success) {
          results.push(response.data);
        } else {
          errors.push({ id: item.id, error: response.message });
        }
      } catch (error) {
        errors.push({ id: item.id, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return {
      success: results.length > 0,
      data: { updated: results, errors },
      message: `Updated ${results.length} tasks${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    };
  }

  private async deleteTask(params: any): Promise<ToolResult> {
    const response = await this.taskService.delete({
      userPhone: params.userPhone,
      id: params.id
    });
    return this.toToolResult(response);
  }

  private async deleteMultipleTasks(params: any): Promise<ToolResult> {
    const results = [];
    const errors = [];

    for (const id of params.ids) {
      try {
        const response = await this.taskService.delete({
          userPhone: params.userPhone,
          id
        });
        if (response.success) {
          results.push(id);
        } else {
          errors.push({ id, error: response.message });
        }
      } catch (error) {
        errors.push({ id, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }

    return {
      success: results.length > 0,
      data: { deleted: results, errors },
      message: `Deleted ${results.length} tasks${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    };
  }

  private async completeTask(params: any): Promise<ToolResult> {
    const response = await this.taskService.complete({
      userPhone: params.userPhone,
      id: params.id,
      data: { completed: true }
    });
    return this.toToolResult(response);
  }

  private async addSubtask(params: any): Promise<ToolResult> {
    const response = await this.taskService.addSubtask({
      userPhone: params.userPhone,
      data: {
        taskId: params.taskId,
        text: params.text
      }
    });
    return this.toToolResult(response);
  }

  // ============ CONTACT OPERATIONS ============

  private async createContact(params: any): Promise<ToolResult> {
    // Restructure params: LLM sends flat structure, service expects { data: {...} }
    const data = {
      name: params.name,
      email: params.email,
      phone_number: params.phone_number
    };
    const validated = ContactSchema.parse(data);
    const response = await this.contactService.create({
      userPhone: params.userPhone,
      data: validated
    });
    return this.toToolResult(response);
  }

  private async createMultipleContacts(params: any): Promise<ToolResult> {
    const response = await this.contactService.createMultiple({
      userPhone: params.userPhone,
      items: params.items
    });
    return this.toToolResult(response);
  }

  private async getAllContacts(params: any): Promise<ToolResult> {
    const response = await this.contactService.getAll({
      userPhone: params.userPhone
    });
    return this.toToolResult(response);
  }

  private async searchContact(params: any): Promise<ToolResult> {
    const response = await this.contactService.search({
      userPhone: params.userPhone,
      filters: {
        name: params.name
      }
    });
    return this.toToolResult(response);
  }

  private async updateContact(params: any): Promise<ToolResult> {
    const response = await this.contactService.update({
      userPhone: params.userPhone,
      id: params.id,
      data: params.data
    });
    return this.toToolResult(response);
  }

  private async deleteContact(params: any): Promise<ToolResult> {
    const response = await this.contactService.delete({
      userPhone: params.userPhone,
      id: params.id
    });
    return this.toToolResult(response);
  }

  // ============ LIST OPERATIONS ============

  private async createList(params: any): Promise<ToolResult> {
    // Restructure params: LLM sends flat structure, service expects { data: {...} }
    // ListService expects: listName, isChecklist, content, items
    const data = {
      listName: params.listName,
      isChecklist: params.isChecklist || false,
      content: params.content,
      items: params.items || []
    };
    // Skip Zod validation - ListService does its own validation
    const response = await this.listService.create({
      userPhone: params.userPhone,
      data
    });
    return this.toToolResult(response);
  }

  private async getAllLists(params: any): Promise<ToolResult> {
    const response = await this.listService.getAll({
      userPhone: params.userPhone
    });
    return this.toToolResult(response);
  }

  private async updateList(params: any): Promise<ToolResult> {
    const response = await this.listService.update({
      userPhone: params.userPhone,
      id: params.id,
      data: params.data
    });
    return this.toToolResult(response);
  }

  private async deleteList(params: any): Promise<ToolResult> {
    const response = await this.listService.delete({
      userPhone: params.userPhone,
      id: params.id
    });
    return this.toToolResult(response);
  }

  private async addListItem(params: any): Promise<ToolResult> {
    logger.info(`📝 Adding item to list: listId=${params.listId}, text="${params.text}"`);
    const response = await this.listService.addItem({
      userPhone: params.userPhone,
      id: '',  // Not used by addItem
      data: {
        listId: params.listId,
        itemText: params.text
      }
    });
    logger.info(`📤 Add item result: success=${response.success}, message=${response.message}`);
    return this.toToolResult(response);
  }

  private async toggleListItem(params: any): Promise<ToolResult> {
    const response = await this.listService.toggleItem({
      userPhone: params.userPhone,
      id: '',  // Not used
      data: {
        listId: params.listId,
        itemIndex: params.itemIndex
      }
    });
    return this.toToolResult(response);
  }

  private async deleteListItem(params: any): Promise<ToolResult> {
    const response = await this.listService.deleteItem({
      userPhone: params.userPhone,
      id: '',  // Not used
      data: {
        listId: params.listId,
        itemIndex: params.itemIndex
      }
    });
    return this.toToolResult(response);
  }

  // ============ HELPER METHODS ============

  private toToolResult(serviceResponse: any): ToolResult {
    return {
      success: serviceResponse.success,
      data: serviceResponse.data,
      error: serviceResponse.message && !serviceResponse.success ? serviceResponse.message : undefined,
      message: serviceResponse.message
    };
  }
}

