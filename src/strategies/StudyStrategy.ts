import { BaseStrategy, AnalysisResult, ValidationResult } from './BaseStrategy';
import { PlanningContext, ProposedPlan } from '../context/PlanningContext';
import { logger } from '../utils/logger';

export class StudyStrategy extends BaseStrategy {
  constructor() {
    super({
      name: 'Study Planning',
      description: 'מתכנן לוח זמנים ללימודים עם חלוקה לנושאים וזמנים מוגדרים',
      phases: ['discovery', 'analysis', 'planning', 'validation', 'execution'],
      requiredData: ['subjects', 'topics', 'startDate', 'endDate']
    });
  }

  /**
   * Check if this strategy can handle the goal
   */
  canHandle(goal: string, context: PlanningContext): boolean {
    const studyKeywords = [
      'לימוד', 'למידה', 'סטודנט', 'קורס', 'בחינה', 'מבחן', 
      'שיעור', 'חומר', 'נושא', 'ללמוד', 'חזרה'
    ];
    
    const lowerGoal = goal.toLowerCase();
    return studyKeywords.some(keyword => lowerGoal.includes(keyword));
  }

  /**
   * Get confidence score
   */
  getConfidence(goal: string, context: PlanningContext): number {
    if (!this.canHandle(goal, context)) {
      return 0;
    }

    // Check if we have required data
    const hasData = this.hasRequiredData(context);
    if (!hasData) {
      return 0.5; // Medium confidence if missing some data
    }

    return 0.9; // High confidence for study planning
  }

  /**
   * Analyze the study goal
   */
  async analyze(context: PlanningContext): Promise<AnalysisResult> {
    logger.info('📚 Analyzing study planning request');

    // Extract subjects and topics from collected data
    const subjects = context.collectedData.subjects as string[] || [];
    const topics = context.collectedData.topics as string[] || [];

    // Calculate available time
    const startDate = context.collectedData.startDate as Date || new Date();
    const endDate = context.collectedData.endDate as Date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const workingDays = daysDiff * 0.7; // Assume 70% working days
    const timeAvailable = workingDays * 8; // 8 hours per working day

    return {
      goal: context.goal,
      constraints: {
        timeAvailable,
        startDate,
        endDate,
        blockedSlots: context.constraints.blockedSlots || []
      },
      requirements: {
        subjects,
        topics,
        duration: context.requirements.duration || 2 // Default 2 hours per session
      },
      confidence: 0.85
    };
  }

  /**
   * Generate study plan
   */
  async generatePlan(context: PlanningContext, analysis: AnalysisResult): Promise<ProposedPlan> {
    logger.info('📅 Generating study plan');

    const { subjects, topics } = analysis.requirements;
    const { timeAvailable, startDate, endDate } = analysis.constraints;
    const sessionDuration = analysis.requirements.duration || 2;

    // Ensure we have subjects
    if (!subjects || subjects.length === 0) {
      throw new Error('No subjects provided for study plan');
    }

    // Calculate sessions per subject
    const totalSessions = Math.floor(timeAvailable / sessionDuration);
    const sessionsPerSubject = Math.floor(totalSessions / subjects.length);

    // Generate timeline
    const timeline: ProposedPlan['timeline'] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      // Skip weekends
      if (currentDate.getDay() === 5 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      const dayTasks: ProposedPlan['timeline'][0]['tasks'] = [];

      // Add study sessions for each subject
      subjects.forEach((subject, index) => {
        const sessionsForThisSubject = Math.floor(sessionsPerSubject / 7); // Distribute over week
        
        for (let i = 0; i < sessionsForThisSubject; i++) {
          dayTasks.push({
            title: `ללמוד ${subject}`,
            description: (topics && topics[index]) ? topics[index] : `לימוד חומר ${subject}`,
            duration: sessionDuration * 60, // Convert to minutes
            priority: 'high' as const
          });
        }
      });

      if (dayTasks.length > 0) {
        timeline.push({
          date: new Date(currentDate),
          tasks: dayTasks
        });
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return {
      strategy: this.getName(),
      timeline,
      estimatedDuration: timeAvailable,
      confidence: 0.85
    };
  }

  /**
   * Validate study plan
   */
  async validatePlan(plan: ProposedPlan, context: PlanningContext): Promise<ValidationResult> {
    logger.info('✅ Validating study plan');

    const issues: ValidationResult['issues'] = [];
    const warnings: string[] = [];

    // Check if plan has timeline
    if (!plan.timeline || plan.timeline.length === 0) {
      issues.push({
        severity: 'error',
        message: 'התוכנית לא מכילה משימות',
        suggestion: 'נסה שוב עם פרטים נוספים'
      });
    }

    // Check if timeline is too long
    if (plan.timeline.length > 30) {
      warnings.push('התוכנית מכילה יותר מ-30 יום, ייתכן שצריך לקצר');
    }

    // Check if tasks are distributed evenly
    const tasksPerDay = plan.timeline.map(day => day.tasks.length);
    const avgTasks = tasksPerDay.reduce((sum, count) => sum + count, 0) / tasksPerDay.length;
    const maxTasks = Math.max(...tasksPerDay);

    if (maxTasks > avgTasks * 2) {
      warnings.push('המשימות לא מחולקות באופן אחיד, ייתכן שיש ימים עמוסים מדי');
    }

    return {
      valid: issues.filter(i => i.severity === 'error').length === 0,
      confidence: issues.length === 0 ? 0.9 : 0.6,
      issues,
      warnings
    };
  }
}
