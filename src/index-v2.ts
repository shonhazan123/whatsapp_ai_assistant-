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
    
  } catch (error) {
    logger.error('❌ Failed to initialize V2 architecture:', error);
    throw error;
  }
}

// Export the new processMessage function with Advanced Orchestration
export async function processMessageV2(userPhone: string, messageText: string, options?: { whatsappMessageId?: string; replyToMessageId?: string;}): Promise<string> 
{
  try {
    // Initialize architecture if not already done
    if (!agentManager) {
      initializeArchitecture();
    }

    // Ensure AgentManager is initialized
    if (!agentManager.isInitialized()) {
      throw new Error('AgentManager not properly initialized');
    }

    // Centralize reasoning in MainAgent (intent parsing, delegation, final response)
    logger.info('🤖 Main Agent activated');
    return await agentManager.getMainAgent().processRequest(messageText, userPhone, options);

  } catch (error) {
    logger.error('Error in processMessageV2:', error);
    return 'Sorry, I encountered an error processing your request. Please try again.';
  }
}

// Export services for external use
export * from './core/types/AgentTypes';
export * from './services/calendar/CalendarService';
export * from './services/database/ContactService';
export * from './services/database/ListService';
export * from './services/database/TaskService';
export * from './services/database/UserDataService';
export * from './services/database/UserService';
export * from './services/email/GmailService';
export { AgentManager, ServiceContainer };

