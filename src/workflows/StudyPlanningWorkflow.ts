import { BaseWorkflow } from './BaseWorkflow';
import { WorkflowStep } from '../orchestration/WorkflowEngine';
import { PlanningContext } from '../context/PlanningContext';
import { StudyStrategy } from '../strategies/StudyStrategy';
import { AgentAction } from '../orchestration/MultiAgentCoordinator';
import { logger } from '../utils/logger';

export class StudyPlanningWorkflow extends BaseWorkflow {
  constructor() {
    super(new StudyStrategy());
  }

  /**
   * Initialize workflow steps
   */
  protected initializeSteps(): void {
    this.steps = [
      this.createDiscoveryStep(),
      this.createAnalysisStep(),
      this.createPlanningStep(),
      this.createValidationStep(),
      this.createExecutionStep()
    ];
  }

  /**
   * Build actions from study plan
   */
  protected buildActionsFromPlan(plan: any): AgentAction[] {
    const actions: AgentAction[] = [];

    // Group tasks by date for efficient creation
    const tasksByDate = new Map<string, any[]>();

    plan.timeline.forEach((day: any) => {
      const dateKey = day.date.toISOString().split('T')[0];
      
      if (!tasksByDate.has(dateKey)) {
        tasksByDate.set(dateKey, []);
      }

      day.tasks.forEach((task: any) => {
        tasksByDate.get(dateKey)!.push({
          text: task.title,
          description: task.description,
          due_date: day.date.toISOString(),
          priority: task.priority
        });
      });
    });

    // Create actions for each date
    tasksByDate.forEach((tasks, date) => {
      actions.push({
        agent: 'database',
        action: `create_tasks_${date}`,
        params: {
          operation: 'createMultiple',
          tasks
        },
        priority: 'medium'
      });
    });

    // Create calendar events if any
    plan.timeline.forEach((day: any) => {
      if (day.events && day.events.length > 0) {
        actions.push({
          agent: 'calendar',
          action: `create_events_${day.date.toISOString().split('T')[0]}`,
          params: {
            operation: 'createMultiple',
            events: day.events.map((event: any) => ({
              summary: event.title,
              start: event.start.toISOString(),
              end: event.end.toISOString(),
              attendees: event.attendees || []
            }))
          },
          priority: 'medium'
        });
      }
    });

    logger.info(`📋 Built ${actions.length} actions from plan`);

    return actions;
  }
}
