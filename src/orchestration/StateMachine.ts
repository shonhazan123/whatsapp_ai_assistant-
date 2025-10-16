import { PlanningPhase } from '../context/PlanningContext';
import { logger } from '../utils/logger';

export type StateTransition = {
  from: PlanningPhase;
  to: PlanningPhase;
  condition?: () => boolean;
  action?: () => Promise<void>;
};

export class StateMachine {
  private currentPhase: PlanningPhase = 'discovery';
  private transitions: Map<string, StateTransition[]> = new Map();

  constructor() {
    this.initializeTransitions();
  }

  /**
   * Initialize allowed transitions
   */
  private initializeTransitions(): void {
    // From discovery
    this.addTransition('discovery', 'analysis');
    this.addTransition('discovery', 'cancelled');

    // From analysis
    this.addTransition('analysis', 'planning');
    this.addTransition('analysis', 'discovery'); // Can go back to ask more questions
    this.addTransition('analysis', 'cancelled');

    // From planning
    this.addTransition('planning', 'validation');
    this.addTransition('planning', 'discovery'); // Can go back if need more info
    this.addTransition('planning', 'cancelled');

    // From validation
    this.addTransition('validation', 'execution'); // Approved
    this.addTransition('validation', 'planning'); // Rejected, replan
    this.addTransition('validation', 'discovery'); // Need more info
    this.addTransition('validation', 'cancelled');

    // From execution
    this.addTransition('execution', 'completed');
    this.addTransition('execution', 'cancelled');

    // Terminal states
    // completed and cancelled have no outgoing transitions
  }

  /**
   * Add a transition
   */
  private addTransition(from: PlanningPhase, to: PlanningPhase): void {
    if (!this.transitions.has(from)) {
      this.transitions.set(from, []);
    }
    this.transitions.get(from)!.push({ from, to });
  }

  /**
   * Check if transition is allowed
   */
  canTransition(to: PlanningPhase): boolean {
    const allowedTransitions = this.transitions.get(this.currentPhase);
    if (!allowedTransitions) {
      return false;
    }

    return allowedTransitions.some(t => t.to === to);
  }

  /**
   * Transition to new state
   */
  async transition(to: PlanningPhase): Promise<boolean> {
    if (!this.canTransition(to)) {
      logger.warn(`Invalid transition from ${this.currentPhase} to ${to}`);
      return false;
    }

    const transitions = this.transitions.get(this.currentPhase);
    const transition = transitions?.find(t => t.to === to);

    if (transition?.condition && !transition.condition()) {
      logger.warn(`Transition condition not met for ${this.currentPhase} -> ${to}`);
      return false;
    }

    logger.info(`State transition: ${this.currentPhase} -> ${to}`);

    // Execute transition action if exists
    if (transition?.action) {
      try {
        await transition.action();
      } catch (error) {
        logger.error('Error executing transition action:', error);
        return false;
      }
    }

    this.currentPhase = to;
    return true;
  }

  /**
   * Get current state
   */
  getCurrentPhase(): PlanningPhase {
    return this.currentPhase;
  }

  /**
   * Get allowed next states
   */
  getAllowedTransitions(): PlanningPhase[] {
    const transitions = this.transitions.get(this.currentPhase);
    return transitions ? transitions.map(t => t.to) : [];
  }

  /**
   * Check if in terminal state
   */
  isTerminalState(): boolean {
    return this.currentPhase === 'completed' || this.currentPhase === 'cancelled';
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.currentPhase = 'discovery';
  }

  /**
   * Get state history (for debugging)
   */
  getStateHistory(): PlanningPhase[] {
    // In a real implementation, this would track state history
    return [this.currentPhase];
  }
}
