import { DEFAULT_MODEL } from '../config/openai';
import { SystemPrompts } from '../config/system-prompts';
import { ServiceContainer } from '../core/container/ServiceContainer';
import { RequestContext } from '../core/context/RequestContext';
import { AgentFactory } from '../core/factory/AgentFactory';
import { AgentName, IAgent } from '../core/interfaces/IAgent';
import { IntentDecision, OpenAIService } from '../services/ai/OpenAIService';
import { setAgentNameForTracking } from '../services/performance/performanceUtils';
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
      this.agents.set(
        AgentName.SECOND_BRAIN,
        AgentFactory.getAgent(AgentName.SECOND_BRAIN)
      );
      logger.info('✅ Multi-agent coordinator initialized');
    } catch (error) {
      logger.error('Error initializing agents:', error);
    }
  }

  async handleRequest(messageText: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      const requestContext = RequestContext.get();
      const intentDecision = await this.openaiService.detectIntent(messageText, context);
      logger.info(
        `🧭 Orchestrator intent: ${intentDecision.primaryIntent} (plan: ${intentDecision.requiresPlan}, agents: ${
          intentDecision.involvedAgents.join(', ') || 'none'
        })`
      );

      if (intentDecision.primaryIntent === 'general' || intentDecision.involvedAgents.length === 0) {
        return await this.generateGeneralResponse(context, messageText);
      }

      const involvedAgents = this.resolveInvolvedAgents(intentDecision);
      
      // Route directly to single agent if no planning needed
      // Intent detection now handles both multi-agent and single-agent multi-step scenarios
      if (!intentDecision.requiresPlan && involvedAgents.length === 1) {
        return await this.executeSingleAgent(involvedAgents[0], messageText, userPhone, context);
      }

      const plan = await this.planActions(messageText, context, involvedAgents);
      if (plan.length === 0) {
        logger.warn('Planner returned empty plan for orchestrated request');
        return this.buildNoActionResponse(intentDecision.primaryIntent);
      }

      const filteredPlan = plan.filter(action => this.isAgentAllowed(action.agent as AgentName, requestContext));

      if (filteredPlan.length === 0) {
        return this.buildCapabilityDeniedMessage(involvedAgents, requestContext);
      }

      const executionResults = await this.executePlan(filteredPlan, userPhone, context);
      const distinctAgents = new Set(filteredPlan.map(action => action.agent));

      if (distinctAgents.size <= 1) {
        return this.combineSingleAgentResults(filteredPlan[0].agent, executionResults);
      }

      return await this.buildSummary(filteredPlan, executionResults, context, userPhone);
    } catch (error) {
      logger.error('Error handling orchestrated request:', error);
      return 'An error occurred while coordinating your request.';
    }
  }

  private async planActions(
    messageText: string,
    context: any[] = [],
    allowedAgents: AgentName[] = []
  ): Promise<PlannedAction[]> {
    const baseMessages = this.buildPlannerMessages(messageText, context, allowedAgents);

    try {
      const plan = await this.requestPlan(baseMessages);
      if (allowedAgents.length === 0) {
        return plan;
      }

      return plan.filter(action => allowedAgents.includes(action.agent));
    } catch (error) {
      logger.error('Failed to obtain multi-agent plan:', error);
      return [];
    }
  }

  private resolveInvolvedAgents(intentDecision: IntentDecision): AgentName[] {
    const knownAgents: AgentName[] = [AgentName.CALENDAR, AgentName.GMAIL, AgentName.DATABASE, AgentName.SECOND_BRAIN];

    const explicitAgents = intentDecision.involvedAgents.filter(agent => knownAgents.includes(agent));
    if (explicitAgents.length > 0) {
      return explicitAgents;
    }

    if (
      intentDecision.primaryIntent !== 'general' &&
      intentDecision.primaryIntent !== AgentName.MULTI_TASK &&
      knownAgents.includes(intentDecision.primaryIntent)
    ) {
      return [intentDecision.primaryIntent];
    }

    // Fallback for ambiguous multi-task intents: allow all
    if (intentDecision.primaryIntent === AgentName.MULTI_TASK) {
      return knownAgents;
    }

    return [];
  }

  private async executeSingleAgent(
    agentName: AgentName,
    messageText: string,
    userPhone: string,
    context: any[]
  ): Promise<string> {
    const requestContext = RequestContext.get();
    const accessError = this.getAgentAccessError(agentName, requestContext);
    if (accessError) {
      return accessError;
    }

    const agent = this.agents.get(agentName as CoordinatorAgent);
    if (!agent) {
      logger.error(`Agent not initialized: ${agentName}`);
      return 'The requested capability is currently unavailable.';
    }

    try {
      logger.info(`🔁 Delegating request directly to ${agentName} agent`);
      return await (agent as any).processRequest(messageText, userPhone, context);
    } catch (error) {
      logger.error(`Direct agent execution failed for ${agentName}`, error);
      return 'I encountered an error while handling your request. Please try again.';
    }
  }

  private buildNoActionResponse(intent: IntentDecision['primaryIntent']): string {
    if (intent === 'general') {
      return 'לא זיהיתי פעולה לביצוע, אשמח לעזור אם תפרט קצת יותר.';
    }
    return 'מצטער, לא הצלחתי לפרק את הבקשה לפעולות.';
  }

  private buildCapabilityDeniedMessage(
    agents: AgentName[],
    requestContext: ReturnType<typeof RequestContext.get>
  ): string {
    if (agents.length === 1) {
      const accessError = this.getAgentAccessError(agents[0], requestContext);
      if (accessError) {
        return accessError;
      }
    }
    return 'The requested actions require capabilities that are not available on your current plan.';
  }

  private buildPlannerMessages(
    messageText: string,
    context: any[],
    allowedAgents: AgentName[] = []
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: SystemPrompts.getMultiAgentPlannerPrompt()
      }
    ];

    if (allowedAgents.length > 0) {
      messages.push({
        role: 'system',
        content: `You may only generate actions for the following agents: ${allowedAgents.join(
          ', '
        )}. Do not invent actions for other agents.`
      });
    }

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

  private getAgentAccessError(agent: AgentName, context: ReturnType<typeof RequestContext.get>): string | null {
    if (!context) {
      return null;
    }

    switch (agent) {
      case AgentName.CALENDAR:
        if (!context.capabilities.calendar) {
          return 'Your current plan does not include calendar features.';
        }
        if (!context.googleConnected) {
          return 'Please connect your Google account before using calendar features.';
        }
        return null;
      case AgentName.GMAIL:
        if (!context.capabilities.gmail) {
          return 'Upgrade to the pro plan to enable Gmail features.';
        }
        if (!context.googleConnected) {
          return 'Please connect your Google account before using Gmail features.';
        }
        return null;
      case AgentName.DATABASE:
        if (!context.capabilities.database) {
          return 'Your plan does not include database features.';
        }
        return null;
      case AgentName.SECOND_BRAIN:
        // Second brain is available to all users (no special requirements)
        return null;
      default:
        return null;
    }
  }

  private async requestPlan(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    attempt = 1
  ): Promise<PlannedAction[]> {
    const requestId = setAgentNameForTracking('planner-creator-agent');

    const completion = await this.openaiService.createCompletion({
      messages: messages as any,
      temperature: 0.2,
      maxTokens: 1000,
      model: DEFAULT_MODEL
    }, requestId);

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

      if (agent !== AgentName.DATABASE && agent !== AgentName.CALENDAR && agent !== AgentName.GMAIL && agent !== AgentName.SECOND_BRAIN) {
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

  private combineSingleAgentResults(agent: CoordinatorAgent, results: ExecutionResult[]): string {
    const responses = results
      .filter(result => result.success && typeof result.response === 'string' && result.response.trim().length > 0)
      .map(result => result.response!.trim());

    if (responses.length > 0) {
      return responses.join('\n\n');
    }

    const failed = results.find(result => result.status === 'failed');
    if (failed?.error) {
      return failed.error;
    }

    const blocked = results.find(result => result.status === 'blocked');
    if (blocked?.error) {
      return blocked.error;
    }

    return 'I was unable to complete the requested action.';
  }

  private async generateGeneralResponse(context: any[], messageText: string): Promise<string> {
    const requestId = setAgentNameForTracking('orchestrator');

    const messages: any[] = [
      {
        role: 'system',
        content: SystemPrompts.getMainAgentPrompt()
      },
      ...context,
      {
        role: 'user',
        content: messageText
      }
    ];

    const completion = await this.openaiService.createCompletion({
      messages: messages as any,
      temperature: 0.7,
      maxTokens: 500
    }, requestId);

    return completion.choices[0]?.message?.content?.trim() || 'I could not generate a response.';
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

  private isAgentAllowed(agent: AgentName, context: ReturnType<typeof RequestContext.get>): boolean {
    return !this.getAgentAccessError(agent, context);
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

      const requestId = setAgentNameForTracking('orchistrator-response-generator');

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
        // temperature: 0.4,
        // maxTokens: 300,
        model: DEFAULT_MODEL
      }, requestId);

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

  /**
   * Check if request requires multi-step plan even for single agent
   * Uses LLM to detect if request contains multiple operations (e.g., delete + add)
   */
  // REMOVED: requiresMultiStepPlan function
  // Logic consolidated into intent detection (OpenAIService.detectIntent)
  // Intent detection now handles both multi-agent and single-agent multi-step scenarios
  // This eliminates redundant AI calls and simplifies the codebase
}
