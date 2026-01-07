/**
 * DatabaseEntityResolver
 * 
 * Resolves database entities (tasks and lists) from natural language to IDs.
 * Ports V1 logic from DatabaseFunctions.ts including:
 * - QueryResolver integration for fuzzy matching
 * - Smart disambiguation for tasks with same/similar names
 * - Field comparison (recurring, nudge, category) for identity check
 * - Delete ALL matching behavior (V1's delete behavior)
 */

import { QueryResolverAdapter } from '../../utils/QueryResolverAdapter.js';
import { getListService, getTaskService } from '../v1-services.js';
import {
    RESOLUTION_THRESHOLDS,
    getDisambiguationMessage,
    getOperationBehavior,
    translateReminderType,
} from './resolution-config.js';
import type {
    EntityResolverContext,
    IEntityResolver,
    ResolutionCandidate,
    ResolutionOutput,
    TaskComparison,
    TaskGroups,
} from './types.js';

// ============================================================================
// DATABASE ENTITY RESOLVER
// ============================================================================

export class DatabaseEntityResolver implements IEntityResolver {
  readonly domain = 'database' as const;
  
  /**
   * Resolve database entities from operation args
   */
  async resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Determine if this is task or list operation
    const isListOperation = this.isListOperation(args);
    
    if (isListOperation) {
      return this.resolveList(operation, args, context);
    } else {
      return this.resolveTask(operation, args, context);
    }
  }
  
  /**
   * Apply user's disambiguation selection
   */
  async applySelection(
    selection: number | number[] | string,
    candidates: ResolutionCandidate[],
    args: Record<string, any>
  ): Promise<ResolutionOutput> {
    const isListOperation = this.isListOperation(args);
    
    // Handle "both" or "all" selection
    if (typeof selection === 'string') {
      const lowerSelection = selection.toLowerCase();
      if (lowerSelection === 'both' || lowerSelection === 'all' || 
          lowerSelection === 'שניהם' || lowerSelection === 'כולם') {
        if (isListOperation) {
          return {
            type: 'resolved',
            resolvedIds: candidates.map(c => c.id),
            args: { ...args, listIds: candidates.map(c => c.id) },
          };
        } else {
          return {
            type: 'resolved',
            resolvedIds: candidates.map(c => c.id),
            args: { ...args, taskIds: candidates.map(c => c.id) },
          };
        }
      }
      
      // Try to parse as number
      const parsed = parseInt(selection, 10);
      if (!isNaN(parsed)) {
        selection = parsed;
      } else {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
    }
    
    // Handle array selection
    if (Array.isArray(selection)) {
      const selectedCandidates = selection
        .map(idx => candidates[idx - 1])
        .filter(Boolean);
      
      if (selectedCandidates.length === 0) {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
      
      if (isListOperation) {
        return {
          type: 'resolved',
          resolvedIds: selectedCandidates.map(c => c.id),
          args: { 
            ...args, 
            listId: selectedCandidates[0].id,
            listIds: selectedCandidates.map(c => c.id),
          },
        };
      } else {
        return {
          type: 'resolved',
          resolvedIds: selectedCandidates.map(c => c.id),
          args: { 
            ...args, 
            taskId: selectedCandidates[0].id,
            taskIds: selectedCandidates.map(c => c.id),
          },
        };
      }
    }
    
    // Handle single number selection (1-based)
    const index = selection - 1;
    if (index < 0 || index >= candidates.length) {
      return {
        type: 'disambiguation',
        candidates,
        question: 'Invalid selection. Please reply with a number.',
      };
    }
    
    const selected = candidates[index];
    if (isListOperation) {
      return {
        type: 'resolved',
        resolvedIds: [selected.id],
        args: { ...args, listId: selected.id },
      };
    } else {
      return {
        type: 'resolved',
        resolvedIds: [selected.id],
        args: { ...args, taskId: selected.id },
      };
    }
  }
  
  // ==========================================================================
  // TASK RESOLUTION
  // ==========================================================================
  
  /**
   * Resolve task entity
   */
  private async resolveTask(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Operations that need resolution
    const operationsNeedingResolution = [
      'get', 'update', 'delete', 'complete', 'addSubtask'
    ];
    
    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }
    
    // Already has taskId (and it's a valid UUID)?
    if (args.taskId && this.isValidUUID(args.taskId)) {
      return { type: 'resolved', args };
    }
    
    const searchText = args.text || args.taskText || args.taskId;
    if (!searchText) {
      return {
        type: 'clarify_query',
        error: 'No task description provided',
        searchedFor: '',
        suggestions: ['Provide task name or description'],
      };
    }
    
    // Fetch all user tasks
    const tasks = await this.fetchTasks(context.userPhone);
    if (tasks.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('task_not_found', context.language, { searchedFor: searchText }),
        searchedFor: searchText,
      };
    }
    
    // Fuzzy match
    const candidates = this.fuzzyMatchTasks(searchText, tasks);
    
    if (candidates.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('task_not_found', context.language, { searchedFor: searchText }),
        searchedFor: searchText,
      };
    }
    
    // Apply smart disambiguation logic
    return this.evaluateTaskCandidates(candidates, operation, args, context);
  }
  
  /**
   * Smart disambiguation logic for tasks
   * 
   * Rules (from user requirements):
   * 1. Exactly same text AND same fields → treat as one (delete/update all)
   * 2. Same text but DIFFERENT fields (recurring vs normal) → disambiguate
   * 3. Similar text (fuzzy) → ask "which one or both?"
   * 4. High confidence single match → use it directly
   */
  private evaluateTaskCandidates(
    candidates: ResolutionCandidate[],
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): ResolutionOutput {
    // Single match
    if (candidates.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, taskId: candidates[0].id },
      };
    }
    
    // Get operation behavior
    const behavior = getOperationBehavior('database.task', operation);
    
    // Group candidates by similarity
    const groups = this.groupTasksBySimilarity(candidates);
    
    // Case 1: All candidates are EXACTLY the same (text + fields)
    if (groups.identical.length > 0 && 
        groups.sameTextDifferentFields.length === 0 && 
        groups.similar.length === 0) {
      // Delete/update all without disambiguation (V1 behavior)
      if (operation === 'delete' || behavior.multipleMatchBehavior === 'all') {
        return {
          type: 'resolved',
          resolvedIds: groups.identical.map(c => c.id),
          args: { ...args, taskIds: groups.identical.map(c => c.id) },
        };
      }
      // For update, still need to apply to all
      return {
        type: 'resolved',
        resolvedIds: groups.identical.map(c => c.id),
        args: { ...args, taskIds: groups.identical.map(c => c.id) },
      };
    }
    
    // Case 2: Same text but DIFFERENT fields (e.g., recurring vs normal)
    if (groups.sameTextDifferentFields.length > 0) {
      return {
        type: 'disambiguation',
        candidates: groups.sameTextDifferentFields.slice(0, 5),
        question: this.buildFieldDifferenceQuestion(groups.sameTextDifferentFields.slice(0, 5), context.language),
        allowMultiple: false,  // Must choose one
      };
    }
    
    // Case 3: Similar text (fuzzy match) - ask "which one or both?"
    if (groups.similar.length > 1) {
      // For delete operation, offer "both" option
      if (operation === 'delete') {
        return {
          type: 'disambiguation',
          candidates: groups.similar.slice(0, 5),
          question: this.buildSimilarTextQuestion(groups.similar.slice(0, 5), context.language),
          allowMultiple: true,  // Can choose "both"
        };
      }
      
      // For other operations, must choose one
      return {
        type: 'disambiguation',
        candidates: groups.similar.slice(0, 5),
        question: this.buildGeneralQuestion(groups.similar.slice(0, 5), context.language),
        allowMultiple: false,
      };
    }
    
    // Case 4: Check score gap for high confidence
    const scoreGap = candidates[0].score - candidates[1].score;
    if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, taskId: candidates[0].id },
      };
    }
    
    // Default: disambiguate
    return {
      type: 'disambiguation',
      candidates: candidates.slice(0, 5),
      question: this.buildGeneralQuestion(candidates.slice(0, 5), context.language),
      allowMultiple: operation === 'delete',
    };
  }
  
  /**
   * Group tasks by similarity type
   */
  private groupTasksBySimilarity(candidates: ResolutionCandidate[]): TaskGroups {
    const groups: TaskGroups = {
      identical: [],
      sameTextDifferentFields: [],
      similar: [],
      different: [],
    };
    
    if (candidates.length === 0) return groups;
    if (candidates.length === 1) {
      groups.similar.push(candidates[0]);
      return groups;
    }
    
    // Track which candidates have been grouped
    const grouped = new Set<string>();
    
    // Compare each pair
    for (let i = 0; i < candidates.length; i++) {
      const current = candidates[i];
      if (grouped.has(current.id)) continue;
      
      let foundIdentical = false;
      let foundSameTextDiffFields = false;
      
      for (let j = i + 1; j < candidates.length; j++) {
        const other = candidates[j];
        if (grouped.has(other.id)) continue;
        
        const comparison = this.compareTaskFields(current, other);
        
        if (comparison.textMatch === 'exact' && comparison.fieldsMatch) {
          // Identical
          if (!grouped.has(current.id)) {
            groups.identical.push(current);
            grouped.add(current.id);
          }
          groups.identical.push(other);
          grouped.add(other.id);
          foundIdentical = true;
        } else if (comparison.textMatch === 'exact' && !comparison.fieldsMatch) {
          // Same text, different fields
          if (!grouped.has(current.id)) {
            groups.sameTextDifferentFields.push(current);
            grouped.add(current.id);
          }
          groups.sameTextDifferentFields.push(other);
          grouped.add(other.id);
          foundSameTextDiffFields = true;
        }
      }
      
      // If current wasn't matched with anything, add to similar
      if (!grouped.has(current.id)) {
        groups.similar.push(current);
        grouped.add(current.id);
      }
    }
    
    return groups;
  }
  
  /**
   * Compare two task candidates for field differences
   */
  private compareTaskFields(a: ResolutionCandidate, b: ResolutionCandidate): TaskComparison {
    const taskA = a.entity;
    const taskB = b.entity;
    
    // Text comparison
    const textA = (taskA.text || '').toLowerCase().trim();
    const textB = (taskB.text || '').toLowerCase().trim();
    
    let textMatch: 'exact' | 'similar' | 'different';
    if (textA === textB) {
      textMatch = 'exact';
    } else if (a.score >= RESOLUTION_THRESHOLDS.EXACT_MATCH && b.score >= RESOLUTION_THRESHOLDS.EXACT_MATCH) {
      textMatch = 'similar';
    } else {
      textMatch = 'different';
    }
    
    // Field comparison
    const reminderTypeA = this.getReminderType(taskA);
    const reminderTypeB = this.getReminderType(taskB);
    const categoryA = (taskA.category || '').toLowerCase();
    const categoryB = (taskB.category || '').toLowerCase();
    const hasDueDateA = !!taskA.dueDate || !!taskA.due_date;
    const hasDueDateB = !!taskB.dueDate || !!taskB.due_date;
    
    const fieldsMatch = 
      reminderTypeA === reminderTypeB &&
      categoryA === categoryB &&
      hasDueDateA === hasDueDateB;
    
    const fieldDifferences: string[] = [];
    if (reminderTypeA !== reminderTypeB) {
      fieldDifferences.push(`reminder: ${reminderTypeA} vs ${reminderTypeB}`);
    }
    if (categoryA !== categoryB) {
      fieldDifferences.push(`category: ${categoryA || 'none'} vs ${categoryB || 'none'}`);
    }
    if (hasDueDateA !== hasDueDateB) {
      fieldDifferences.push(`due date: ${hasDueDateA ? 'yes' : 'no'} vs ${hasDueDateB ? 'yes' : 'no'}`);
    }
    
    return { textMatch, fieldsMatch, fieldDifferences };
  }
  
  /**
   * Get reminder type from task
   */
  private getReminderType(task: any): string {
    const recurrence = task.reminderRecurrence || task.reminder_recurrence;
    if (recurrence?.type === 'nudge') return 'nudge';
    if (recurrence?.type) return recurrence.type;
    if ((task.dueDate || task.due_date) && task.reminder) return 'one-time';
    return 'none';
  }
  
  /**
   * Fetch all tasks for user
   */
  private async fetchTasks(userPhone: string): Promise<any[]> {
    const taskService = getTaskService();
    if (!taskService) return [];
    
    try {
      const result = await taskService.getAll({
        userPhone,
        filters: { completed: false },
      });
      
      if (result.success && result.data?.tasks) {
        return result.data.tasks;
      }
      if (result.success && Array.isArray(result.data)) {
        return result.data;
      }
    } catch (error) {
      console.error('[DatabaseEntityResolver] Failed to fetch tasks:', error);
    }
    
    return [];
  }
  
  /**
   * Fuzzy match tasks against search text
   */
  private fuzzyMatchTasks(searchText: string, tasks: any[]): ResolutionCandidate[] {
    // Use QueryResolverAdapter for consistent matching
    const result = QueryResolverAdapter.resolveTasks(searchText, tasks);
    
    return result.candidates.map(c => ({
      id: c.entity.id,
      displayText: this.formatTaskDisplay(c.entity),
      entity: c.entity,
      score: c.score,
      metadata: {
        reminderType: this.getReminderType(c.entity),
        category: c.entity.category,
        hasDueDate: !!(c.entity.dueDate || c.entity.due_date),
      },
    }));
  }
  
  /**
   * Format task for display
   */
  private formatTaskDisplay(task: any): string {
    const text = task.text || 'Untitled Task';
    const reminderType = this.getReminderType(task);
    
    if (reminderType !== 'none') {
      return `${text} (${reminderType})`;
    }
    
    if (task.category) {
      return `${text} [${task.category}]`;
    }
    
    return text;
  }
  
  // ==========================================================================
  // LIST RESOLUTION
  // ==========================================================================
  
  /**
   * Resolve list entity
   */
  private async resolveList(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Operations that need resolution
    const operationsNeedingResolution = [
      'get', 'update', 'delete', 'addItem', 'toggleItem', 'deleteItem'
    ];
    
    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }
    
    // Already has listId (and it's a valid UUID)?
    if (args.listId && this.isValidUUID(args.listId)) {
      return { type: 'resolved', args };
    }
    
    const searchText = args.listName || args.name || args.listId;
    if (!searchText) {
      return {
        type: 'clarify_query',
        error: 'No list name provided',
        searchedFor: '',
        suggestions: ['Provide list name'],
      };
    }
    
    // Fetch all user lists
    const lists = await this.fetchLists(context.userPhone);
    if (lists.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('list_not_found', context.language, { searchedFor: searchText }),
        searchedFor: searchText,
      };
    }
    
    // Fuzzy match
    const candidates = this.fuzzyMatchLists(searchText, lists);
    
    if (candidates.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('list_not_found', context.language, { searchedFor: searchText }),
        searchedFor: searchText,
      };
    }
    
    // Single match
    if (candidates.length === 1) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, listId: candidates[0].id },
      };
    }
    
    // Check score gap
    const scoreGap = candidates[0].score - candidates[1].score;
    if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
      return {
        type: 'resolved',
        resolvedIds: [candidates[0].id],
        args: { ...args, listId: candidates[0].id },
      };
    }
    
    // Need disambiguation
    return {
      type: 'disambiguation',
      candidates: candidates.slice(0, 5),
      question: this.buildListDisambiguationQuestion(candidates.slice(0, 5), context.language),
      allowMultiple: false,
    };
  }
  
  /**
   * Fetch all lists for user
   */
  private async fetchLists(userPhone: string): Promise<any[]> {
    const listService = getListService();
    if (!listService) return [];
    
    try {
      const result = await listService.getAll({ userPhone });
      
      if (result.success && result.data?.lists) {
        return result.data.lists;
      }
      if (result.success && Array.isArray(result.data)) {
        return result.data;
      }
    } catch (error) {
      console.error('[DatabaseEntityResolver] Failed to fetch lists:', error);
    }
    
    return [];
  }
  
  /**
   * Fuzzy match lists against search text
   */
  private fuzzyMatchLists(searchText: string, lists: any[]): ResolutionCandidate[] {
    const result = QueryResolverAdapter.resolveLists(searchText, lists);
    
    return result.candidates.map(c => ({
      id: c.entity.id,
      displayText: c.entity.list_name || c.entity.name || 'Untitled List',
      entity: c.entity,
      score: c.score,
      metadata: {
        isChecklist: c.entity.is_checklist || c.entity.isChecklist,
        itemCount: c.entity.items?.length || 0,
      },
    }));
  }
  
  // ==========================================================================
  // DISAMBIGUATION MESSAGES
  // ==========================================================================
  
  /**
   * Build disambiguation question for field differences
   */
  private buildFieldDifferenceQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => {
      const task = c.entity;
      const reminderType = this.getReminderType(task);
      const extra = reminderType !== 'none' 
        ? ` (${translateReminderType(reminderType, language)})` 
        : '';
      return `${i + 1}. ${c.displayText}${extra}`;
    });
    
    const optionsText = lines.join('\n');
    return getDisambiguationMessage('task_same_text_different_fields', language, { options: optionsText });
  }
  
  /**
   * Build disambiguation question for similar text
   */
  private buildSimilarTextQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');
    return getDisambiguationMessage('task_multiple_similar', language, { options: optionsText });
  }
  
  /**
   * Build general disambiguation question
   */
  private buildGeneralQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');
    
    if (language === 'he') {
      return `מצאתי כמה משימות תואמות:\n${optionsText}\n\nאיזו התכוונת?`;
    }
    return `I found multiple matching tasks:\n${optionsText}\n\nWhich one did you mean?`;
  }
  
  /**
   * Build list disambiguation question
   */
  private buildListDisambiguationQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, i) => `${i + 1}. ${c.displayText}`);
    const optionsText = lines.join('\n');
    return getDisambiguationMessage('list_multiple', language, { options: optionsText });
  }
  
  // ==========================================================================
  // UTILITY METHODS
  // ==========================================================================
  
  /**
   * Check if this is a list operation based on args
   */
  private isListOperation(args: Record<string, any>): boolean {
    // If it has list-specific fields, it's a list operation
    if (args.listId || args.listName || args.isChecklist !== undefined) {
      return true;
    }
    
    // If it has task-specific fields, it's a task operation
    if (args.taskId || args.dueDate || args.reminder || args.reminderRecurrence) {
      return false;
    }
    
    // Check operation name patterns
    const op = args.operation;
    if (op === 'addItem' || op === 'toggleItem' || op === 'deleteItem') {
      return true;
    }
    
    // Default to task operation
    return false;
  }
  
  /**
   * Check if string is a valid UUID
   */
  private isValidUUID(value: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  }
}

