import { ServiceContainer } from './core/container/ServiceContainer';
import { AgentManager } from './core/manager/AgentManager';
import { logger } from './utils/logger';

// Global AgentManager instance (singleton)
let agentManager: AgentManager;

// Initialize the new architecture
function initializeArchitecture() {
  try {
    logger.info('🚀 Initializing V2 architecture...');
    
    // Initialize AgentManager (handles all agents and orchestration as singletons)
    agentManager = AgentManager.getInstance();
    agentManager.initialize();
    
    logger.info('✅ V2 architecture initialized successfully');
    logger.info('📊 AgentManager status:', agentManager.getStatus());
    
  } catch (error) {
    logger.error('❌ Failed to initialize V2 architecture:', error);
    throw error;
  }
}




// Export the new processMessage function with Advanced Orchestration
export async function processMessageV2(userPhone: string, messageText: string): Promise<string> {
  try {
    // Initialize architecture if not already done
    if (!agentManager) {
      initializeArchitecture();
    }
    
    // Ensure AgentManager is initialized
    if (!agentManager.isInitialized()) {
      throw new Error('AgentManager not properly initialized');
    }
    
    const openaiService = ServiceContainer.getInstance().getOpenAIService();
    const intent = await openaiService.detectIntent(messageText);
    
    logger.info(`🎯 Intent detected: ${intent}`);
    
    // Advanced Orchestration Routing using singleton agents
    switch (intent) {
      case 'planning':
        // Use MainAgent for planning requests (simplified)
        logger.info('🧠 Planning - using Main Agent');
        return await agentManager.getMainAgent().processRequest(messageText, userPhone);
        
      case 'study-planning':
        // Use MainAgent for study planning (simplified)
        logger.info('📚 Study Planning - using Main Agent');
        return await agentManager.getMainAgent().processRequest(messageText, userPhone);
        
      case 'multi-task':
        // Use MultiAgentCoordinator singleton for complex multi-agent tasks
        logger.info('🤝 Multi-Agent Coordination activated');
        return await agentManager.getMultiAgentCoordinator().executeActions(messageText, userPhone);
        
      case 'calendar':
        logger.info('📅 Calendar Agent activated');
        return await agentManager.getCalendarAgent().processRequest(messageText, userPhone);
        
      case 'gmail':
        logger.info('📧 Gmail Agent activated');
        return await agentManager.getGmailAgent().processRequest(messageText, userPhone);
        
      case 'database':
        logger.info('💾 Database Agent activated');
        return await agentManager.getDatabaseAgent().processRequest(messageText, userPhone);
        
      default:  
        // Use main agent for general requests
        logger.info('🤖 Main Agent activated');
        return await agentManager.getMainAgent().processRequest(messageText, userPhone);
    }
    
  } catch (error) {
    logger.error('Error in processMessageV2:', error);
    return 'Sorry, I encountered an error processing your request. Please try again.';
  }
}

// Export services for external use
export { ServiceContainer, AgentManager };
export * from './core/types/AgentTypes';
export * from './services/database/TaskService';
export * from './services/database/ContactService';
export * from './services/database/ListService';
export * from './services/database/UserDataService';
export * from './services/calendar/CalendarService';
export * from './services/email/GmailService';
