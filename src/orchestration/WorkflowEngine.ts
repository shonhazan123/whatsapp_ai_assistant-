import { PlanningPhase, PlanningContext, ExecutionResult } from '../context/PlanningContext';
import { StateMachine } from './StateMachine';
import { logger } from '../utils/logger';

export interface WorkflowStep {
  phase: PlanningPhase;
  name: string;
  execute: (context: PlanningContext) => Promise<WorkflowStepResult>;
  rollback?: (context: PlanningContext) => Promise<void>;
}

export interface WorkflowStepResult {
  success: boolean;
  data?: any;
  error?: string;
  nextPhase?: PlanningPhase;
}

export abstract class BaseWorkflow {
  protected stateMachine: StateMachine;
  protected steps: WorkflowStep[] = [];

  constructor() {
    this.stateMachine = new StateMachine();
    this.initializeSteps();
  }

  /**
   * Initialize workflow steps - to be implemented by subclasses
   */
  protected abstract initializeSteps(): void;

  /**
   * Execute workflow
   */
  async execute(context: PlanningContext): Promise<PlanningContext> {
    try {
      logger.info(`🚀 Starting workflow for goal: ${context.goal}`);

      // Execute each step
      for (const step of this.steps) {
        // Check if we should continue
        if (this.stateMachine.isTerminalState()) {
          logger.info('Workflow reached terminal state');
          break;
        }

        // Execute step
        logger.info(`📋 Executing step: ${step.name}`);
        const result = await step.execute(context);

        if (!result.success) {
          logger.error(`❌ Step failed: ${step.name}`, result.error);
          
          // Try to rollback if possible
          if (step.rollback) {
            logger.info(`🔄 Rolling back step: ${step.name}`);
            await step.rollback(context);
          }

          // Update context with error
          context.executionResults = context.executionResults || [];
          context.executionResults.push({
            step: step.name,
            success: false,
            error: result.error,
            timestamp: new Date()
          });

          // Decide next phase based on error
          if (result.nextPhase) {
            await this.stateMachine.transition(result.nextPhase);
          } else {
            await this.stateMachine.transition('cancelled');
          }
          break;
        }

        // Update context with success
        context.executionResults = context.executionResults || [];
        context.executionResults.push({
          step: step.name,
          success: true,
          data: result.data,
          timestamp: new Date()
        });

        // Transition to next phase
        const nextPhase = result.nextPhase || this.getNextPhase();
        if (nextPhase) {
          await this.stateMachine.transition(nextPhase);
        }
      }

      logger.info(`✅ Workflow completed. Final state: ${this.stateMachine.getCurrentPhase()}`);
      return context;

    } catch (error) {
      logger.error('❌ Workflow execution error:', error);
      await this.stateMachine.transition('cancelled');
      return context;
    }
  }

  /**
   * Get next phase based on current state
   */
  protected getNextPhase(): PlanningPhase | undefined {
    const allowedTransitions = this.stateMachine.getAllowedTransitions();
    
    // Simple linear progression
    const phaseOrder: PlanningPhase[] = ['discovery', 'analysis', 'planning', 'validation', 'execution', 'completed'];
    const currentIndex = phaseOrder.indexOf(this.stateMachine.getCurrentPhase());
    
    if (currentIndex < phaseOrder.length - 1) {
      return phaseOrder[currentIndex + 1];
    }
    
    return undefined;
  }

  /**
   * Get current phase
   */
  getCurrentPhase(): PlanningPhase {
    return this.stateMachine.getCurrentPhase();
  }

  /**
   * Check if workflow is complete
   */
  isComplete(): boolean {
    return this.stateMachine.isTerminalState();
  }

  /**
   * Cancel workflow
   */
  async cancel(): Promise<void> {
    await this.stateMachine.transition('cancelled');
  }
}
