import { FuzzyMatcher } from '../../utils/fuzzy';
import { TimeParser } from '../../utils/time';
import { ServiceContainer } from '../container/ServiceContainer';
import { ConversationWindow } from '../memory/ConversationWindow';
import { EntityDomain, EntityReference, ResolutionCandidate, ResolutionResult } from '../types/AgentTypes';

export class QueryResolver {
  private container = ServiceContainer.getInstance();
  private logger = this.container.getLogger();
  private conversationWindow = ConversationWindow.getInstance();

  async resolve(query: string, userPhone: string, domain: EntityDomain): Promise<ResolutionResult> {
    switch (domain) {
      case 'task':
        return this.resolveTasks(query, userPhone);
      case 'contact':
        return this.resolveContacts(query, userPhone);
      case 'list':
        return this.resolveLists(query, userPhone);
      case 'event':
        return this.resolveEvents(query, userPhone);
      case 'email':
        return this.resolveEmails(query, userPhone);
      default:
        return { candidates: [], disambiguationRequired: false };
    }
  }

  async resolveOneOrAsk(query: string, userPhone: string, domain: EntityDomain): Promise<{ entity: any | null; reason?: string; disambiguation?: ResolutionResult }>
  {
    const result = await this.resolve(query, userPhone, domain);
    if (result.candidates.length === 0) {
      return { entity: null, reason: 'no_match' };
    }
    if (result.disambiguationRequired) {
      return { entity: null, disambiguation: result, reason: 'ambiguous' };
    }
    return { entity: result.candidates[0].entity, reason: 'single_high_confidence' };
  }

  formatDisambiguation(domain: EntityDomain, candidates: ResolutionCandidate[], language: 'he' | 'en' = 'en'): string {
    const header = language === 'he'
      ? `מצאתי ${candidates.length} פריטים תואמים:\n\n`
      : `I found ${candidates.length} matching items:\n\n`;
    const lines = candidates.slice(0, 5).map((c, i) => `${i + 1}. ${this.toLabel(domain, c.entity, c.reference)}`);
    const footer = language === 'he' ? `\nנא לבחור מספר.` : `\nPlease reply with a number.`;
    return header + lines.join('\n') + footer;
  }

  private toLabel(domain: EntityDomain, entity: any, ref?: EntityReference): string {
    switch (domain) {
      case 'task':
        return entity?.text || ref?.canonical || 'Task';
      case 'contact':
        return `${entity?.name || ref?.canonical || 'Contact'}${entity?.email ? ` <${entity.email}>` : ''}`;
      case 'list':
        return entity?.list_name || ref?.canonical || 'List';
      case 'event':
        return `${entity?.summary || ref?.canonical || 'Event'}${entity?.start ? ` (${entity.start})` : ''}`;
      case 'email':
        return `${entity?.subject || ref?.canonical || 'Email'}${entity?.from ? ` from ${entity.from}` : ''}`;
      default:
        return ref?.canonical || 'Item';
    }
  }

  private async resolveTasks(query: string, userPhone: string): Promise<ResolutionResult> {
    const taskService = this.container.getTaskService();
    const resp = await taskService.getAll({ userPhone });
    const tasks = (resp.success && resp.data?.tasks ? resp.data.tasks : []) as any[];
    const matches = FuzzyMatcher.search<any>(query, tasks, ['text', 'category'], 0.6);
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('task', m.item.id, m.item.text),
      score: m.score,
      reason: 'text/category match'
    }));
    return this.result(candidates);
  }

  private async resolveContacts(query: string, userPhone: string): Promise<ResolutionResult> {
    const contactService = this.container.getContactService();
    const resp = await contactService.getAll({ userPhone, filters: { name: query } });
    const contacts = (resp.success && resp.data?.contacts ? resp.data.contacts : []) as any[];
    const matches = FuzzyMatcher.search<any>(query, contacts, ['name', 'email', 'phone_number'], 0.6);
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('contact', m.item.id, m.item.name),
      score: m.score,
      reason: 'name/email/phone match'
    }));
    return this.result(candidates);
  }

  private async resolveLists(query: string, userPhone: string): Promise<ResolutionResult> {
    const listService = this.container.getListService();
    const resp = await listService.getAll({ userPhone });
    const lists = (resp.success && resp.data?.lists ? resp.data.lists : []) as any[];
    
    this.logger.info(`🔍 [QueryResolver] resolveLists - Query: "${query}"`);
    this.logger.info(`🔍 [QueryResolver] Available lists: ${lists.map(l => l.list_name).join(', ')}`);
    
    // First try exact match on list_name - get ALL matches
    const exactMatches = lists.filter(list => 
      list.list_name?.toLowerCase() === query.toLowerCase()
    );
    
    this.logger.info(`🔍 [QueryResolver] Exact matches found: ${exactMatches.length}`);
    
    if (exactMatches.length > 0) {
      const candidates: ResolutionCandidate[] = exactMatches.map(list => ({
        entity: list,
        reference: this.toRef('list', list.id, list.list_name),
        score: 1.0,
        reason: 'exact title match'
      }));
      
      // If multiple exact matches, disambiguation is required
      const disambiguationRequired = exactMatches.length > 1;
      this.logger.info(`🔍 [QueryResolver] Disambiguation required: ${disambiguationRequired}`);
      
      return {
        candidates,
        disambiguationRequired
      };
    }
    
    // Then try fuzzy search on list_name
    this.logger.info(`🔍 [QueryResolver] Running fuzzy search with threshold 0.6...`);
    const matches = FuzzyMatcher.search<any>(query, lists, ['list_name'], 0.6);
    this.logger.info(`🔍 [QueryResolver] Fuzzy matches found: ${matches.length}`);
    matches.forEach(m => {
      this.logger.info(`  - "${m.item.list_name}" (score: ${m.score.toFixed(3)})`);
    });
    
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('list', m.item.id, m.item.list_name),
      score: m.score,
      reason: 'list title match'
    }));
    return this.result(candidates);
  }

  private async resolveEvents(query: string, userPhone: string): Promise<ResolutionResult> {
    const calendarService = this.container.getCalendarService();
    const time = TimeParser.parseToISO(query) || undefined;
    const range = TimeParser.parseDateRange(query) || { start: new Date().toISOString(), end: new Date(Date.now() + 24*60*60*1000).toISOString() };
    const resp = await calendarService.getEvents({ timeMin: range.start, timeMax: range.end });
    const events = (resp.success && resp.data?.events ? resp.data.events : []) as any[];
    const keys = ['summary', 'description'];
    const matches = FuzzyMatcher.search<any>(query, events, keys, 0.6);
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('event', m.item.id, m.item.summary, { time }),
      score: m.score,
      reason: time ? 'summary/time match' : 'summary match'
    }));
    return this.result(candidates);
  }

  private async resolveEmails(query: string, userPhone: string): Promise<ResolutionResult> {
    const gmailService = this.container.getGmailService();
    const resp = await gmailService.searchEmails(query);
    const emails = (resp.success && resp.data?.emails ? resp.data.emails : []) as any[];
    const matches = FuzzyMatcher.search<any>(query, emails, ['subject', 'from', 'to'], 0.6);
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('email', m.item.id, m.item.subject),
      score: m.score,
      reason: 'subject/from/to match'
    }));
    return this.result(candidates);
  }

  private toRef(domain: EntityDomain, id: string | undefined, canonical: string, metadata?: Record<string, any>): EntityReference {
    return { id, domain, canonical, metadata };
  }

  private result(candidates: ResolutionCandidate[]): ResolutionResult {
    const disambiguationRequired = candidates.length > 1 && ((candidates[0]?.score || 0) - (candidates[1]?.score || 0)) < 0.15;
    return { candidates, disambiguationRequired };
  }

  /**
   * Resolve entity with disambiguation handling
   * This method handles both initial resolution and responding to disambiguation choices
   */
  async resolveWithDisambiguationHandling(
    params: any,
    userId: string,
    domain: EntityDomain
  ): Promise<{ id: string | null; disambiguation?: string }> {
    // Check if user is responding to a previous disambiguation
    const disambiguationContext = this.conversationWindow.getLastDisambiguationContext(userId);
    
    if (disambiguationContext && params.selectedIndex !== undefined) {
      // User chose a number (e.g., "2") - extract UUID from stored candidates
      const candidates = disambiguationContext.disambiguationContext?.candidates || [];
      const selectedIndex = Number(params.selectedIndex);
      
      if (selectedIndex >= 1 && selectedIndex <= candidates.length) {
        const selectedCandidate = candidates[selectedIndex - 1]; // Convert to 0-based index
        this.logger.info(`User selected candidate ${selectedIndex}: ${selectedCandidate.id}`);
        
        // Clear the disambiguation context since it's been used
        this.conversationWindow.clearDisambiguationContext(userId);
        
        return { id: selectedCandidate.id };
      }
      
      this.logger.warn(`Invalid selection index: ${selectedIndex} (available: 1-${candidates.length})`);
    }
    
    // Check if params already has an ID
    const idField = this.getIdFieldForDomain(domain);
    if (params[idField]) {
      return { id: params[idField] };
    }
    
    // Get the query text for this domain
    const queryText = this.getQueryTextForDomain(params, domain);
    if (!queryText) {
      return { id: null };
    }
    
    // Perform resolution
    const one = await this.resolveOneOrAsk(queryText, userId, domain);
    
    if (one.disambiguation) {
      // Store candidates in conversation for next interaction
      const candidates = one.disambiguation.candidates.map(c => ({
        id: c.entity.id,
        displayText: this.formatCandidateDisplay(c.entity, domain)
      }));
      
      this.conversationWindow.storeDisambiguationContext(userId, candidates, domain);
      
      return {
        id: null,
        disambiguation: this.formatDisambiguation(domain, one.disambiguation.candidates, this.detectLanguage(queryText))
      };
    }
    
    return { id: one.entity?.id || null };
  }

  /**
   * Get the ID field name for a domain
   */
  private getIdFieldForDomain(domain: EntityDomain): string {
    switch (domain) {
      case 'task': return 'taskId';
      case 'contact': return 'contactId';
      case 'list': return 'listId';
      default: return 'id';
    }
  }

  /**
   * Get the query text field for a domain
   */
  private getQueryTextForDomain(params: any, domain: EntityDomain): string | null {
    switch (domain) {
      case 'task':
        return params.text || params.taskId || null;
      case 'contact':
        return params.name || params.email || params.phone || params.contactId || null;
      case 'list':
        return params.title || params.listName || params.listId || null;
      default:
        return null;
    }
  }

  /**
   * Format a single candidate for display in disambiguation
   */
  private formatCandidateDisplay(entity: any, domain: EntityDomain): string {
    switch (domain) {
      case 'task':
        return entity.text || 'Task';
      case 'contact':
        return `${entity.name || 'Contact'}${entity.email ? ` (${entity.email})` : ''}`;
      case 'list':
        const itemCount = entity.items?.length || 0;
        if (entity.is_checklist && itemCount > 0) {
          return `${entity.list_name || 'List'} (${itemCount} פריטים)`;
        } else if (!entity.is_checklist && entity.content) {
          const contentPreview = entity.content.length > 30 
            ? entity.content.substring(0, 30) + '...' 
            : entity.content;
          return `${entity.list_name || 'List'} (${contentPreview})`;
        } else {
          return `${entity.list_name || 'List'} (ללא פריטים)`;
        }
      default:
        return 'Item';
    }
  }

  /**
   * Detect language from text
   */
  private detectLanguage(text: string): 'he' | 'en' {
    return /[\u0590-\u05FF]/.test(text) ? 'he' : 'en';
  }
}


