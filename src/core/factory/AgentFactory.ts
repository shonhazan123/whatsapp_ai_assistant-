import { IAgent } from '../interfaces/IAgent';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { FunctionHandler } from '../base/FunctionHandler';
import { logger } from '../../utils/logger';
import { DatabaseAgent } from '../../agents/v2/DatabaseAgent';
import { CalendarAgent } from '../../agents/v2/CalendarAgent';
import { GmailAgent } from '../../agents/v2/GmailAgent';
import { MainAgent } from '../../agents/v2/MainAgent';

export type AgentType = 'database' | 'calendar' | 'gmail' | 'main';

export class AgentFactory {
  private static instances: Map<AgentType, IAgent> = new Map();
  private static openaiService: OpenAIService;
  private static functionHandler: FunctionHandler;
  private static logger: any;

  static initialize( openaiService: OpenAIService, functionHandler: FunctionHandler, loggerInstance: any = logger ): void
   {
    AgentFactory.openaiService = openaiService;
    AgentFactory.functionHandler = functionHandler;
    AgentFactory.logger = loggerInstance;
  }

  static createAgent(type: AgentType): IAgent {
    if (AgentFactory.instances.has(type)) {
      return AgentFactory.instances.get(type)!;
    }

    if (!AgentFactory.openaiService || !AgentFactory.functionHandler || !AgentFactory.logger) {
      throw new Error('AgentFactory must be initialized before creating agents');
    }

    let agent: IAgent;

    switch (type) {
      case 'database':
        agent = new DatabaseAgent(
          AgentFactory.openaiService,
          AgentFactory.functionHandler,
          AgentFactory.logger
        );
        break;

      case 'calendar':
        agent = new CalendarAgent(
          AgentFactory.openaiService,
          AgentFactory.functionHandler,
          AgentFactory.logger
        );
        break;

      case 'gmail':
        agent = new GmailAgent(
          AgentFactory.openaiService,
          AgentFactory.functionHandler,
          AgentFactory.logger
        );
        break;

      case 'main':
        agent = new MainAgent(
          AgentFactory.openaiService,
          AgentFactory.functionHandler,
          AgentFactory.logger
        );
        break;

      default:
        throw new Error(`Unknown agent type: ${type}`);
    }

    AgentFactory.instances.set(type, agent);
    return agent;
  }

  static getAgent(type: AgentType): IAgent {
    return AgentFactory.createAgent(type);
  }

  static clearInstances(): void {
    AgentFactory.instances.clear();
  }

  static getAllAgentTypes(): AgentType[] {
    return ['database', 'calendar', 'gmail', 'main'];
  }
}
