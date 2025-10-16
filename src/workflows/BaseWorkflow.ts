import { BaseWorkflow as BaseWorkflowEngine, WorkflowStep, WorkflowStepResult } from '../orchestration/WorkflowEngine';
import { PlanningContext } from '../context/PlanningContext';
import { BaseStrategy } from '../strategies/BaseStrategy';
import { MultiAgentCoordinator, AgentAction } from '../orchestration/MultiAgentCoordinator';
import { HumanInTheLoop } from '../orchestration/HumanInTheLoop';
import { logger } from '../utils/logger';

export abstract class BaseWorkflow extends BaseWorkflowEngine {
  protected strategy: BaseStrategy;
  protected coordinator: MultiAgentCoordinator;
  protected hitl: HumanInTheLoop;

  constructor(strategy: BaseStrategy) {
    super();
    this.strategy = strategy;
    this.coordinator = new MultiAgentCoordinator();
    this.hitl = new HumanInTheLoop();
  }

  /**
   * Initialize workflow steps - to be implemented by subclasses
   */
  protected abstract initializeSteps(): void;

  /**
   * Discovery phase - collect information from user
   */
  protected createDiscoveryStep(): WorkflowStep {
    return {
      phase: 'discovery',
      name: 'Discovery - Collect Information',
      execute: async (context: PlanningContext) => {
        logger.info('🔍 Discovery phase: Collecting information');

        // Check if we have required data
        const hasRequiredData = this.strategy.hasRequiredData(context);

        if (!hasRequiredData) {
          // Need to ask user for more information
          const missingData = this.strategy.getRequiredData().filter(
            key => !context.collectedData.hasOwnProperty(key)
          );

          return {
            success: false,
            error: `Missing required data: ${missingData.join(', ')}`,
            nextPhase: 'discovery'
          };
        }

        return {
          success: true,
          data: context.collectedData,
          nextPhase: 'analysis'
        };
      }
    };
  }

  /**
   * Analysis phase - analyze the goal and context
   */
  protected createAnalysisStep(): WorkflowStep {
    return {
      phase: 'analysis',
      name: 'Analysis - Analyze Goal and Context',
      execute: async (context: PlanningContext) => {
        logger.info('📊 Analysis phase: Analyzing goal and context');

        try {
          const analysis = await this.strategy.analyze(context);
          
          // Store analysis in context
          context.collectedData.analysis = analysis;

          return {
            success: true,
            data: analysis,
            nextPhase: 'planning'
          };

        } catch (error) {
          logger.error('Analysis failed:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Analysis failed',
            nextPhase: 'cancelled'
          };
        }
      }
    };
  }

  /**
   * Planning phase - generate plan
   */
  protected createPlanningStep(): WorkflowStep {
    return {
      phase: 'planning',
      name: 'Planning - Generate Plan',
      execute: async (context: PlanningContext) => {
        logger.info('📅 Planning phase: Generating plan');

        try {
          const analysis = context.collectedData.analysis;
          if (!analysis) {
            return {
              success: false,
              error: 'No analysis data available',
              nextPhase: 'analysis'
            };
          }

          const plan = await this.strategy.generatePlan(context, analysis);
          
          // Validate plan
          const validation = await this.strategy.validatePlan(plan, context);

          if (!validation.valid) {
            logger.warn('Plan validation failed:', validation.issues);
            return {
              success: false,
              error: `Plan validation failed: ${validation.issues.map(i => i.message).join(', ')}`,
              nextPhase: 'planning'
            };
          }

          // Store plan in context
          context.proposedPlan = plan;

          return {
            success: true,
            data: { plan, validation },
            nextPhase: 'validation'
          };

        } catch (error) {
          logger.error('Planning failed:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Planning failed',
            nextPhase: 'cancelled'
          };
        }
      }
    };
  }

  /**
   * Validation phase - get user approval
   */
  protected createValidationStep(): WorkflowStep {
    return {
      phase: 'validation',
      name: 'Validation - Get User Approval',
      execute: async (context: PlanningContext) => {
        logger.info('✅ Validation phase: Getting user approval');

        if (!context.proposedPlan) {
          return {
            success: false,
            error: 'No proposed plan available',
            nextPhase: 'planning'
          };
        }

        // Request approval
        const approvalRequest = await this.hitl.requestPlanApproval(
          context.userPhone,
          context.proposedPlan
        );

        // Build approval message
        const message = this.hitl.buildApprovalMessage(approvalRequest);

        // In a real implementation, we would send this message to the user
        // and wait for their response. For now, we'll simulate approval.
        logger.info('📨 Approval message:', message);

        // Store approval request in context
        context.collectedData.approvalRequest = approvalRequest;

        // Return success but don't move to execution yet
        // Wait for user response
        return {
          success: true,
          data: { message, approvalRequest },
          nextPhase: 'validation' // Stay in validation until user responds
        };
      }
    };
  }

  /**
   * Execution phase - execute the plan
   */
  protected createExecutionStep(): WorkflowStep {
    return {
      phase: 'execution',
      name: 'Execution - Execute Plan',
      execute: async (context: PlanningContext) => {
        logger.info('🚀 Execution phase: Executing plan');

        if (!context.approvedPlan) {
          return {
            success: false,
            error: 'No approved plan available',
            nextPhase: 'validation'
          };
        }

        try {
          // Build actions from approved plan
          const actions = this.buildActionsFromPlan(context.approvedPlan);

          // Execute actions
          const results = await this.coordinator.executeActions(actions, context.userPhone);

          // Check if all actions succeeded
          const allSucceeded = this.coordinator.allActionsSucceeded(results);

          if (!allSucceeded) {
            const failedActions = results.filter(r => !r.success);
            logger.error('Some actions failed:', failedActions);
            
            return {
              success: false,
              error: `${failedActions.length} actions failed`,
              data: { results },
              nextPhase: 'execution' // Retry
            };
          }

          // Get execution summary
          const summary = this.coordinator.getExecutionSummary(results);

          logger.info('✅ Execution completed:', summary);

          return {
            success: true,
            data: { results, summary },
            nextPhase: 'completed'
          };

        } catch (error) {
          logger.error('Execution failed:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Execution failed',
            nextPhase: 'cancelled'
          };
        }
      }
    };
  }

  /**
   * Build actions from plan - to be implemented by subclasses
   */
  protected abstract buildActionsFromPlan(plan: any): AgentAction[];

  /**
   * Handle user approval response
   */
  async handleApprovalResponse(
    context: PlanningContext,
    approved: boolean,
    modifications?: Array<{ type: 'add' | 'remove' | 'modify'; item: any }>
  ): Promise<void> {
    const response = await this.hitl.processApproval(
      context.userPhone,
      approved,
      modifications
    );

    if (response.approved) {
      // Approve the plan
      if (context.proposedPlan) {
        context.approvedPlan = {
          ...context.proposedPlan,
          approvedAt: new Date(),
          approvedBy: context.userPhone,
          modifications: response.modifications
        };

        // Apply modifications if any
        if (response.modifications && response.modifications.length > 0) {
          this.applyModifications(context.approvedPlan, response.modifications);
        }

        // Move to execution
        await this.stateMachine.transition('execution');
      }
    } else {
      // Reject the plan
      context.proposedPlan = undefined;
      
      // Move back to planning
      await this.stateMachine.transition('planning');
    }
  }

  /**
   * Apply modifications to plan
   */
  private applyModifications(plan: any, modifications: Array<{ type: 'add' | 'remove' | 'modify'; item: any }>): void {
    modifications.forEach(mod => {
      switch (mod.type) {
        case 'add':
          // Add item to plan
          break;
        case 'remove':
          // Remove item from plan
          break;
        case 'modify':
          // Modify item in plan
          break;
      }
    });
  }
}
