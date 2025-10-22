import { CalendarAgent } from '../agents/v2/CalendarAgent';
import { DatabaseAgent } from '../agents/v2/DatabaseAgent';
import { GmailAgent } from '../agents/v2/GmailAgent';
import { ServiceContainer } from '../core/container/ServiceContainer';
import { logger } from '../utils/logger';

export interface AgentAction {
  agent: 'database' | 'calendar' | 'email';
  action: string;
  params: any;
  priority: 'high' | 'medium' | 'low';
  dependsOn?: string[]; // IDs of actions that must complete first
}

export interface AgentActionResult {
  actionId: string;
  agent: string;
  action: string;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

export class MultiAgentCoordinator {
  private container: ServiceContainer;
  private agents: Map<string, any> = new Map();

  constructor() {
    this.container = ServiceContainer.getInstance();
    this.initializeAgents();
  }

  /**
   * Initialize agents
   */
  private initializeAgents(): void {
    try {
      const openaiService = this.container.getOpenAIService();
      const functionHandler = this.container.getFunctionHandler();
      const loggerInstance = this.container.getLogger();

      this.agents.set('database', new DatabaseAgent(openaiService, functionHandler, loggerInstance));
      this.agents.set('calendar', new CalendarAgent(openaiService, functionHandler, loggerInstance));
      this.agents.set('email', new GmailAgent(openaiService, functionHandler, loggerInstance));

      logger.info('✅ Multi-agent coordinator initialized');
    } catch (error) {
      logger.error('Error initializing agents:', error);
    }
  }

  /**
   * Execute actions in parallel where possible
   */
  async executeActionsBatch(
    actions: AgentAction[],
    userPhone: string
  ): Promise<AgentActionResult[]> {
    const results: AgentActionResult[] = [];
    const completedActions = new Set<string>();

    try {
      // Sort actions by priority and dependencies
      const sortedActions = this.sortActionsByDependencies(actions);

      // Execute actions in batches based on dependencies
      for (const batch of sortedActions) {
        logger.info(`📦 Executing batch of ${batch.length} actions`);

        // Execute batch in parallel
        const batchResults = await Promise.allSettled(
          batch.map(action => this.executeAction(action, userPhone))
        );

        // Process results
        for (let i = 0; i < batch.length; i++) {
          const result = batchResults[i];
          const action = batch[i];

          if (result.status === 'fulfilled') {
            results.push(result.value);
            completedActions.add(action.action);
          } else {
            results.push({
              actionId: action.action,
              agent: action.agent,
              action: action.action,
              success: false,
              error: result.reason?.message || 'Unknown error',
              duration: 0
            });
          }
        }
      }

      logger.info(`✅ Completed ${results.filter(r => r.success).length}/${results.length} actions`);
      return results;

    } catch (error) {
      logger.error('Error executing actions:', error);
      throw error;
    }
  }

  /**
   * Execute single action
   */
  private async executeAction(
    action: AgentAction,
    userPhone: string
  ): Promise<AgentActionResult> {
    const startTime = Date.now();

    try {
      logger.info(`🔧 Executing ${action.agent} action: ${action.action}`);

      const agent = this.agents.get(action.agent);
      if (!agent) {
        throw new Error(`Agent not found: ${action.agent}`);
      }

      // Build the message for the agent
      const message = this.buildAgentMessage(action);

      // Execute through agent
      const result = await agent.processRequest(message, userPhone);

      const duration = Date.now() - startTime;

      return {
        actionId: action.action,
        agent: action.agent,
        action: action.action,
        success: true,
        data: result,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`❌ Action failed: ${action.action}`, error);

      return {
        actionId: action.action,
        agent: action.agent,
        action: action.action,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      };
    }
  }

  /**
   * Build message for agent based on action
   */
  private buildAgentMessage(action: AgentAction): string {
    // This is a simplified version - in reality, this would be more sophisticated
    // based on the action type and parameters

    switch (action.agent) {
      case 'database':
        return this.buildDatabaseMessage(action);
      case 'calendar':
        return this.buildCalendarMessage(action);
      case 'email':
        return this.buildEmailMessage(action);
      default:
        return JSON.stringify(action.params);
    }
  }

  private buildDatabaseMessage(action: AgentAction): string {
    // Convert action params to natural language
    const { operation, ...params } = action.params;
    
    switch (operation) {
      case 'createMultiple':
        const tasks = params.tasks || [];
        return `צור ${tasks.length} משימות: ${tasks.map((t: any) => t.text).join(', ')}`;
      
      case 'getAll':
        return 'הצג את כל המשימות שלי';
      
      default:
        return `בצע פעולה: ${operation}`;
    }
  }

  private buildCalendarMessage(action: AgentAction): string {
    const { operation, ...params } = action.params;
    
    switch (operation) {
      case 'createMultiple':
        const events = params.events || [];
        return `צור ${events.length} אירועים: ${events.map((e: any) => e.summary).join(', ')}`;
      
      case 'getEvents':
        return `הצג את האירועים שלי מ-${params.timeMin} עד ${params.timeMax}`;
      
      default:
        return `בצע פעולה: ${operation}`;
    }
  }

  private buildEmailMessage(action: AgentAction): string {
    const { operation, ...params } = action.params;
    
    switch (operation) {
      case 'send':
        return `שלח מייל ל-${params.to.join(', ')} בנושא: ${params.subject}`;
      
      default:
        return `בצע פעולה: ${operation}`;
    }
  }

  /**
   * Sort actions by dependencies
   */
  private sortActionsByDependencies(actions: AgentAction[]): AgentAction[][] {
    const batches: AgentAction[][] = [];
    const processed = new Set<string>();
    const remaining = new Set(actions.map(a => a.action));

    while (remaining.size > 0) {
      const batch: AgentAction[] = [];

      for (const action of actions) {
        if (processed.has(action.action)) continue;
        if (!remaining.has(action.action)) continue;

        // Check if all dependencies are satisfied
        const dependenciesMet = !action.dependsOn || 
          action.dependsOn.every(dep => processed.has(dep));

        if (dependenciesMet) {
          batch.push(action);
        }
      }

      if (batch.length === 0) {
        // Circular dependency or missing dependency
        logger.warn('Circular dependency detected, processing remaining actions');
        for (const action of actions) {
          if (remaining.has(action.action)) {
            batch.push(action);
          }
        }
      }

      batches.push(batch);
      batch.forEach(a => {
        processed.add(a.action);
        remaining.delete(a.action);
      });
    }

    return batches;
  }

  /**
   * Get agent by type
   */
  getAgent(type: 'database' | 'calendar' | 'email'): any {
    return this.agents.get(type);
  }

  /**
   * Check if all actions succeeded
   */
  allActionsSucceeded(results: AgentActionResult[]): boolean {
    return results.every(r => r.success);
  }

  /**
   * Get summary of execution
   */
  getExecutionSummary(results: AgentActionResult[]): string {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    return `✅ Completed: ${successful}/${results.length} actions in ${totalDuration}ms${failed > 0 ? ` (${failed} failed)` : ''}`;
  }

  /**
   * Execute actions for multi-task requests
   */
  async executeActions(messageText: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      // Use MultiTaskService for complex multi-agent coordination
      const { MultiTaskService } = require('../services/multi-task/MultiTaskService');
      const container = require('../core/container/ServiceContainer').ServiceContainer.getInstance();
      
      const multiTaskService = new MultiTaskService(container);
      return await multiTaskService.executeMultiTask(messageText, userPhone, context);
      
    } catch (error) {
      return 'An error occurred while coordinating multiple agents.';
    }
  }
}
