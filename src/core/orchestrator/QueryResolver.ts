import { FuzzyMatcher } from '../../utils/fuzzy';
import { TimeParser } from '../../utils/time';
import { ServiceContainer } from '../container/ServiceContainer';
import { EntityDomain, EntityReference, ResolutionCandidate, ResolutionResult } from '../types/AgentTypes';

export class QueryResolver {
  private container = ServiceContainer.getInstance();
  private logger = this.container.getLogger();

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
        return entity?.content?.title || ref?.canonical || 'List';
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
    
    // First try exact match
    const exactMatch = lists.find(list => 
      list.content?.title?.toLowerCase() === query.toLowerCase()
    );
    
    if (exactMatch) {
      return {
        candidates: [{
          entity: exactMatch,
          reference: this.toRef('list', exactMatch.id, exactMatch.content?.title),
          score: 1.0,
          reason: 'exact title match'
        }],
        disambiguationRequired: false
      };
    }
    
    // Then try fuzzy search
    const matches = FuzzyMatcher.search<any>(query, lists, ['content.title'], 0.6);
    const candidates: ResolutionCandidate[] = matches.map(m => ({
      entity: m.item,
      reference: this.toRef('list', m.item.id, m.item.content?.title || m.item.list_name),
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
}


