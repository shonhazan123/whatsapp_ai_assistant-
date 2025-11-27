import { AgentName } from '../../core/interfaces/IAgent';

export type CoordinatorAgent = AgentName.DATABASE | AgentName.CALENDAR | AgentName.GMAIL | AgentName.SECOND_BRAIN;

export interface PlannedAction {
  id: string;
  agent: CoordinatorAgent;
  intent: string;
  userInstruction: string;
  executionPayload: string;
  dependsOn?: string[];
  notes?: string;
}

export type ExecutionStatus = 'success' | 'failed' | 'blocked';

export interface ExecutionResult {
  actionId: string;
  agent: CoordinatorAgent;
  intent: string;
  success: boolean;
  status: ExecutionStatus;
  response?: string;
  error?: string;
  durationMs: number;
  startedAt: number;
}

