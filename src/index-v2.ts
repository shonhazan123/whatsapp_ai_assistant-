import { ServiceContainer } from './core/container/ServiceContainer';
import { AgentFactory } from './core/factory/AgentFactory';
import { OpenAIService } from './services/ai/OpenAIService';
import { FunctionHandler } from './core/base/FunctionHandler';
import { logger } from './utils/logger';

// Initialize the new architecture
function initializeArchitecture() {
  // Get service container
  const container = ServiceContainer.getInstance();
  
  // Initialize AgentFactory with dependencies
  AgentFactory.initialize( container.getOpenAIService(), container.getFunctionHandler(),container.getLogger());
  
  logger.info('🚀 New architecture initialized successfully');
}

// Export the new processMessage function
export async function processMessageV2(userPhone: string , messageText: string ): Promise<string> {
  try {
    // Initialize architecture if not already done
    initializeArchitecture();
    
    // Create appropriate agent based on intent
    const openaiService = ServiceContainer.getInstance().getOpenAIService();
    const intent = await openaiService.detectIntent(messageText);
        
    // Route to appropriate agent
    let agent;
    switch (intent) {
      case 'calendar':
        agent = AgentFactory.getAgent('calendar');
        break;
      case 'email':
        agent = AgentFactory.getAgent('email');
        break;
      case 'database':
        agent = AgentFactory.getAgent('database');
        break;
      default:
        agent = AgentFactory.getAgent('general');
        break;
    }
    
    // Process the request
    const response = await agent.processRequest(messageText, userPhone);
    
    logger.info(`✅ Response generated for intent: ${intent}`);
    return response;
    
  } catch (error) {
    logger.error('Error in processMessageV2:', error);
    return 'Sorry, I encountered an error processing your request. Please try again.';
  }
}

// Export services for external use
export { ServiceContainer, AgentFactory };
export * from './core/types/AgentTypes';
export * from './services/database/TaskService';
export * from './services/database/ContactService';
export * from './services/database/ListService';
export * from './services/database/UserDataService';
export * from './services/calendar/CalendarService';
export * from './services/email/GmailService';
