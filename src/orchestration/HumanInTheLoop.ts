import { PlanningContext, ProposedPlan } from '../context/PlanningContext';
import { logger } from '../utils/logger';

export interface ApprovalRequest {
  type: 'plan' | 'action';
  plan?: ProposedPlan;
  action?: {
    agent: string;
    operation: string;
    params: any;
    impact: 'high' | 'medium' | 'low';
  };
  userPhone: string;
  timestamp: Date;
}

export interface ApprovalResponse {
  approved: boolean;
  modifications?: Array<{
    type: 'add' | 'remove' | 'modify';
    item: any;
  }>;
  reason?: string;
}

export class HumanInTheLoop {
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  /**
   * Check if action needs approval
   */
  async needsApproval(
    userPhone: string,
    agent: string,
    operation: string,
    params: any
  ): Promise<boolean> {
    try {
      // Check operation impact
      const impact = this.assessImpact(agent, operation, params);
      
      if (impact === 'low') {
        logger.info(`✅ Low impact operation, auto-approved: ${operation}`);
        return false;
      }

      logger.info(`⚠️ Approval required for ${operation} (impact: ${impact})`);
      return true;

    } catch (error) {
      logger.error('Error checking approval requirement:', error);
      // Default to requiring approval on error
      return true;
    }
  }

  /**
   * Request approval for action
   */
  async requestActionApproval(
    userPhone: string,
    agent: string,
    operation: string,
    params: any
  ): Promise<ApprovalRequest> {
    const impact = this.assessImpact(agent, operation, params);

    const request: ApprovalRequest = {
      type: 'action',
      action: {
        agent,
        operation,
        params,
        impact
      },
      userPhone,
      timestamp: new Date()
    };

    this.pendingApprovals.set(userPhone, request);
    return request;
  }

  /**
   * Request approval for plan
   */
  async requestPlanApproval(
    userPhone: string,
    plan: ProposedPlan
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      type: 'plan',
      plan,
      userPhone,
      timestamp: new Date()
    };

    this.pendingApprovals.set(userPhone, request);
    return request;
  }

  /**
   * Get pending approval for user
   */
  getPendingApproval(userPhone: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(userPhone);
  }

  /**
   * Process approval response
   */
  async processApproval(
    userPhone: string,
    approved: boolean,
    modifications?: Array<{ type: 'add' | 'remove' | 'modify'; item: any }>
  ): Promise<ApprovalResponse> {
    const request = this.pendingApprovals.get(userPhone);
    
    if (!request) {
      logger.warn(`No pending approval found for ${userPhone}`);
      return {
        approved: false,
        reason: 'No pending approval found'
      };
    }

    // Clear pending approval
    this.pendingApprovals.delete(userPhone);

    const response: ApprovalResponse = {
      approved,
      modifications
    };

    if (approved) {
      logger.info(`✅ Approval granted for ${userPhone}`);
    } else {
      logger.info(`❌ Approval denied for ${userPhone}`);
      response.reason = 'User rejected the request';
    }

    return response;
  }

  /**
   * Build approval message for user
   */
  buildApprovalMessage(request: ApprovalRequest): string {
    if (request.type === 'plan') {
      return this.buildPlanApprovalMessage(request.plan!);
    } else {
      return this.buildActionApprovalMessage(request.action!);
    }
  }

  /**
   * Build plan approval message
   */
  private buildPlanApprovalMessage(plan: ProposedPlan): string {
    const lines: string[] = [];

    lines.push(`📋 *תוכנית מוצעת*`);
    lines.push(`אסטרטגיה: ${plan.strategy}`);
    lines.push(`ביטחון: ${Math.round(plan.confidence * 100)}%`);
    lines.push(`\n*ציר זמן:*`);

    plan.timeline.forEach((day, index) => {
      const dateStr = day.date.toLocaleDateString('he-IL');
      lines.push(`\n📅 ${dateStr}:`);

      if (day.tasks && day.tasks.length > 0) {
        lines.push(`*משימות:*`);
        day.tasks.forEach((task, taskIndex) => {
          lines.push(`  ${taskIndex + 1}. ${task.title} (${task.duration} דקות)`);
        });
      }

      if (day.events && day.events.length > 0) {
        lines.push(`*אירועים:*`);
        day.events.forEach((event, eventIndex) => {
          lines.push(`  ${eventIndex + 1}. ${event.title} (${event.start.toLocaleTimeString('he-IL')})`);
        });
      }
    });

    lines.push(`\n✅ אישור | ❌ דחייה`);
    lines.push(`💡 תוכל לבקש שינויים`);

    return lines.join('\n');
  }

  /**
   * Build action approval message
   */
  private buildActionApprovalMessage(action: ApprovalRequest['action']): string {
    const lines: string[] = [];

    lines.push(`⚠️ *פעולה דורשת אישור*`);
    lines.push(`סוכן: ${action!.agent}`);
    lines.push(`פעולה: ${action!.operation}`);
    lines.push(`השפעה: ${action!.impact}`);

    if (action!.operation === 'createMultiple') {
      const items = action!.params.tasks || action!.params.events || action!.params.contacts || [];
      lines.push(`\nפריטים ליצירה (${items.length}):`);
      items.slice(0, 5).forEach((item: any, index: number) => {
        lines.push(`  ${index + 1}. ${item.text || item.summary || item.name}`);
      });
      if (items.length > 5) {
        lines.push(`  ... ועוד ${items.length - 5} פריטים`);
      }
    }

    lines.push(`\n✅ אישור | ❌ דחייה`);

    return lines.join('\n');
  }

  /**
   * Assess impact of operation
   */
  private assessImpact(agent: string, operation: string, params: any): 'high' | 'medium' | 'low' {
    // High impact operations
    const highImpactOps = ['delete', 'deleteMultiple', 'send', 'updateMultiple'];
    if (highImpactOps.includes(operation)) {
      return 'high';
    }

    // Medium impact operations
    const mediumImpactOps = ['createMultiple', 'update'];
    if (mediumImpactOps.includes(operation)) {
      return 'medium';
    }

    // Low impact operations
    return 'low';
  }


  /**
   * Clear expired approvals
   */
  clearExpiredApprovals(maxAgeMinutes: number = 30): void {
    const now = new Date();
    const expired: string[] = [];

    this.pendingApprovals.forEach((request, userPhone) => {
      const age = (now.getTime() - request.timestamp.getTime()) / (1000 * 60);
      if (age > maxAgeMinutes) {
        expired.push(userPhone);
      }
    });

    expired.forEach(userPhone => {
      this.pendingApprovals.delete(userPhone);
      logger.info(`🗑️ Cleared expired approval for ${userPhone}`);
    });
  }
}
