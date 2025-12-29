import { ServiceContainer } from '../../core/container/ServiceContainer';
import { logger } from '../../utils/logger';
import { prependTimeContext } from '../../utils/timeContext';
import { OpenAIService } from '../ai/OpenAIService';

export interface Task {
  type: string;
  agent: string;
  message: string;
  priority?: number;
}

export interface MultiTaskResult {
  success: boolean;
  tasks: Task[];
  error?: string;
}

export class MultiTaskService {
  private openaiService: OpenAIService;
  private container: ServiceContainer;

  constructor(container: ServiceContainer) {
    this.container = container;
    this.openaiService = container.getOpenAIService();
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
    "type": "calendar_event",
    "agent": "calendar",
    "message": "Create calendar event: [details]",
    "priority": 1
  },
  {
    "type": "email_send",
    "agent": "gmail",
    "message": "Send email: [details]",
    "priority": 2
  }
]`
          },
          {
            role: 'user',
            content: prependTimeContext(messageText) // Inject time context for accurate time parsing
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
  async executeMultiTask(messageText: string, userPhone: string, context: any[] = []): Promise<string> {
    try {
      // Parse tasks using LLM
      const parseResult = await this.parseMultiTaskRequest(messageText, userPhone);
      if (!parseResult.success) {
        return `שגיאה בניתוח הבקשה: ${parseResult.error}`;
      }

      const tasks = parseResult.tasks;
      const results = [];
      let meetingLink: string | null = null;

      // Execute tasks in order
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        logger.info(`🔧 Executing task ${i + 1}/${tasks.length}: ${task.type}`);

        let taskMessage = task.message;

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

        const result = await agent.processRequest(taskMessage, userPhone, context);
        
        // Debug logging for calendar events
        if (task.type === 'calendar_event') {
          logger.info(`📅 Calendar event result: ${result}`);
        }
        
        // Special handling for calendar events to extract meeting link
        if (task.type === 'calendar_event' && result.includes('created') && result.includes('success')) {
          // Try multiple patterns to extract meeting link
          const linkPatterns = [
            /🔗 Meeting link: (https:\/\/[^\s]+)/i,
            /Meeting link: (https:\/\/[^\s]+)/i,
            /קישור לפגישה: (https:\/\/[^\s]+)/i,
            /(https:\/\/calendar\.google\.com\/calendar\/event\?eid=[^\s]+)/i,
            /meeting link: (https:\/\/[^\s]+)/i
          ];
          
          for (const pattern of linkPatterns) {
            const linkMatch = result.match(pattern);
            if (linkMatch) {
              meetingLink = linkMatch[1];
              logger.info(`🔗 Extracted meeting link: ${meetingLink}`);
              break;
            }
          }
          
          // If no link found in response, generate one from event ID if available
          if (!meetingLink) {
            const eventIdMatch = result.match(/event.*id[:\s]*([a-zA-Z0-9_-]+)/i);
            if (eventIdMatch) {
              meetingLink = `https://calendar.google.com/calendar/event?eid=${eventIdMatch[1]}`;
              logger.info(`🔗 Generated meeting link from event ID: ${meetingLink}`);
            }
          }
        }
        
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
