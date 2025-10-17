import { OpenAIService } from '../ai/OpenAIService';
import { ContactLookupService } from '../contact/ContactLookupService';
import { logger } from '../../utils/logger';
import { ServiceContainer } from '../../core/container/ServiceContainer';

export interface Task {
  type: string;
  agent: string;
  message: string;
  requiresContactLookup?: boolean;
  priority?: number;
}

export interface MultiTaskResult {
  success: boolean;
  tasks: Task[];
  error?: string;
}

export class MultiTaskService {
  private openaiService: OpenAIService;
  private contactLookupService: ContactLookupService;
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
    this.openaiService = container.getOpenAIService();
    this.contactLookupService = container.getContactLookupService();
  }

  /**
   * Parse multi-task request using LLM
   */
  async parseMultiTaskRequest(messageText: string, userPhone: string): Promise<MultiTaskResult> {
    try {
      logger.info(`🧠 Parsing multi-task request with LLM: "${messageText}"`);

      const completion = await this.openaiService.createCompletion({
        messages: [
          {
            role: 'system',
            content: `You are a multi-task parser. Analyze the user's request and break it down into individual tasks.

Available task types:
- contact_lookup: Search for contact information
- calendar_event: Create calendar event with attendees
- email_invitation: Send email invitation
- create_task: Create a task in database
- add_to_calendar: Add item to calendar

Available agents:
- database: For contact lookup and task creation
- calendar: For calendar operations
- gmail: For email operations (NOT "email")

IMPORTANT: Always use "gmail" as agent name for email operations, never "email"

For meeting requests with attendees, ALWAYS:
1. First lookup contact details
2. Create calendar event with attendees
3. Optionally send additional email (though Google Calendar sends invitations automatically)

Return ONLY a JSON array of tasks in this format:
[
  {
    "type": "contact_lookup",
    "agent": "database", 
    "message": "Search for contact: [name]",
    "requiresContactLookup": true,
    "priority": 1
  },
  {
    "type": "calendar_event",
    "agent": "calendar",
    "message": "Create calendar event: [details]",
    "requiresContactLookup": true,
    "priority": 2
  },
  {
    "type": "email_invitation",
    "agent": "gmail",
    "message": "Send email invitation: [details]",
    "requiresContactLookup": true,
    "priority": 3
  }
]`
          },
          {
            role: 'user',
            content: messageText
          }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.1
      });

      const response = completion.choices[0]?.message?.content?.trim();
      if (!response) {
        return { success: false, error: 'No response from LLM', tasks: [] };
      }

      try {
        const tasks = JSON.parse(response) as Task[];
        logger.info(`📋 LLM parsed ${tasks.length} tasks`);
        
        return {
          success: true,
          tasks: tasks.sort((a, b) => (a.priority || 0) - (b.priority || 0))
        };
      } catch (parseError) {
        logger.error('Error parsing LLM response:', parseError);
        return { success: false, error: 'Failed to parse LLM response', tasks: [] };
      }

    } catch (error) {
      logger.error('Error in parseMultiTaskRequest:', error);
      return { success: false, error: 'Failed to parse multi-task request', tasks: [] };
    }
  }

  /**
   * Execute multi-task workflow
   */
  async executeMultiTask(messageText: string, userPhone: string): Promise<string> {
    try {
      // Parse tasks using LLM
      const parseResult = await this.parseMultiTaskRequest(messageText, userPhone);
      if (!parseResult.success) {
        return `שגיאה בניתוח הבקשה: ${parseResult.error}`;
      }

      const tasks = parseResult.tasks;
      const results = [];
      let contactDetails: any = null;

      // Execute tasks in order
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        logger.info(`🔧 Executing task ${i + 1}/${tasks.length}: ${task.type}`);

        // Special handling for contact lookup
        if (task.type === 'contact_lookup') {
          const contactResult = await this.handleContactLookup(task.message, userPhone);
          if (contactResult.success) {
            contactDetails = contactResult.contact;
            results.push({
              task: task.type,
              success: true,
              result: `מצאתי איש קשר: ${contactDetails.name} (${contactDetails.email})`
            });
          } else {
            results.push({
              task: task.type,
              success: false,
              result: contactResult.error || 'לא נמצא איש קשר'
            });
            // STOP the process if contact lookup fails
            logger.info('❌ Stopping multi-task process - contact not found');
            break;
          }
          continue;
        }

        // Update task message with contact details
        let taskMessage = task.message;
        if (contactDetails && task.requiresContactLookup) {
          taskMessage = this.updateTaskWithContactDetails(task, contactDetails);
        }

        // Execute task with appropriate agent
        const agent = this.getAgent(task.agent);
        if (!agent) {
          results.push({
            task: task.type,
            success: false,
            result: `Agent '${task.agent}' not found`
          });
          continue;
        }

        const result = await agent.processRequest(taskMessage, userPhone);
        results.push({
          task: task.type,
          success: !result.includes('error'),
          result: result
        });

        logger.info(`✅ Task completed: ${task.type}`);
      }

      // Format final response
      const successfulTasks = results.filter(r => r.success).length;
      const totalTasks = results.length;

      let response = `✅ ביצעתי ${successfulTasks} מתוך ${totalTasks} משימות:\n\n`;
      results.forEach((result, index) => {
        response += `${index + 1}. ${result.task}: ${result.success ? '✅ הצליח' : '❌ נכשל'}\n`;
      });

      return response;

    } catch (error) {
      logger.error('Error in executeMultiTask:', error);
      return 'מצטער, אירעה שגיאה בעיבוד הבקשה המורכבת. נסה שוב.';
    }
  }

  /**
   * Handle contact lookup using real database
   */
  private async handleContactLookup(searchMessage: string, userPhone: string): Promise<{success: boolean, contact?: any, error?: string}> {
    try {
      // Extract name from search message
      const nameMatch = searchMessage.match(/Search for contact:\s*(.+)/);
      if (!nameMatch) {
        return { success: false, error: 'לא ניתן לזהות שם לחיפוש' };
      }

      const searchName = nameMatch[1].trim();
      logger.info(`🔍 Searching for contact: "${searchName}" in database`);
      
      // Use database agent to search for contacts
      const databaseAgent = this.getAgent('database');
      const searchResult = await databaseAgent.processRequest(`חפש איש קשר בשם: ${searchName}`, userPhone);
      
      logger.info(`📋 Database search result: ${searchResult}`);
      
      // Parse the result to extract actual contact information from database
      if (searchResult.includes('מצאתי') || searchResult.includes('נמצא')) {
        // Extract actual contact data from database response
        const contactData = this.extractContactFromResponse(searchResult);
        if (contactData && contactData.email) {
          logger.info(`✅ Found contact: ${contactData.name} (${contactData.email})`);
          return {
            success: true,
            contact: contactData
          };
        } else {
          logger.info(`❌ Contact found but no email address: ${searchName}`);
          return { success: false, error: `נמצא איש קשר "${searchName}" אבל אין כתובת מייל` };
        }
      } else {
        logger.info(`❌ No contact found for: ${searchName}`);
        return { success: false, error: `לא נמצא איש קשר בשם "${searchName}"` };
      }

    } catch (error) {
      logger.error('Error in handleContactLookup:', error);
      return { success: false, error: 'שגיאה בחיפוש איש קשר' };
    }
  }

  /**
   * Extract contact data from database response
   */
  private extractContactFromResponse(response: string): any {
    try {
      // Parse the database response to extract contact information
      // Look for patterns like: "Name: שון חזן, Email: shaon@example.com"
      
      const nameMatch = response.match(/שם[:\s]*([^,\n]+)/);
      const emailMatch = response.match(/מייל[:\s]*([^,\n\s]+)/);
      const phoneMatch = response.match(/טלפון[:\s]*([^,\n\s]+)/);
      
      if (nameMatch && emailMatch) {
        return {
          name: nameMatch[1].trim(),
          email: emailMatch[1].trim(),
          phone: phoneMatch ? phoneMatch[1].trim() : undefined
        };
      }
      
      // Alternative pattern matching
      const altEmailMatch = response.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (altEmailMatch) {
        return {
          name: 'Contact',
          email: altEmailMatch[1],
          phone: undefined
        };
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting contact from response:', error);
      return null;
    }
  }

  /**
   * Update task message with contact details
   */
  private updateTaskWithContactDetails(task: Task, contactDetails: any): string {
    if (task.type === 'calendar_event' && contactDetails.email) {
      // Create proper calendar event with attendees
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().split('T')[0];
      
      return `Create calendar event:
summary: Meeting with ${contactDetails.name}
start: ${dateStr}T10:00:00+03:00
end: ${dateStr}T11:00:00+03:00
description: Meeting with ${contactDetails.name}
attendees: ${contactDetails.email}`;
    }
    
    if (task.type === 'email_invitation' && contactDetails.email) {
      return `Send email to ${contactDetails.email} with invitation for meeting with ${contactDetails.name}`;
    }

    return task.message;
  }

  /**
   * Get agent instance from AgentManager
   */
  private getAgent(agentName: string): any {
    try {
      const { AgentManager } = require('../../core/manager/AgentManager');
      const agentManager = AgentManager.getInstance();
      return agentManager.getAgent(agentName);
    } catch (error) {
      logger.error(`Error getting agent ${agentName}:`, error);
      return null;
    }
  }
}
