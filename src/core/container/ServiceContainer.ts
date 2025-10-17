import { logger } from '../../utils/logger';
import { OpenAIService } from '../../services/ai/OpenAIService';
import { FunctionHandler } from '../base/FunctionHandler';
import { TaskService } from '../../services/database/TaskService';
import { ContactService } from '../../services/database/ContactService';
import { ListService } from '../../services/database/ListService';
import { UserDataService } from '../../services/database/UserDataService';
import { CalendarService } from '../../services/calendar/CalendarService';
import { GmailService } from '../../services/email/GmailService';
import { ContactLookupService } from '../../services/contact/ContactLookupService';
import { MultiTaskService } from '../../services/multi-task/MultiTaskService';

export class ServiceContainer {
  private static instance: ServiceContainer;
  private services: Map<string, any> = new Map();
  private logger: any;

  private constructor() {
    this.logger = logger;
    this.initializeServices();
  }

  static getInstance(): ServiceContainer {
    if (!ServiceContainer.instance) {
      ServiceContainer.instance = new ServiceContainer();
    }
    return ServiceContainer.instance;
  }

  private initializeServices(): void {
    // Core services
    this.services.set('logger', this.logger);
    this.services.set('openaiService', new OpenAIService(this.logger));
    this.services.set('functionHandler', new FunctionHandler(this.logger));

    // Database services
    this.services.set('taskService', new TaskService(this.logger));
    this.services.set('contactService', new ContactService(this.logger));
    this.services.set('listService', new ListService(this.logger));
    
    // User data service with dependencies
    this.services.set('userDataService', new UserDataService(
      this.services.get('taskService'),
      this.services.get('contactService'),
      this.services.get('listService'),
      this.logger
    ));

    // External services
    this.services.set('calendarService', new CalendarService(this.logger));
    this.services.set('gmailService', new GmailService(this.logger));
    
    // Contact lookup service
    this.services.set('contactLookupService', new ContactLookupService(this));
    
    // Multi-task service
    this.services.set('multiTaskService', new MultiTaskService(this));

    this.logger.info('🚀 ServiceContainer initialized with all services');
  }

  get<T>(serviceName: string): T {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found in container`);
    }
    return service as T;
  }

  register<T>(serviceName: string, service: T): void {
    this.services.set(serviceName, service);
    this.logger.info(`📝 Registered service: ${serviceName}`);
  }

  has(serviceName: string): boolean {
    return this.services.has(serviceName);
  }

  getAllServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  // Convenience getters
  getLogger(): any {
    return this.get<any>('logger');
  }

  getOpenAIService(): OpenAIService {
    return this.get<OpenAIService>('openaiService');
  }

  getFunctionHandler(): FunctionHandler {
    return this.get<FunctionHandler>('functionHandler');
  }

  getTaskService(): TaskService {
    return this.get<TaskService>('taskService');
  }

  getContactService(): ContactService {
    return this.get<ContactService>('contactService');
  }

  getListService(): ListService {
    return this.get<ListService>('listService');
  }

  getUserDataService(): UserDataService {
    return this.get<UserDataService>('userDataService');
  }

  getCalendarService(): CalendarService {
    return this.get<CalendarService>('calendarService');
  }

  getGmailService(): GmailService {
    return this.get<GmailService>('gmailService');
  }

  getContactLookupService(): ContactLookupService {
    return this.get<ContactLookupService>('contactLookupService');
  }

  getMultiTaskService(): MultiTaskService {
    return this.get<MultiTaskService>('multiTaskService');
  }
}
