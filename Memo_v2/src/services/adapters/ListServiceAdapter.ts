/**
 * ListServiceAdapter
 * 
 * Adapter for V1 ListService.
 * Converts resolver args (listOperations) into ListService method calls.
 */

import { getListService } from '../v1-services.js';

export interface ListOperationArgs {
  operation: string;
  listId?: string;
  listName?: string;
  name?: string;
  items?: string[];
  item?: string;
  itemIndex?: number;
  isChecklist?: boolean;
  content?: string;
  selectedIndex?: number;
}

export interface ListOperationResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ListServiceAdapter {
  private userPhone: string;
  
  constructor(userPhone: string) {
    this.userPhone = userPhone;
  }
  
  /**
   * Execute a list operation
   */
  async execute(args: ListOperationArgs): Promise<ListOperationResult> {
    const { operation } = args;
    const listService = getListService();
    
    if (!listService) {
      return { success: false, error: 'ListService not available' };
    }
    
    try {
      switch (operation) {
        case 'create':
          return await this.createList(listService, args);
          
        case 'get':
          return await this.getList(listService, args);
          
        case 'getAll':
          return await this.getAllLists(listService, args);
          
        case 'update':
          return await this.updateList(listService, args);
          
        case 'delete':
          return await this.deleteList(listService, args);
          
        case 'addItem':
          return await this.addItem(listService, args);
          
        case 'toggleItem':
          return await this.toggleItem(listService, args);
          
        case 'deleteItem':
          return await this.deleteItem(listService, args);
          
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error: any) {
      console.error(`[ListServiceAdapter] Error in ${operation}:`, error);
      return { success: false, error: error.message || String(error) };
    }
  }
  
  // ========================================================================
  // OPERATION IMPLEMENTATIONS
  // ========================================================================
  
  private async createList(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    const result = await listService.create({
      userPhone: this.userPhone,
      data: {
        listName: args.name || args.listName,
        content: args.content,
        isChecklist: args.isChecklist !== false, // Default to true
        items: args.items,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async getList(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // Get all lists and filter by name
    const result = await listService.getAll({
      userPhone: this.userPhone,
    });
    
    if (!result.success) {
      return result;
    }
    
    const lists = result.data || [];
    const listName = args.listName || args.name;
    const found = lists.find((l: any) => 
      (args.listId && l.id === args.listId) ||
      (listName && l.list_name?.toLowerCase().includes(listName.toLowerCase()))
    );
    
    return {
      success: !!found,
      data: found,
      error: found ? undefined : 'List not found',
    };
  }
  
  private async getAllLists(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    const result = await listService.getAll({
      userPhone: this.userPhone,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async updateList(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // First find the list if we don't have an ID
    let listId = args.listId;
    
    if (!listId && (args.listName || args.name)) {
      const findResult = await this.getList(listService, { operation: 'get', listName: args.listName || args.name });
      if (findResult.success && findResult.data?.id) {
        listId = findResult.data.id;
      } else {
        return { success: false, error: `List not found: ${args.listName || args.name}` };
      }
    }
    
    if (!listId) {
      return { success: false, error: 'List ID is required for update' };
    }
    
    const result = await listService.update({
      userPhone: this.userPhone,
      id: listId,
      data: {
        listName: args.name || args.listName,
        content: args.content,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async deleteList(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // First find the list if we don't have an ID
    let listId = args.listId;
    
    if (!listId && (args.listName || args.name)) {
      const findResult = await this.getList(listService, { operation: 'get', listName: args.listName || args.name });
      if (findResult.success && findResult.data?.id) {
        listId = findResult.data.id;
      } else {
        return { success: false, error: `List not found: ${args.listName || args.name}` };
      }
    }
    
    if (!listId) {
      return { success: false, error: 'List ID is required for delete' };
    }
    
    const result = await listService.delete({
      userPhone: this.userPhone,
      id: listId,
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async addItem(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // Prefer listId (from EntityResolver), fall back to finding by name
    let listId = args.listId;
    
    if (!listId && (args.listName || args.name)) {
      const findResult = await this.getList(listService, { operation: 'get', listName: args.listName || args.name });
      if (findResult.success && findResult.data?.id) {
        listId = findResult.data.id;
      } else {
        return { success: false, error: `List not found: ${args.listName || args.name}` };
      }
    }
    
    if (!listId || !args.item) {
      return { success: false, error: 'List ID and item are required' };
    }
    
    // V1 ListService expects listId and itemText
    const result = await listService.addItem({
      userPhone: this.userPhone,
      data: {
        listId,
        itemText: args.item,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async toggleItem(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // Prefer listId (from EntityResolver), fall back to finding by name
    let listId = args.listId;
    
    if (!listId && (args.listName || args.name)) {
      const findResult = await this.getList(listService, { operation: 'get', listName: args.listName || args.name });
      if (findResult.success && findResult.data?.id) {
        listId = findResult.data.id;
      } else {
        return { success: false, error: `List not found: ${args.listName || args.name}` };
      }
    }
    
    if (!listId || args.itemIndex === undefined) {
      return { success: false, error: 'List ID and item index are required' };
    }
    
    // V1 ListService expects listId and itemIndex
    const result = await listService.toggleItem({
      userPhone: this.userPhone,
      data: {
        listId,
        itemIndex: args.itemIndex,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
  
  private async deleteItem(listService: any, args: ListOperationArgs): Promise<ListOperationResult> {
    // Prefer listId (from EntityResolver), fall back to finding by name
    let listId = args.listId;
    
    if (!listId && (args.listName || args.name)) {
      const findResult = await this.getList(listService, { operation: 'get', listName: args.listName || args.name });
      if (findResult.success && findResult.data?.id) {
        listId = findResult.data.id;
      } else {
        return { success: false, error: `List not found: ${args.listName || args.name}` };
      }
    }
    
    if (!listId || args.itemIndex === undefined) {
      return { success: false, error: 'List ID and item index are required' };
    }
    
    // V1 ListService expects listId and itemIndex
    const result = await listService.deleteItem({
      userPhone: this.userPhone,
      data: {
        listId,
        itemIndex: args.itemIndex,
      },
    });
    
    return {
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }
}
