import { BaseAgent } from '../../core/base/BaseAgent';
import { FunctionHandler } from '../../core/base/FunctionHandler';
import { PlanningContext, PlanningContextManager } from '../../context/PlanningContext';
import { StudyPlanningWorkflow } from '../../workflows/StudyPlanningWorkflow';
import { BaseWorkflow } from '../../workflows/BaseWorkflow';
import { BaseStrategy } from '../../strategies/BaseStrategy';
import { StudyStrategy } from '../../strategies/StudyStrategy';
import { logger } from '../../utils/logger';

export interface PlanningRequest {
  goal: string;
  collectedData?: Record<string, any>;
  constraints?: {
    startDate?: Date;
    endDate?: Date;
    availableHours?: string[];
  };
  requirements?: {
    subjects?: string[];
    topics?: string[];
    duration?: number;
  };
}

export class PlanningAgent extends BaseAgent {
  private contextManager: PlanningContextManager;
  private workflows: Map<string, BaseWorkflow> = new Map();
  private strategies: BaseStrategy[] = [];

  constructor(openaiService: any, functionHandler: FunctionHandler, logger: any) {
    super(openaiService, functionHandler, logger);
    
    this.contextManager = new PlanningContextManager();
    this.initializeStrategies();
    this.initializeWorkflows();
    this.registerFunctions();
  }

  /**
   * Initialize available strategies
   */
  private initializeStrategies(): void {
    this.strategies = [
      new StudyStrategy()
      // Add more strategies here
    ];
  }

  /**
   * Initialize available workflows
   */
  private initializeWorkflows(): void {
    this.workflows.set('study', new StudyPlanningWorkflow());
    // Add more workflows here
  }

  /**
   * Get system prompt
   */
  getSystemPrompt(): string {
    return `אתה Planning Agent - סוכן תכנון חכם שמסייע למשתמשים לתכנן משימות, לימודים, פגישות ועוד.

תפקידים:
1. זיהוי מטרות תכנון מהודעות המשתמש
2. שאילת שאלות רלוונטיות לאיסוף מידע
3. יצירת תוכניות מפורטות ומתאימות
4. הצגת תוכניות לאישור המשתמש
5. יישום תוכניות לאחר אישור

כללים:
- תמיד ענה בשפה שבה המשתמש מדבר (עברית או אנגלית)
- שאל שאלות רלוונטיות רק אם חסר מידע חיוני
- הצג תוכניות בצורה ברורה ומפורטת
- חכה לאישור המשתמש לפני יישום התוכנית
- ספק עדכונים בזמן אמת על התקדמות`;

  }

  /**
   * Get functions
   */
  getFunctions(): any[] {
    return [
      {
        name: 'start_planning',
        description: 'התחל תהליך תכנון חדש עם מטרה מסוימת',
        parameters: {
          type: 'object',
          properties: {
            goal: {
              type: 'string',
              description: 'המטרה של התכנון (למשל: "לתכנן לימודים למבחן", "לתכנן שבוע")'
            },
            subjects: {
              type: 'array',
              items: { type: 'string' },
              description: 'רשימת נושאים/מקצועות (אם רלוונטי)'
            },
            startDate: {
              type: 'string',
              description: 'תאריך התחלה (ISO format)'
            },
            endDate: {
              type: 'string',
              description: 'תאריך סיום (ISO format)'
            },
            duration: {
              type: 'number',
              description: 'משך זמן מועדף לכל סשן (בשעות)'
            }
          },
          required: ['goal']
        }
      },
      {
        name: 'provide_additional_info',
        description: 'ספק מידע נוסף לתהליך התכנון',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              description: 'מפתח המידע (למשל: "subjects", "topics", "duration")'
            },
            value: {
              type: 'string',
              description: 'הערך של המידע'
            }
          },
          required: ['key', 'value']
        }
      },
      {
        name: 'approve_plan',
        description: 'אשר את התוכנית המוצעת',
        parameters: {
          type: 'object',
          properties: {
            approved: {
              type: 'boolean',
              description: 'האם לאשר את התוכנית'
            },
            modifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['add', 'remove', 'modify'] },
                  item: { type: 'string' }
                }
              },
              description: 'שינויים לבקש בתוכנית'
            }
          },
          required: ['approved']
        }
      }
    ];
  }

  /**
   * Register OpenAI functions
   */
  protected registerFunctions(): void {
    // Functions are registered via getFunctions()
  }

  /**
   * Get user result (helper method)
   */
  private async getUserResult(userPhone: string): Promise<any> {
    const { query } = await import('../../config/database');
    return await query('SELECT get_or_create_user($1) as user_id', [userPhone]);
  }

  /**
   * Process planning request
   */
  async processRequest(message: string, userPhone: string): Promise<string> {
    try {
      // Get or create context
      let context = this.contextManager.getContext(userPhone);

      if (!context) {
        // New planning session
        const userResult = await this.getUserResult(userPhone);
        const userId = userResult.rows[0].user_id;

        // Create context
        context = this.contextManager.createContext(userPhone, userId, message);
      }

      // Build messages for OpenAI
      const messages = [
        { role: 'system' as const, content: this.getSystemPrompt() },
        { role: 'user' as const, content: message }
      ];

      // Create completion
      const response = await this.openaiService.createCompletion({
        messages,
        functions: this.getFunctions(),
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 1000
      });

      // Check if any functions were called
      const choice = response.choices[0];
      if (choice?.message?.function_call) {
        const result = await this.handleFunctionCall(
          choice.message.function_call.name,
          JSON.parse(choice.message.function_call.arguments),
          userPhone,
          context
        );

        return result;
      }

      return choice?.message?.content || 'לא הצלחתי לעבד את הבקשה';

    } catch (error) {
      logger.error('Error processing planning request:', error);
      throw error;
    }
  }

  /**
   * Handle function calls
   */
  private async handleFunctionCall(
    functionName: string,
    args: any,
    userPhone: string,
    context: PlanningContext
  ): Promise<string> {
    try {
      switch (functionName) {
        case 'start_planning':
          return await this.startPlanning(args, userPhone, context);
        
        case 'provide_additional_info':
          return await this.provideAdditionalInfo(args, userPhone, context);
        
        case 'approve_plan':
          return await this.approvePlan(args, userPhone, context);
        
        default:
          return 'פונקציה לא מזוהה';
      }
    } catch (error) {
      logger.error(`Error handling function ${functionName}:`, error);
      return 'אירעה שגיאה בעיבוד הבקשה';
    }
  }

  /**
   * Start planning process
   */
  private async startPlanning(args: any, userPhone: string, context: PlanningContext): Promise<string> {
    try {
      // Update context with collected data
      if (args.subjects) {
        context.collectedData.subjects = args.subjects;
      }
      if (args.startDate) {
        context.collectedData.startDate = new Date(args.startDate);
      }
      if (args.endDate) {
        context.collectedData.endDate = new Date(args.endDate);
      }
      if (args.duration) {
        context.collectedData.duration = args.duration;
      }

      // Find best strategy
      const bestStrategy = this.findBestStrategy(context.goal, context);

      if (!bestStrategy) {
        return 'לא הצלחתי למצוא אסטרטגיה מתאימה למטרה שלך. אנא נסה לנסח את המטרה בצורה אחרת.';
      }

      // Find corresponding workflow
      const workflow = this.workflows.get('study'); // For now, default to study

      if (!workflow) {
        return 'לא הצלחתי למצוא workflow מתאים.';
      }

      // Execute workflow
      const updatedContext = await workflow.execute(context);

      // Update context in manager
      this.contextManager.updateContext(userPhone, updatedContext);

      // Build response based on current phase
      return this.buildPhaseResponse(updatedContext);

    } catch (error) {
      logger.error('Error starting planning:', error);
      return 'אירעה שגיאה בתהליך התכנון';
    }
  }

  /**
   * Provide additional information
   */
  private async provideAdditionalInfo(args: any, userPhone: string, context: PlanningContext): Promise<string> {
    // Add data to context
    context.collectedData[args.key] = args.value;
    this.contextManager.updateContext(userPhone, context);

    // Check if we have all required data
    const bestStrategy = this.findBestStrategy(context.goal, context);
    if (bestStrategy && bestStrategy.hasRequiredData(context)) {
      return 'תודה! יש לי את כל המידע הדרוש. אני מתחיל ליצור תוכנית...';
    }

    return 'תודה! האם יש עוד פרטים שתרצה לשתף?';
  }

  /**
   * Approve plan
   */
  private async approvePlan(args: any, userPhone: string, context: PlanningContext): Promise<string> {
    const workflow = this.workflows.get('study');
    
    if (!workflow) {
      return 'לא נמצא workflow פעיל';
    }

    // Handle approval
    await (workflow as any).handleApprovalResponse(context, args.approved, args.modifications);

    // Update context
    this.contextManager.updateContext(userPhone, context);

    if (args.approved) {
      return '✅ תודה! אני מתחיל ליישם את התוכנית...';
    } else {
      return 'אוקיי, בואו ננסה שוב. מה תרצה לשנות?';
    }
  }

  /**
   * Find best strategy for goal
   */
  private findBestStrategy(goal: string, context: PlanningContext): BaseStrategy | null {
    let bestStrategy: BaseStrategy | null = null;
    let bestConfidence = 0;

    for (const strategy of this.strategies) {
      const confidence = strategy.getConfidence(goal, context);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestStrategy = strategy;
      }
    }

    return bestStrategy;
  }

  /**
   * Build response based on current phase
   */
  private buildPhaseResponse(context: PlanningContext): string {
    switch (context.currentPhase) {
      case 'discovery':
        return 'אני צריך עוד קצת מידע. מה הנושאים שאתה צריך ללמוד?';
      
      case 'analysis':
        return 'אני מנתח את המטרה שלך...';
      
      case 'planning':
        return 'אני יוצר תוכנית עבורך...';
      
      case 'validation':
        if (context.proposedPlan) {
          return this.buildPlanSummary(context.proposedPlan);
        }
        return 'אני מציג לך את התוכנית...';
      
      case 'execution':
        return 'אני מיישם את התוכנית...';
      
      case 'completed':
        return '✅ התוכנית הושלמה בהצלחה!';
      
      case 'cancelled':
        return '❌ התהליך בוטל';
      
      default:
        return 'אני מעבד את הבקשה שלך...';
    }
  }

  /**
   * Build plan summary
   */
  private buildPlanSummary(plan: any): string {
    const lines: string[] = [];
    
    lines.push('📋 *התוכנית שלך:*\n');
    lines.push(`אסטרטגיה: ${plan.strategy}`);
    lines.push(`ביטחון: ${Math.round(plan.confidence * 100)}%`);
    lines.push(`\n*ציר זמן:*`);

    plan.timeline.forEach((day: any, index: number) => {
      const dateStr = day.date.toLocaleDateString('he-IL');
      lines.push(`\n📅 ${dateStr}:`);

      if (day.tasks && day.tasks.length > 0) {
        lines.push(`*משימות:*`);
        day.tasks.forEach((task: any, taskIndex: number) => {
          lines.push(`  ${taskIndex + 1}. ${task.title}`);
        });
      }
    });

    lines.push(`\n✅ אישור | ❌ דחייה`);
    lines.push(`💡 תוכל לבקש שינויים`);

    return lines.join('\n');
  }
}
