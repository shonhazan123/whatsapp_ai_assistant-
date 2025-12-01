import { googleOAuthService } from '../services/auth/GoogleOAuthService';
import { OnboardingService, OnboardingStep } from '../services/database/OnboardingService';
import { UserService } from '../services/database/UserService';
import { logger } from '../utils/logger';
import { onboardingMessages } from './onboardingMessages';

export interface OnboardingHandleResult {
  message: string | null;
  stopProcessing: boolean;
  stepCompleted: boolean;
  nextStepMessage: string | null;
}

export class OnboardingFlow {
  private onboardingService: OnboardingService;
  private userService: UserService;

  constructor(
    private loggerInstance: any = logger
  ) {
    this.onboardingService = new OnboardingService(loggerInstance);
    this.userService = new UserService(loggerInstance);
  }

  /**
   * Get current onboarding state for a user
   */
  async getOnboardingState(userId: string): Promise<{ step: OnboardingStep; completed: boolean }> {
    const progress = await this.onboardingService.getOnboardingProgress(userId);
    return {
      step: progress.step,
      completed: progress.completed
    };
  }

  /**
   * Check if agent actions should be blocked (Google Connect not completed)
   */
  async shouldBlockAgentActions(userId: string): Promise<boolean> {
    const state = await this.getOnboardingState(userId);
    return state.step === 'google_connect' && !state.completed;
  }

  /**
   * Check if user is asking for capabilities
   */
  isCapabilitiesRequest(messageText: string): boolean {
    const normalized = messageText.toLowerCase().trim();
    const keywords = [
      'מה היכולות שלך',
      'מה אתה יודע לעשות',
      'help',
      'onboarding',
      'מה אתה יכול',
      'מה היכולות',
      'capabilities',
      'מה אתה עושה'
    ];
    return keywords.some(keyword => normalized.includes(keyword));
  }

  /**
   * Check if user confirmed Google Connect
   */
  isGoogleConnectConfirmation(messageText: string): boolean {
    const normalized = messageText.toLowerCase().trim();
    const confirmations = ['התחברתי', 'סיימתי', 'connected', 'done', 'finished', 'סיימת'];
    return confirmations.some(conf => normalized.includes(conf));
  }

  /**
   * Detect if calendar practice step was completed
   */
  isUserCompletingCalendarPractice(
    messageText: string,
    agentResponse: string,
    context?: any
  ): boolean {
    // Check agent response for success indicators
    const responseLower = agentResponse.toLowerCase();
    const successIndicators = [
      'created',
      'נוצר',
      'נוצרה',
      'נוסף',
      'נוספה',
      'הוסף',
      'הוספתי',
      'event',
      'אירוע',
      'meeting',
      'פגישה',
      'calendar',
      'יומן',
      'success',
      'הצלחה',
      'meeting link',
      'קישור לפגישה',
      'נוסף בהצלחה',
      'created successfully',
      'event created'
    ];

    const hasSuccessIndicator = successIndicators.some(indicator => 
      responseLower.includes(indicator)
    );

    // Check if message mentions calendar/event creation OR if response indicates calendar event was created
    const messageLower = messageText.toLowerCase();
    const calendarKeywords = [
      'תוסיף ליומן',
      'תוסיף לי',
      'add to calendar',
      'create event',
      'יומן',
      'calendar',
      'event',
      'meeting',
      'פגישה',
      'תזכיר לי',
      'remind me'
    ];
    const mentionsCalendar = calendarKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    // Also check if response clearly indicates a calendar event was created
    const responseIndicatesCalendar = responseLower.includes('אירוע') || 
                                      responseLower.includes('event') ||
                                      responseLower.includes('יומן') ||
                                      responseLower.includes('calendar') ||
                                      responseLower.includes('קישור לאירוע');

    // Return true if we have success indicator AND (message mentions calendar OR response indicates calendar)
    return hasSuccessIndicator && (mentionsCalendar || responseIndicatesCalendar);
  }

  /**
   * Detect if reminder practice step was completed
   */
  isUserCompletingReminderPractice(
    messageText: string,
    agentResponse: string,
    context?: any
  ): boolean {
    const responseLower = agentResponse.toLowerCase();
    const successIndicators = [
      'reminder',
      'תזכורת',
      'תזכיר',
      'created',
      'נוצר',
      'נוצרה',
      'הוסף',
      'הוספתי',
      'success',
      'הצלחה',
      'set',
      'נקבע'
    ];

    const hasSuccessIndicator = successIndicators.some(indicator => 
      responseLower.includes(indicator)
    );

    const messageLower = messageText.toLowerCase();
    const reminderKeywords = [
      'תזכיר לי',
      'remind me',
      'תזכורת',
      'reminder'
    ];
    const mentionsReminder = reminderKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    return hasSuccessIndicator && mentionsReminder;
  }

  /**
   * Detect if list practice step was completed
   */
  isUserCompletingListPractice(
    messageText: string,
    agentResponse: string,
    context?: any
  ): boolean {
    const responseLower = agentResponse.toLowerCase();
    const successIndicators = [
      'list',
      'רשימה',
      'רשימות',
      'created',
      'נוצר',
      'נוצרה',
      'הוסף',
      'הוספתי',
      'added',
      'success',
      'הצלחה',
      'shopping',
      'קניות'
    ];

    const hasSuccessIndicator = successIndicators.some(indicator => 
      responseLower.includes(indicator)
    );

    const messageLower = messageText.toLowerCase();
    const listKeywords = [
      'רשימה',
      'list',
      'רשימת קניות',
      'shopping list',
      'תוסיף לרשימה',
      'add to list'
    ];
    const mentionsList = listKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    return hasSuccessIndicator && mentionsList;
  }

  /**
   * Detect if memory practice step was completed
   */
  isUserCompletingMemoryPractice(
    messageText: string,
    agentResponse: string,
    context?: any
  ): boolean {
    const responseLower = agentResponse.toLowerCase();
    const successIndicators = [
      'saved',
      'שמור',
      'נשמר',
      'remember',
      'זכור',
      'memory',
      'זיכרון',
      'second brain',
      'success',
      'הצלחה',
      'stored',
      '.נשמר',
      'דברים שאני צריך לעשות אבל דוחה'
    ];

    const hasSuccessIndicator = successIndicators.some(indicator => 
      responseLower.includes(indicator)
    );

    const messageLower = messageText.toLowerCase();
    const memoryKeywords = [
      'זכור',
      'remember',
      'שמור',
      'save',
      'second brain',
      'זיכרון',
      'memory'
    ];
    const mentionsMemory = memoryKeywords.some(keyword => 
      messageLower.includes(keyword)
    );

    return hasSuccessIndicator && mentionsMemory;
  }

  /**
   * Get next step after completing current step
   */
  getNextStep(currentStep: OnboardingStep): OnboardingStep | null {
    const stepOrder: OnboardingStep[] = [
      'start',
      'google_connect',
      'calendar_practice',
      'reminder_practice',
      'list_practice',
      'memory_practice',
      'done'
    ];

    const currentIndex = stepOrder.indexOf(currentStep);
    if (currentIndex === -1 || currentIndex === stepOrder.length - 1) {
      return null;
    }

    return stepOrder[currentIndex + 1];
  }

  /**
   * Get congratulatory message for completed step
   */
  getNextStepMessage(completedStep: OnboardingStep): string | null {
    const stepMessages = onboardingMessages.stepCompleted as Record<string, string>;
    return stepMessages[completedStep] || null;
  }

  /**
   * Main handler for onboarding steps
   */
  async handleStep(
    userId: string,
    userPhone: string,
    messageText: string,
    agentResponse?: string,
    context?: any
  ): Promise<OnboardingHandleResult> {
    const state = await this.getOnboardingState(userId);

    // If onboarding is complete, don't interfere
    if (state.step === 'done' && state.completed) {
      return {
        message: null,
        stopProcessing: false,
        stepCompleted: false,
        nextStepMessage: null
      };
    }

    // Handle capabilities request
    if (this.isCapabilitiesRequest(messageText)) {
      const capabilitiesMessage = onboardingMessages.capabilities;
      const currentStepMessage = this.getCurrentStepMessage(state.step, userPhone);
      return {
        message: `${capabilitiesMessage}\n\n${currentStepMessage}`,
        stopProcessing: true,
        stepCompleted: false,
        nextStepMessage: null
      };
    }

    // Handle Google Connect confirmation
    if (state.step === 'google_connect' && this.isGoogleConnectConfirmation(messageText)) {
      // Verify Google is actually connected
      const user = await this.userService.findById(userId);
      const tokens = await this.userService.getGoogleTokens(userId);
      
      if (tokens && tokens.access_token) {
        const nextStep = this.getNextStep('google_connect');
        if (nextStep) {
          await this.onboardingService.updateOnboardingProgress(userId, nextStep, false);
          const nextStepMessage = this.getCurrentStepMessage(nextStep, userPhone);
          return {
            message: nextStepMessage,
            stopProcessing: true,
            stepCompleted: true,
            nextStepMessage: null
          };
        }
      } else {
        // Google not actually connected yet
        return {
          message: 'נראה שעדיין לא התחברת לחשבון Google. אנא לחץ על הקישור והתחבר תחילה.',
          stopProcessing: true,
          stepCompleted: false,
          nextStepMessage: null
        };
      }
    }

    // Handle step completion detection (only if we have agent response)
    if (agentResponse) {
      let stepCompleted = false;
      let completedStep: OnboardingStep | null = null;

      switch (state.step) {
        case 'calendar_practice':
          const isCalendarComplete = this.isUserCompletingCalendarPractice(messageText, agentResponse, context);
          this.loggerInstance.info(`[Onboarding] Calendar practice check: step=${state.step}, isComplete=${isCalendarComplete}, message="${messageText.substring(0, 50)}...", response="${agentResponse.substring(0, 50)}..."`);
          if (isCalendarComplete) {
            stepCompleted = true;
            completedStep = 'calendar_practice';
            this.loggerInstance.info(`[Onboarding] Calendar practice step completed!`);
          }
          break;

        case 'reminder_practice':
          if (this.isUserCompletingReminderPractice(messageText, agentResponse, context)) {
            stepCompleted = true;
            completedStep = 'reminder_practice';
          }
          break;

        case 'list_practice':
          if (this.isUserCompletingListPractice(messageText, agentResponse, context)) {
            stepCompleted = true;
            completedStep = 'list_practice';
          }
          break;

        case 'memory_practice':
          if (this.isUserCompletingMemoryPractice(messageText, agentResponse, context)) {
            stepCompleted = true;
            completedStep = 'memory_practice';
          }
          break;
      }

      if (stepCompleted && completedStep) {
        const nextStep = this.getNextStep(completedStep);
        if (nextStep) {
          await this.onboardingService.updateOnboardingProgress(userId, nextStep, false);
          const nextStepMessage = this.getNextStepMessage(completedStep);
          return {
            message: null,
            stopProcessing: false,
            stepCompleted: true,
            nextStepMessage: nextStepMessage
          };
        } else {
          // Onboarding complete
          await this.onboardingService.updateOnboardingProgress(userId, 'done', true);
          return {
            message: null,
            stopProcessing: false,
            stepCompleted: true,
            nextStepMessage: onboardingMessages.done
          };
        }
      }
    }

    // If we're in a practice step and user hasn't completed it, show the step message
    if (['calendar_practice', 'reminder_practice', 'list_practice', 'memory_practice'].includes(state.step)) {
      // Don't stop processing - let agent handle the request
      // But we'll check completion after agent responds
      return {
        message: null,
        stopProcessing: false,
        stepCompleted: false,
        nextStepMessage: null
      };
    }

    // If we're at start, show start message and advance to google_connect
    if (state.step === 'start') {
      // Advance to google_connect step
      await this.onboardingService.updateOnboardingProgress(userId, 'google_connect', false);
      const stepMessage = onboardingMessages.start;
      return {
        message: stepMessage,
        stopProcessing: true,
        stepCompleted: true,
        nextStepMessage: null
      };
    }

    if (state.step === 'google_connect') {
      // Get Google OAuth URL
      const user = await this.userService.findById(userId);
      if (!user) {
        return {
          message: 'שגיאה: לא נמצא משתמש',
          stopProcessing: true,
          stepCompleted: false,
          nextStepMessage: null
        };
      }

      const appUrl = process.env.APP_PUBLIC_URL;
      if (!appUrl) {
        this.loggerInstance.error('APP_PUBLIC_URL is not configured');
        return {
          message: 'שגיאה: תצורת שרת לא תקינה',
          stopProcessing: true,
          stepCompleted: false,
          nextStepMessage: null
        };
      }

      const stateToken = googleOAuthService.createStateToken({
        userId: user.id,
        planType: user.plan_type
      });
      const authUrl = `${appUrl.replace(/\/$/, '')}/auth/google?state=${encodeURIComponent(stateToken)}`;
      const stepMessage = onboardingMessages.google_connect(authUrl);

      return {
        message: stepMessage,
        stopProcessing: true,
        stepCompleted: false,
        nextStepMessage: null
      };
    }

    return {
      message: null,
      stopProcessing: false,
      stepCompleted: false,
      nextStepMessage: null
    };
  }

  /**
   * Get message for current step
   */
  private getCurrentStepMessage(step: OnboardingStep, userPhone: string): string {
    switch (step) {
      case 'start':
        return onboardingMessages.start;
      case 'google_connect':
        // This will be handled separately with OAuth URL
        return 'אנא התחבר לחשבון Google שלך';
      case 'calendar_practice':
        return onboardingMessages.calendar_practice;
      case 'reminder_practice':
        return onboardingMessages.reminder_practice;
      case 'list_practice':
        return onboardingMessages.list_practice;
      case 'memory_practice':
        return onboardingMessages.memory_practice;
      case 'done':
        return onboardingMessages.done;
      default:
        return '';
    }
  }
}

