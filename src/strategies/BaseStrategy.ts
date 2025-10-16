import { PlanningContext, ProposedPlan } from '../context/PlanningContext';
import { logger } from '../utils/logger';

export interface StrategyConfig {
  name: string;
  description: string;
  phases: string[];
  requiredData: string[];
}

export abstract class BaseStrategy {
  protected config: StrategyConfig;

  constructor(config: StrategyConfig) {
    this.config = config;
  }

  /**
   * Analyze the goal and context
   */
  abstract analyze(context: PlanningContext): Promise<AnalysisResult>;

  /**
   * Generate plan based on analysis
   */
  abstract generatePlan(context: PlanningContext, analysis: AnalysisResult): Promise<ProposedPlan>;

  /**
   * Validate plan feasibility
   */
  abstract validatePlan(plan: ProposedPlan, context: PlanningContext): Promise<ValidationResult>;

  /**
   * Get strategy name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get strategy description
   */
  getDescription(): string {
    return this.config.description;
  }

  /**
   * Check if strategy can handle the goal
   */
  abstract canHandle(goal: string, context: PlanningContext): boolean;

  /**
   * Get confidence score for this strategy
   */
  abstract getConfidence(goal: string, context: PlanningContext): number;

  /**
   * Get required data
   */
  getRequiredData(): string[] {
    return this.config.requiredData;
  }

  /**
   * Check if all required data is available
   */
  hasRequiredData(context: PlanningContext): boolean {
    return this.config.requiredData.every(key => 
      context.collectedData.hasOwnProperty(key)
    );
  }
}

export interface AnalysisResult {
  goal: string;
  constraints: {
    timeAvailable: number; // hours
    startDate: Date;
    endDate: Date;
    blockedSlots: Array<{ start: Date; end: Date }>;
  };
  requirements: {
    subjects?: string[];
    topics?: string[];
    attendees?: string[];
    duration?: number;
    frequency?: string;
  };
  confidence: number; // 0-1
}

export interface ValidationResult {
  valid: boolean;
  confidence: number; // 0-1
  issues: Array<{
    severity: 'error' | 'warning' | 'info';
    message: string;
    suggestion?: string;
  }>;
  warnings: string[];
}
