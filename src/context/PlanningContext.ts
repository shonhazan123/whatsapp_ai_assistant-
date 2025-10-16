export interface PlanningContext {
  userPhone: string;
  userId: string;
  goal: string;
  constraints: {
    startDate?: Date;
    endDate?: Date;
    availableHours?: string[];
    blockedSlots?: Array<{ start: Date; end: Date }>;
  };
  requirements: {
    subjects?: string[];
    topics?: string[];
    attendees?: string[];
    duration?: number;
    frequency?: string;
  };
  currentPhase: PlanningPhase;
  collectedData: Record<string, any>;
  proposedPlan?: ProposedPlan;
  approvedPlan?: ApprovedPlan;
  executionResults?: ExecutionResult[];
}

export type PlanningPhase = 
  | 'discovery'
  | 'analysis'
  | 'planning'
  | 'validation'
  | 'execution'
  | 'completed'
  | 'cancelled';

export interface ProposedPlan {
  strategy: string;
  timeline: Array<{
    date: Date;
    tasks: Array<{
      title: string;
      description: string;
      duration: number;
      priority: 'high' | 'medium' | 'low';
    }>;
    events?: Array<{
      title: string;
      start: Date;
      end: Date;
      attendees?: string[];
    }>;
  }>;
  estimatedDuration: number;
  confidence: number; // 0-1
}

export interface ApprovedPlan extends ProposedPlan {
  approvedAt: Date;
  approvedBy: string;
  modifications?: Array<{
    type: 'add' | 'remove' | 'modify';
    item: any;
  }>;
}

export interface ExecutionResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
  timestamp: Date;
}

export class PlanningContextManager {
  private contexts: Map<string, PlanningContext> = new Map();

  /**
   * Create new planning context
   */
  createContext(userPhone: string, userId: string, goal: string): PlanningContext {
    const context: PlanningContext = {
      userPhone,
      userId,
      goal,
      constraints: {},
      requirements: {},
      currentPhase: 'discovery',
      collectedData: {}
    };

    this.contexts.set(userPhone, context);
    return context;
  }

  /**
   * Get existing context
   */
  getContext(userPhone: string): PlanningContext | undefined {
    return this.contexts.get(userPhone);
  }

  /**
   * Update context
   */
  updateContext(userPhone: string, updates: Partial<PlanningContext>): PlanningContext {
    const context = this.contexts.get(userPhone);
    if (!context) {
      throw new Error(`No context found for user: ${userPhone}`);
    }

    const updatedContext = { ...context, ...updates };
    this.contexts.set(userPhone, updatedContext);
    return updatedContext;
  }

  /**
   * Update phase
   */
  updatePhase(userPhone: string, phase: PlanningPhase): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.currentPhase = phase;
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Add collected data
   */
  addCollectedData(userPhone: string, key: string, value: any): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.collectedData[key] = value;
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Set proposed plan
   */
  setProposedPlan(userPhone: string, plan: ProposedPlan): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.proposedPlan = plan;
      context.currentPhase = 'validation';
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Approve plan
   */
  approvePlan(userPhone: string, modifications?: Array<{ type: 'add' | 'remove' | 'modify'; item: any }>): void {
    const context = this.contexts.get(userPhone);
    if (context && context.proposedPlan) {
      context.approvedPlan = {
        ...context.proposedPlan,
        approvedAt: new Date(),
        approvedBy: userPhone,
        modifications
      };
      context.currentPhase = 'execution';
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Reject plan
   */
  rejectPlan(userPhone: string): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.proposedPlan = undefined;
      context.currentPhase = 'planning';
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Add execution result
   */
  addExecutionResult(userPhone: string, result: ExecutionResult): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      if (!context.executionResults) {
        context.executionResults = [];
      }
      context.executionResults.push(result);
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Complete planning
   */
  completePlanning(userPhone: string): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.currentPhase = 'completed';
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Cancel planning
   */
  cancelPlanning(userPhone: string): void {
    const context = this.contexts.get(userPhone);
    if (context) {
      context.currentPhase = 'cancelled';
      this.contexts.set(userPhone, context);
    }
  }

  /**
   * Clear context
   */
  clearContext(userPhone: string): void {
    this.contexts.delete(userPhone);
  }

  /**
   * Get all active contexts
   */
  getActiveContexts(): PlanningContext[] {
    return Array.from(this.contexts.values()).filter(
      ctx => ctx.currentPhase !== 'completed' && ctx.currentPhase !== 'cancelled'
    );
  }
}
