import { MultiAgentCoordinator } from '../../orchestration/MultiAgentCoordinator';
import { logger } from '../../utils/logger';
import { ServiceContainer } from '../container/ServiceContainer';
import { AgentFactory } from '../factory/AgentFactory';
// import { PlanningAgent } from '../../agents/v2/PlanningAgent'; // Removed - not needed
import { IAgent, AgentName } from '../interfaces/IAgent';

/**
 * Singleton AgentManager that handles all agent initialization and lifecycle
 * Ensures consistent factory architecture and prevents memory leaks
 */
export class AgentManager {
  private static instance: AgentManager;


  // Core agents (singletons)
  private databaseAgent: IAgent | null = null;
  private calendarAgent: IAgent | null = null;
  private gmailAgent: IAgent | null = null;
  private mainAgent: IAgent | null = null;
  
  // Orchestration components (singletons)
  private multiAgentCoordinator: MultiAgentCoordinator | null = null;
  // private planningAgent: PlanningAgent | null = null; // Removed - not needed
  
  // Service container
  private container: ServiceContainer;
  
  private constructor() {
    this.container = ServiceContainer.getInstance();
    logger.info('🏗️ AgentManager singleton created');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): AgentManager {
    if (!AgentManager.instance) {
      AgentManager.instance = new AgentManager();
    }
    return AgentManager.instance;
  }
  
  /**
   * Initialize all agents and orchestration components
   * This should be called once at application startup
   */
  public initialize(): void {
    try {
      logger.info('🚀 Initializing AgentManager...');
      
      // Initialize AgentFactory with dependencies
      AgentFactory.initialize(
        this.container.getOpenAIService(),
        this.container.getFunctionHandler(),
        this.container.getLogger()
      );
      
      // Initialize core agents as singletons
      this.initializeCoreAgents();
      
      // Initialize orchestration components as singletons
      this.initializeOrchestrationComponents();
      
      logger.info('✅ AgentManager initialized successfully');
      logger.info('📋 Available agents: database, calendar, gmail, main');
      logger.info('📋 Available orchestration: multi-agent-coordinator');
      
    } catch (error) {
      logger.error('❌ Failed to initialize AgentManager:', error);
      throw error;
    }
  }
  
  /**
   * Initialize core agents as singletons
   */
  private initializeCoreAgents(): void {
    logger.info('🔧 Initializing core agents...');
    
    this.databaseAgent = AgentFactory.getAgent(AgentName.DATABASE);
    this.calendarAgent = AgentFactory.getAgent(AgentName.CALENDAR);
    this.gmailAgent = AgentFactory.getAgent(AgentName.GMAIL);
    this.mainAgent = AgentFactory.getAgent(AgentName.MAIN);
    
    logger.info('✅ Core agents initialized');
  }
  
  /**
   * Initialize orchestration components as singletons
   */
  private initializeOrchestrationComponents(): void {
    logger.info('🎭 Initializing orchestration components...');
    
    // MultiAgentCoordinator (no parameters needed)
    this.multiAgentCoordinator = new MultiAgentCoordinator();
    
    // PlanningAgent removed - not needed for current architecture
    
    logger.info('✅ Orchestration components initialized');
  }
  
  /**
   * Get database agent (singleton)
   */
  public getDatabaseAgent(): IAgent {
    if (!this.databaseAgent) {
      throw new Error('DatabaseAgent not initialized. Call initialize() first.');
    }
    return this.databaseAgent;
  }
  
  /**
   * Get calendar agent (singleton)
   */
  public getCalendarAgent(): IAgent {
    if (!this.calendarAgent) {
      throw new Error('CalendarAgent not initialized. Call initialize() first.');
    }
    return this.calendarAgent;
  }
  
  /**
   * Get Gmail agent (singleton)
   */
  public getGmailAgent(): IAgent {
    if (!this.gmailAgent) {
      throw new Error('GmailAgent not initialized. Call initialize() first.');
    }
    return this.gmailAgent;
  }
  
  /**
   * Get main agent (singleton)
   */
  public getMainAgent(): IAgent {
    if (!this.mainAgent) {
      throw new Error('MainAgent not initialized. Call initialize() first.');
    }
    return this.mainAgent;
  }
  
  /**
   * Get multi-agent coordinator (singleton)
   */
  public getMultiAgentCoordinator(): MultiAgentCoordinator {
    if (!this.multiAgentCoordinator) {
      throw new Error('MultiAgentCoordinator not initialized. Call initialize() first.');
    }
    return this.multiAgentCoordinator;
  }
  
  // PlanningAgent methods removed - not needed for current architecture
  
  /**
   * Get agent by type (singleton)
   */
  public getAgent(type: 'database' | 'calendar' | 'gmail' | 'main'): IAgent {
    switch (type) {
      case 'database':
        return this.getDatabaseAgent();
      case 'calendar':
        return this.getCalendarAgent();
      case 'gmail':
        return this.getGmailAgent();
      case 'main':
        return this.getMainAgent();
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }
  
  /**
   * Check if all components are initialized
   */
  public isInitialized(): boolean {
    return !!(
      this.databaseAgent &&
      this.calendarAgent &&
      this.gmailAgent &&
      this.mainAgent &&
      this.multiAgentCoordinator
    );
  }
  
  /**
   * Get initialization status
   */
  public getStatus(): any {
    return {
      initialized: this.isInitialized(),
      coreAgents: {
        database: !!this.databaseAgent,
        calendar: !!this.calendarAgent,
        gmail: !!this.gmailAgent,
        main: !!this.mainAgent
      },
      orchestration: {
        multiAgentCoordinator: !!this.multiAgentCoordinator
      }
    };
  }
}
