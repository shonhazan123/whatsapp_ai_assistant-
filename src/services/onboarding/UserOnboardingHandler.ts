import { OnboardingFlow, OnboardingHandleResult } from '../../onboarding/OnboardingFlow';
import { RequestUserContext, UserCapabilities } from '../../types/UserContext';
import { logger } from '../../utils/logger';
import { googleOAuthService } from '../auth/GoogleOAuthService';
import { GoogleTokenManager } from '../auth/GoogleTokenManager';
import { UserRecord, UserService } from '../database/UserService';
import { sendWhatsAppMessage } from '../whatsapp';

export interface OnboardingCheckResult {
  shouldProcess: boolean;
  message?: string;
  context?: RequestUserContext;
  onboardingResult?: OnboardingHandleResult;
}

export class UserOnboardingHandler {
  private onboardingFlow: OnboardingFlow;
  private userService: UserService;
  private googleTokenManager: GoogleTokenManager;

  constructor(
    private loggerInstance: any = logger
  ) {
    this.onboardingFlow = new OnboardingFlow(loggerInstance);
    this.userService = new UserService(loggerInstance);
    this.googleTokenManager = new GoogleTokenManager();
  }

  /**
   * Main handler that processes onboarding, OAuth, and plan logic in correct order
   * Order: 1. Started onboarding? 2. Finished Google OAuth? 3. Need token refresh? 4. Capabilities instructions?
   */
  async handleUserMessage(
    userRecord: UserRecord,
    userPhone: string,
    messageText: string,
    agentResponse?: string,
    context?: any
  ): Promise<OnboardingCheckResult> {
    // Step 1: Ensure user has pro plan
    if (userRecord.plan_type !== 'pro') {
      userRecord = await this.userService.updatePlanType(userRecord.id, 'pro') ?? userRecord;
    }

    // Step 2: Check onboarding state
    const onboardingState = await this.onboardingFlow.getOnboardingState(userRecord.id);
    const isInOnboarding = onboardingState.step !== 'done' || !onboardingState.completed;
    const isAtGoogleConnectStep = onboardingState.step === 'google_connect';

    // Step 3: Handle capabilities request (resume onboarding) - highest priority
    if (this.onboardingFlow.isCapabilitiesRequest(messageText)) {
      const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
      if (result.message) {
        await sendWhatsAppMessage(userPhone, result.message);
      }
      return {
        shouldProcess: false,
        message: result.message || undefined,
        onboardingResult: result
      };
    }

    // Step 4: Handle start step - show welcome and move to google_connect
    if (onboardingState.step === 'start') {
      const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
      if (result.message) {
        await sendWhatsAppMessage(userPhone, result.message);
      }
      // After showing start message, immediately show google_connect step
      const googleConnectResult = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
      if (googleConnectResult.message) {
        await sendWhatsAppMessage(userPhone, googleConnectResult.message);
      }
      return {
        shouldProcess: false,
        message: result.message || googleConnectResult.message || undefined,
        onboardingResult: googleConnectResult
      };
    }

    // Step 5: Get capabilities and check Google integrations
    const capabilities = this.determineCapabilities(userRecord.plan_type);
    const hasGoogleIntegrations = capabilities.calendar || capabilities.gmail;

    // Step 6: Handle Google token refresh and connection
    let tokens = await this.userService.getGoogleTokens(userRecord.id);
    let googleConnected = false;

    if (hasGoogleIntegrations) {
      try {
        const tokenResult = await this.googleTokenManager.ensureFreshTokens(
          userRecord,
          tokens,
          { forceRefresh: true }
        );
        tokens = tokenResult.tokens;
        googleConnected = tokenResult.googleConnected;

        // Step 7: Handle token refresh errors or reauth needed
        if (tokenResult.needsReauth) {
          // If user is in onboarding at google_connect step, use onboarding flow
          if (isAtGoogleConnectStep) {
            const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
            if (result.message) {
              await sendWhatsAppMessage(userPhone, result.message);
            }
            return {
              shouldProcess: false,
              message: result.message || undefined,
              onboardingResult: result
            };
          }
          // Otherwise, use reconnect flow for users who completed onboarding
          await this.promptGoogleReconnect(userRecord, userPhone, capabilities);
          return {
            shouldProcess: false,
            message: undefined
          };
        }
      } catch (tokenError) {
        this.loggerInstance.error('Error ensuring Google tokens are fresh:', tokenError);
        // If user is in onboarding at google_connect step, use onboarding flow
        if (isAtGoogleConnectStep) {
          const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
          if (result.message) {
            await sendWhatsAppMessage(userPhone, result.message);
          }
          return {
            shouldProcess: false,
            message: result.message || undefined,
            onboardingResult: result
          };
        }
        // Otherwise, use reconnect flow for users who completed onboarding
        await this.promptGoogleReconnect(userRecord, userPhone, capabilities);
        return {
          shouldProcess: false,
          message: undefined
        };
      }
    }

    // Step 8: Handle Google Connect confirmation
    if (isAtGoogleConnectStep && this.onboardingFlow.isGoogleConnectConfirmation(messageText)) {
      const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
      if (result.message) {
        await sendWhatsAppMessage(userPhone, result.message);
      }
      return {
        shouldProcess: false,
        message: result.message || undefined,
        onboardingResult: result
      };
    }

    // Step 9: Check if we should block agent actions (Google Connect not completed)
    const shouldBlock = await this.onboardingFlow.shouldBlockAgentActions(userRecord.id);
    if (shouldBlock) {
      // Check if user is trying to use calendar/reminder/list/memory features
      const messageLower = messageText.toLowerCase();
      const blockedKeywords = [
        'יומן', 'calendar', 'event', 'meeting', 'פגישה',
        'תזכורת', 'reminder', 'תזכיר',
        'רשימה', 'list', 'רשימת קניות',
        'זכור', 'remember', 'שמור', 'save', 'second brain', 'memory'
      ];

      const isBlockedAction = blockedKeywords.some(keyword => messageLower.includes(keyword));

      if (isBlockedAction) {
        // Show onboarding message for Google Connect
        const result = await this.onboardingFlow.handleStep(userRecord.id, userPhone, messageText);
        if (result.message) {
          await sendWhatsAppMessage(userPhone, result.message);
        }
        this.loggerInstance.info(`Blocked action for ${userPhone} - Google Connect required`);
        return {
          shouldProcess: false,
          message: result.message || undefined,
          onboardingResult: result
        };
      }
    }

    // Step 10: If we got here, user can process normally
    // Build context for agent processing
    const requestContext: RequestUserContext = {
      user: userRecord,
      planType: userRecord.plan_type,
      whatsappNumber: userRecord.whatsapp_number,
      capabilities,
      googleTokens: tokens,
      googleConnected
    };

    return {
      shouldProcess: true,
      context: requestContext
    };
  }

  /**
   * Check onboarding step completion after agent response
   */
  async handlePostAgentResponse(
    userId: string,
    userPhone: string,
    messageText: string,
    agentResponse: string,
    context: RequestUserContext
  ): Promise<OnboardingHandleResult | null> {
    // Check current onboarding state for debugging
    const currentState = await this.onboardingFlow.getOnboardingState(userId);
    this.loggerInstance.info(`[Onboarding] Post-agent check: userId=${userId}, step=${currentState.step}, completed=${currentState.completed}`);
    
    const onboardingResult = await this.onboardingFlow.handleStep(
      userId,
      userPhone,
      messageText,
      agentResponse,
      context
    );

    this.loggerInstance.info(`[Onboarding] Post-agent result: stepCompleted=${onboardingResult.stepCompleted}, hasNextStepMessage=${!!onboardingResult.nextStepMessage}, stopProcessing=${onboardingResult.stopProcessing}`);

    // If step was completed, send congratulatory message with next step instructions
    if (onboardingResult.stepCompleted && onboardingResult.nextStepMessage) {
      await sendWhatsAppMessage(userPhone, onboardingResult.nextStepMessage);
      this.loggerInstance.info(`✅ Onboarding step completed for ${userPhone}, sent next step message: "${onboardingResult.nextStepMessage.substring(0, 100)}..."`);
    } else if (onboardingResult.stepCompleted && !onboardingResult.nextStepMessage) {
      this.loggerInstance.warn(`[Onboarding] Step completed but no nextStepMessage! stepCompleted=${onboardingResult.stepCompleted}`);
    }

    // If onboarding wants to stop processing (shouldn't happen after agent response, but handle it)
    if (onboardingResult.stopProcessing && onboardingResult.message) {
      await sendWhatsAppMessage(userPhone, onboardingResult.message);
    }

    return onboardingResult.stepCompleted ? onboardingResult : null;
  }

  /**
   * Determine user capabilities based on plan type
   */
  private determineCapabilities(planType: string): UserCapabilities {
    switch (planType) {
      case 'pro':
        return { database: true, calendar: true, gmail: true };
      case 'standard':
        return { database: true, calendar: true, gmail: false };
      default:
        return { database: true, calendar: false, gmail: false };
    }
  }

  /**
   * Prompt user to reconnect Google account (for users who completed onboarding)
   */
  private async promptGoogleReconnect(
    user: UserRecord,
    whatsappNumber: string,
    capabilities: UserCapabilities
  ): Promise<void> {
    const appUrl = process.env.APP_PUBLIC_URL;
    if (!appUrl) {
      this.loggerInstance.error('APP_PUBLIC_URL is not configured; cannot send reconnect link');
      return;
    }

    const state = googleOAuthService.createStateToken({
      userId: user.id,
      planType: user.plan_type
    });
    const authUrl = `${appUrl.replace(/\/$/, '')}/auth/google?state=${encodeURIComponent(state)}`;
    const message = this.buildReconnectMessage(capabilities, authUrl);

    await sendWhatsAppMessage(whatsappNumber, message);
    await this.userService.markOnboardingPrompted(user.id);
    this.loggerInstance.info(`Prompted ${whatsappNumber} to reconnect Google account`);
  }

  /**
   * Build reconnect message for users who completed onboarding
   */
  private buildReconnectMessage(capabilities: UserCapabilities, authUrl: string): string {
    return [
      'כדי לפתוח את כל היכולות המלאות שלי אני צריך שתתחבר לחשבון Google שלך.',
      '',
      'מה אפשר לעשות אחרי החיבור:',
      '• ניהול יומן – כשאתה רוצה שהבקשה תתועד ביומן, ציין את המילה "יומן" או כתוב במפורש "תוסיף ליומן...".',
      '• תזכורות ומשימות – אני שומר עבורך את המשימות בזיכרון האישי שלי.',
      ...(capabilities.gmail
        ? ['• דואר אלקטרוני – אני יכול להכין טיוטות, לשלוח מיילים ולהמשיך שיחות מתוך Gmail עבורך.']
        : []),
      '• סוכן כללי – אפשר לשאול אותי כל שאלה כללית או לבקש עזרה בכל נושא אחר.',
      '',
      `🔗 התחבר כאן: ${authUrl}`,
      '',
      'אחרי שסיימת את ההתחברות, כתוב לי "התחברתי" או "סיימתי" ונמשיך!'
    ].join('\n');
  }
}

