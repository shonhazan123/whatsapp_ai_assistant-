import { SystemPrompts } from '../config/system-prompts';
import { ServiceContainer } from '../core/container/ServiceContainer';
import { AgentFactory } from '../core/factory/AgentFactory';
import { AgentName, IAgent } from '../core/interfaces/IAgent';
import { OpenAIService } from '../services/ai/OpenAIService';
import { logger } from '../utils/logger';
import { CoordinatorAgent, ExecutionResult, PlannedAction } from './types/MultiAgentPlan';

export class MultiAgentCoordinator {
  private container: ServiceContainer;
  private agents: Map<CoordinatorAgent, IAgent> = new Map();
  private openaiService: OpenAIService;

  constructor() {
    this.container = ServiceContainer.getInstance();
    this.openaiService = this.container.getOpenAIService();
    this.initializeAgents();
  }

  /**
   * Initialize agents
   */
  private initializeAgents(): void {
    try {
      this.agents.set(
        AgentName.DATABASE,
        AgentFactory.getAgent(AgentName.DATABASE)
      );
      this.agents.set(
        AgentName.CALENDAR,
        AgentFactory.getAgent(AgentName.CALENDAR)
      );
      this.agents.set(
        AgentName.GMAIL,
        AgentFactory.getAgent(AgentName.GMAIL)
      );
      logger.info('✅ Multi-agent coordinator initialized');
    } catch (error) {
      logger.error('Error initializing agents:', error);
    }
  }

  /**
   * Execute actions for multi-task requests
   */
  async executeActions(messageText: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      const plan = await this.planActions(messageText, context);
      if (plan.length === 0) {
        logger.warn('Planner returned empty plan for multi-agent request');
        return 'מצטער, לא הצלחתי לפרק את הבקשה לפעולות.';
      }

      const executionResults = await this.executePlan(plan, userPhone, context);
      return await this.buildSummary(plan, executionResults, context, userPhone);
    } catch (error) {
      logger.error('Error executing multi-agent workflow:', error);
      return 'An error occurred while coordinating multiple agents.';
    }
  }

  private async planActions(messageText: string, context: any[] = []): Promise<PlannedAction[]> {
    const baseMessages = this.buildPlannerMessages(messageText, context);

    try {
      return await this.requestPlan(baseMessages);
    } catch (error) {
      logger.error('Failed to obtain multi-agent plan:', error);
      return [];
    }
  }

  private buildPlannerMessages(messageText: string, context: any[]): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: SystemPrompts.getMultiAgentPlannerPrompt()
      }
    ];

    const recentContext = context.slice(-4);
    recentContext.forEach((msg: any) => {
      if (!msg?.role || !msg?.content) {
        return;
      }

      const role = msg.role;
      if (role === 'system' || role === 'user' || role === 'assistant') {
        messages.push({
          role: role as 'system' | 'user' | 'assistant',
          content: msg.content
        });
      }
    });

    messages.push({
      role: 'user',
      content: messageText
    });

    return messages;
  }

  private async requestPlan(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    attempt = 1
  ): Promise<PlannedAction[]> {
    const completion = await this.openaiService.createCompletion({
      messages: messages as any,
      temperature: 0.2,
      maxTokens: 700,
      model: 'gpt-4o'
    });

    const rawResponse = completion.choices[0]?.message?.content?.trim() ?? '[]';

    try {
      const parsed = JSON.parse(rawResponse);
      return this.normalizePlan(parsed);
    } catch (error) {
      if (attempt >= 2) {
        logger.error('Planner returned invalid JSON twice, aborting.', error);
        throw new Error('Planner response invalid JSON');
      }

      logger.warn('Planner returned invalid JSON, requesting reformatted output.');
      const retryMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        ...messages,
        { role: 'assistant', content: rawResponse },
        {
          role: 'user',
          content: 'The previous output was not valid JSON. Respond again with ONLY a valid JSON array following the schema.'
        }
      ];

      return this.requestPlan(retryMessages, attempt + 1);
    }
  }

  private normalizePlan(candidate: unknown): PlannedAction[] {
    if (!Array.isArray(candidate)) {
      return [];
    }

    const plan: PlannedAction[] = [];

    candidate.forEach((item, index) => {
      if (!item || typeof item !== 'object') {
        return;
      }

      const action = item as Record<string, unknown>;
      const agent = action.agent;

      if (agent !== AgentName.DATABASE && agent !== AgentName.CALENDAR && agent !== AgentName.GMAIL) {
        logger.warn('Skipping action with unsupported agent:', agent);
        return;
      }

      const id = typeof action.id === 'string' && action.id.trim().length > 0 ? action.id.trim() : `action_${index + 1}`;
      const intent = typeof action.intent === 'string' && action.intent.trim().length > 0 ? action.intent.trim() : 'perform_action';
      const executionPayload =
        typeof action.executionPayload === 'string' && action.executionPayload.trim().length > 0
          ? action.executionPayload.trim()
          : '';

      if (!executionPayload) {
        logger.warn(`Skipping action ${id} because executionPayload is empty`);
        return;
      }

      const userInstruction =
        typeof action.userInstruction === 'string' && action.userInstruction.trim().length > 0
          ? action.userInstruction.trim()
          : executionPayload;

      const dependsOn =
        Array.isArray(action.dependsOn) && action.dependsOn.every(dep => typeof dep === 'string')
          ? (action.dependsOn as string[])
          : undefined;

      const notes = typeof action.notes === 'string' && action.notes.trim().length > 0 ? action.notes.trim() : undefined;

      plan.push({
        id,
        agent,
        intent,
        userInstruction,
        executionPayload,
        dependsOn,
        notes
      });
    });

    return plan;
  }

  private async executePlan(plan: PlannedAction[], userPhone: string, context: any[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const resultMap = new Map<string, ExecutionResult>();
    const runningContext: any[] = [...context];

    for (const action of plan) {
      const unmetDependencies =
        action.dependsOn?.filter(depId => {
          const dependencyResult = resultMap.get(depId);
          return !dependencyResult || !dependencyResult.success;
        }) ?? [];

      if (unmetDependencies.length > 0) {
        logger.warn(`Skipping action ${action.id} due to unmet dependencies: ${unmetDependencies.join(', ')}`);
        const blockedResult: ExecutionResult = {
          actionId: action.id,
          agent: action.agent,
          intent: action.intent,
          success: false,
          status: 'blocked',
          error: `Dependencies failed: ${unmetDependencies.join(', ')}`,
          durationMs: 0,
          startedAt: Date.now()
        };
        results.push(blockedResult);
        resultMap.set(action.id, blockedResult);
        continue;
      }

      const agent = this.agents.get(action.agent);
      if (!agent) {
        logger.error(`Agent not found for action ${action.id}`);
        const missingAgentResult: ExecutionResult = {
          actionId: action.id,
          agent: action.agent,
          intent: action.intent,
          success: false,
          status: 'failed',
          error: `Agent not found: ${action.agent}`,
          durationMs: 0,
          startedAt: Date.now()
        };
        results.push(missingAgentResult);
        resultMap.set(action.id, missingAgentResult);
        continue;
      }

      const startTime = Date.now();
      try {
        logger.info(`🔧 Executing action ${action.id} (${action.agent}): ${action.intent}`);
        const response = await (agent as any).processRequest(action.executionPayload, userPhone, runningContext);
        const duration = Date.now() - startTime;

        const successResult: ExecutionResult = {
          actionId: action.id,
          agent: action.agent,
          intent: action.intent,
          success: true,
          status: 'success',
          response: response,
          durationMs: duration,
          startedAt: startTime
        };

        results.push(successResult);
        resultMap.set(action.id, successResult);

        if (response && typeof response === 'string') {
          runningContext.push({ role: 'assistant', content: response });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        logger.error(`❌ Action ${action.id} failed`, error);

        const failureResult: ExecutionResult = {
          actionId: action.id,
          agent: action.agent,
          intent: action.intent,
          success: false,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          durationMs: duration,
          startedAt: startTime
        };

        results.push(failureResult);
        resultMap.set(action.id, failureResult);

        runningContext.push({
          role: 'assistant',
          content: `ACTION ${action.id} FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`
        });
      }

      if (runningContext.length > 12) {
        runningContext.splice(0, runningContext.length - 12);
      }
    }

    return results;
  }

  private async buildSummary(
    plan: PlannedAction[],
    results: ExecutionResult[],
    context: any[],
    userPhone: string
  ): Promise<string> {
    try {
      const language = await this.detectLanguageFromContext(context);
      const summaryContent = JSON.stringify({
        language,
        plan: plan,
        results: results.map(result => ({
          actionId: result.actionId,
          agent: result.agent,
          intent: result.intent,
          status: result.status,
          success: result.success,
          response: result.response,
          error: result.error
        }))
      });

      const completion = await this.openaiService.createCompletion({
        messages: [
          {
            role: 'system',
            content: SystemPrompts.getMultiAgentSummaryPrompt()
          },
          {
            role: 'user',
            content: summaryContent
          }
        ],
        temperature: 0.4,
        maxTokens: 300,
        model: 'gpt-4o'
      });

      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) {
        logger.warn('Summary LLM returned empty response, falling back to deterministic message.');
        return this.buildFallbackSummary(plan, results, language);
      }

      return text;
    } catch (error) {
      logger.error('Failed to generate LLM summary, using fallback.', error);
      const language = await this.detectLanguageFromContext(context);
      return this.buildFallbackSummary(plan, results, language);
    }
  }

  private async detectLanguageFromContext(context: any[]): Promise<'hebrew' | 'english' | 'other'> {
    const lastUserMessage = [...context].reverse().find(msg => msg?.role === 'user')?.content ?? '';
    return this.openaiService.detectLanguage(lastUserMessage);
  }

  private buildFallbackSummary(
    plan: PlannedAction[],
    results: ExecutionResult[],
    language: 'hebrew' | 'english' | 'other'
  ): string {
    const successes = results.filter(r => r.success).length;
    const failed = results.filter(r => r.status === 'failed').length;
    const blocked = results.filter(r => r.status === 'blocked').length;
    const total = plan.length;

    if (language === 'english') {
      if (failed === 0 && blocked === 0) {
        return `All ${total} steps completed successfully ✅`;
      }
      return `Completed ${successes}/${total} steps. ${failed} failed, ${blocked} blocked.`;
    }

    // Default to Hebrew
    if (failed === 0 && blocked === 0) {
      return `השלמתי בהצלחה ${total} מתוך ${total} פעולות ✅`;
    }
    return `הושלמו ${successes}/${total} פעולות. ${failed} נכשלו ו-${blocked} נחסמו.`;
  }
}
