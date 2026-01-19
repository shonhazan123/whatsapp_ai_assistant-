/**
 * CalendarEntityResolver
 * 
 * Resolves calendar events from natural language to event IDs.
 * Ports V1 logic from CalendarFunctions.ts including:
 * - deriveWindow() - Time window inference
 * - findEventByCriteria() - Multi-strategy event finder
 * - deleteByWindow() logic - Bulk delete with exclusions
 * - FuzzyMatcher integration
 */

import { FuzzyMatcher } from '../../utils/fuzzy.js';
import { TimeParser } from '../../utils/time.js';
import { getCalendarService } from '../v1-services.js';
import {
  RESOLUTION_THRESHOLDS,
  TIME_WINDOW_DEFAULTS,
  getDisambiguationMessage,
  getOperationBehavior,
} from './resolution-config.js';
import type {
  EntityResolverContext,
  EventGroups,
  IEntityResolver,
  ResolutionCandidate,
  ResolutionOutput,
} from './types.js';

// ============================================================================
// CALENDAR ENTITY RESOLVER
// ============================================================================

export class CalendarEntityResolver implements IEntityResolver {
  readonly domain = 'calendar' as const;

  /**
   * Resolve calendar entities from operation args
   */
  async resolve(
    operation: string,
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    // Operations that need entity resolution
    const operationsNeedingResolution = [
      'get', 'update', 'delete', 'getRecurringInstances', 'truncateRecurring',
      'deleteByWindow', 'updateByWindow'
    ];

    // Check if resolution needed
    if (!operationsNeedingResolution.includes(operation)) {
      return { type: 'resolved', args };
    }

    // Already has eventId? Skip resolution
    if (args.eventId) {
      return { type: 'resolved', args };
    }

    // Handle different operation types
    switch (operation) {
      case 'delete':
        return this.resolveSingleEvent(args, context, 'delete');
      case 'deleteByWindow':
        return this.resolveDeleteByWindow(args, context);
      case 'update':
        return this.resolveUpdate(args, context);
      case 'updateByWindow':
        return this.resolveUpdateByWindow(args, context);
      case 'get':
      case 'getRecurringInstances':
      case 'truncateRecurring':
        return this.resolveGet(args, context);
      default:
        return { type: 'resolved', args };
    }
  }

  /**
   * Apply user's disambiguation selection
   */
  async applySelection(
    selection: number | number[] | string,
    candidates: ResolutionCandidate[],
    args: Record<string, any>
  ): Promise<ResolutionOutput> {
    // First, check if this is a recurring choice disambiguation
    // Recurring choice has exactly 2 candidates with ids 'all' and 'single'
    const isRecurringChoice = candidates.length === 2 &&
      candidates.some(c => c.id === 'all') &&
      candidates.some(c => c.id === 'single');

    if (typeof selection === 'string') {
      const lowerSelection = selection.toLowerCase().trim();

      // Handle recurring series choice
      if (isRecurringChoice) {
        // User wants ALL occurrences: "1", "all", "כולם", "כל המופעים", "את כולם"
        const wantsAll = lowerSelection === '1' ||
          lowerSelection === 'all' ||
          lowerSelection === 'כולם' ||
          lowerSelection === 'כל המופעים' ||
          lowerSelection === 'את כולם' ||
          lowerSelection.includes('כולם') ||
          lowerSelection.includes('all');

        // User wants SINGLE instance: "2", "single", "רק המופע", "רק את זה", "הזה"
        const wantsSingle = lowerSelection === '2' ||
          lowerSelection === 'single' ||
          lowerSelection === 'רק המופע הזה' ||
          lowerSelection === 'רק את זה' ||
          lowerSelection === 'הזה' ||
          lowerSelection.includes('רק') ||
          lowerSelection.includes('המופע');

        if (wantsAll) {
          const allCandidate = candidates.find(c => c.id === 'all');
          if (allCandidate?.metadata?.recurringEventId) {
            console.log(`[CalendarEntityResolver] User selected ALL - using recurringEventId: ${allCandidate.metadata.recurringEventId}`);
            return {
              type: 'resolved',
              resolvedIds: [allCandidate.metadata.recurringEventId],
              args: {
                ...args,
                eventId: allCandidate.metadata.recurringEventId,
                isRecurringSeries: true,
              },
            };
          }
        }

        if (wantsSingle) {
          const singleCandidate = candidates.find(c => c.id === 'single');
          if (singleCandidate?.metadata?.eventId) {
            console.log(`[CalendarEntityResolver] User selected SINGLE - using eventId: ${singleCandidate.metadata.eventId}`);
            return {
              type: 'resolved',
              resolvedIds: [singleCandidate.metadata.eventId],
              args: {
                ...args,
                eventId: singleCandidate.metadata.eventId,
                isRecurringSeries: false,
              },
            };
          }
        }

        // If unclear, re-ask with clearer options
        console.log(`[CalendarEntityResolver] Unclear recurring choice selection: "${selection}"`);
        return {
          type: 'disambiguation',
          candidates,
          question: this.buildRecurringChoiceQuestion(candidates, args.language || 'he'),
        };
      }

      // Handle "both" or "all" for regular disambiguation (not recurring choice)
      if (lowerSelection === 'both' ||
        lowerSelection === 'שניהם' || lowerSelection === 'כולם') {
        return {
          type: 'resolved',
          resolvedIds: candidates.map(c => c.id),
          args: { ...args, eventIds: candidates.map(c => c.id) },
        };
      }

      // Try to parse as number
      const parsed = parseInt(selection, 10);
      if (!isNaN(parsed)) {
        selection = parsed;
      } else {
        // Invalid selection
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }
    }

    // Handle array selection
    if (Array.isArray(selection)) {
      const selectedCandidates = selection
        .map(idx => candidates[idx - 1])
        .filter(Boolean);

      if (selectedCandidates.length === 0) {
        return {
          type: 'disambiguation',
          candidates,
          question: 'Invalid selection. Please reply with a number.',
        };
      }

      return {
        type: 'resolved',
        resolvedIds: selectedCandidates.map(c => c.id),
        args: {
          ...args,
          eventId: selectedCandidates[0].id,
          eventIds: selectedCandidates.map(c => c.id),
        },
      };
    }

    // Handle single number selection (1-based)
    const index = (selection as number) - 1;
    if (index < 0 || index >= candidates.length) {
      return {
        type: 'disambiguation',
        candidates,
        question: 'Invalid selection. Please reply with a number.',
      };
    }

    const selected = candidates[index];
    
    // Check if this is a recurring choice selection (id is 'all' or 'single')
    if (selected.id === 'all' && selected.metadata?.recurringEventId) {
      console.log(`[CalendarEntityResolver] Number selection (${selection}) → ALL - using recurringEventId: ${selected.metadata.recurringEventId}`);
      return {
        type: 'resolved',
        resolvedIds: [selected.metadata.recurringEventId],
        args: {
          ...args,
          eventId: selected.metadata.recurringEventId,
          isRecurringSeries: true,
          // Include event details from entity for response formatting
          summary: selected.entity?.summary,
          start: selected.entity?.start?.dateTime || selected.entity?.start?.date || selected.entity?.start,
          end: selected.entity?.end?.dateTime || selected.entity?.end?.date || selected.entity?.end,
        },
      };
    }
    
    if (selected.id === 'single' && selected.metadata?.eventId) {
      console.log(`[CalendarEntityResolver] Number selection (${selection}) → SINGLE - using eventId: ${selected.metadata.eventId}`);
      return {
        type: 'resolved',
        resolvedIds: [selected.metadata.eventId],
        args: {
          ...args,
          eventId: selected.metadata.eventId,
          isRecurringSeries: false,
          // Include event details from entity for response formatting
          summary: selected.entity?.summary,
          start: selected.entity?.start?.dateTime || selected.entity?.start?.date || selected.entity?.start,
          end: selected.entity?.end?.dateTime || selected.entity?.end?.date || selected.entity?.end,
        },
      };
    }
    
    // Regular selection (not recurring choice)
    return {
      type: 'resolved',
      resolvedIds: [selected.id],
      args: {
        ...args,
        eventId: selected.id,
        recurringEventId: selected.metadata?.recurringEventId,
        isRecurring: selected.metadata?.isRecurring,
      },
      isRecurring: selected.metadata?.isRecurring,
      recurringEventId: selected.metadata?.recurringEventId,
    };
  }

  // ==========================================================================
  // OPERATION-SPECIFIC RESOLUTION
  // ==========================================================================

  /**
   * Resolve for update operation
   * V1: Uses findEventByCriteria, picks nearest if multiple
   */
  private async resolveUpdate(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const searchCriteria = args.searchCriteria || {};

    // Build criteria from args
    const criteria = {
      summary: searchCriteria.summary || args.summary,
      timeMin: searchCriteria.timeMin || args.timeMin,
      timeMax: searchCriteria.timeMax || args.timeMax,
      dayOfWeek: searchCriteria.dayOfWeek,
      startTime: searchCriteria.startTime,
      endTime: searchCriteria.endTime,
    };

    // Derive window if not provided
    if (!criteria.timeMin || !criteria.timeMax) {
      const derived = this.deriveWindow(args, criteria.summary);
      if (derived) {
        criteria.timeMin = derived.timeMin;
        criteria.timeMax = derived.timeMax;
      } else {
        // Default to wide window
        const now = new Date();
        criteria.timeMin = new Date(now.getTime() - TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
        criteria.timeMax = new Date(now.getTime() + TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_FORWARD * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    const result = await this.findEventByCriteria(criteria, context);

    if (result.type === 'resolved' && result.args) {
      // Check if this is a recurring event and handle series vs instance
      const candidateForRecurringCheck: ResolutionCandidate = {
        id: result.args.eventId,
        displayText: '',
        entity: {},
        score: 1,
        metadata: {
          isRecurring: result.isRecurring,
          recurringEventId: result.recurringEventId,
        }
      };

      const recurringResult = this.handleRecurringEventResolution(
        candidateForRecurringCheck,
        args,
        context,
        'update'
      );

      if (recurringResult) {
        return recurringResult;
      }

      // Merge eventId into args
      return {
        ...result,
        args: { ...args, ...result.args },
      };
    }

    return result;
  }

  /**
   * Resolve for get operation
   * V1: Uses QueryResolver for disambiguation
   */
  private async resolveGet(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    return this.resolveSingleEvent(args, context, 'get');
  }

  // ==========================================================================
  // CORE RESOLUTION METHODS (Ported from V1)
  // ==========================================================================

  /**
   * Resolve a single event (for get/delete single)
   */
  private async resolveSingleEvent(
    args: Record<string, any>,
    context: EntityResolverContext,
    operation: string
  ): Promise<ResolutionOutput> {
    const searchCriteria = args.searchCriteria || {};
    const summary = args.summary || searchCriteria.summary;

    if (!summary) {
      return {
        type: 'clarify_query',
        error: 'No event description provided',
        searchedFor: '',
        suggestions: ['Provide event summary/title'],
      };
    }

    // Build search criteria
    const criteria = {
      summary,
      timeMin: searchCriteria.timeMin || args.timeMin,
      timeMax: searchCriteria.timeMax || args.timeMax,
      dayOfWeek: searchCriteria.dayOfWeek,
      startTime: searchCriteria.startTime,
      endTime: searchCriteria.endTime,
    };

    // Derive window if not provided
    if (!criteria.timeMin || !criteria.timeMax) {
      const derived = this.deriveWindow(args, summary);
      if (derived) {
        criteria.timeMin = derived.timeMin;
        criteria.timeMax = derived.timeMax;
      } else {
        // Default window
        const now = new Date();
        criteria.timeMin = new Date(now.getTime() - TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
        criteria.timeMax = new Date(now.getTime() + TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_FORWARD * 24 * 60 * 60 * 1000).toISOString();
      }
    }

    // Fetch and filter events
    const candidates = await this.fetchAndFilterEvents(criteria, context);

    if (candidates.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('event_not_found', context.language, { searchedFor: summary }),
        searchedFor: summary,
      };
    }

    // Determine the selected candidate
    let selectedCandidate: ResolutionCandidate;

    if (candidates.length === 1) {
      selectedCandidate = candidates[0];
    } else {
      // Multiple matches - first check if all belong to same recurring series
      const allSameRecurringSeries = this.checkAllSameRecurringSeries(candidates);

      if (allSameRecurringSeries) {
        // All candidates are instances of the same recurring event
        // Pick nearest upcoming and handle as recurring
        console.log(`[CalendarEntityResolver] All ${candidates.length} candidates are from same recurring series`);
        selectedCandidate = this.pickNearestUpcoming(candidates);
      } else {
        // Different events - check score gap for disambiguation
        const behavior = getOperationBehavior('calendar', operation);
        const scoreGap = candidates[0].score - candidates[1].score;

        if (scoreGap >= RESOLUTION_THRESHOLDS.DISAMBIGUATION_GAP) {
          // High confidence in first match
          selectedCandidate = candidates[0];
        } else {
          // Need regular disambiguation (multiple different events)
          return {
            type: 'disambiguation',
            candidates: candidates.slice(0, 5),  // Max 5 options
            question: this.buildDisambiguationQuestion(candidates.slice(0, 5), context.language),
            allowMultiple: behavior.allowSelectAll,
          };
        }
      }
    }

    // Check if this is a recurring event and handle series vs instance
    const recurringResult = this.handleRecurringEventResolution(
      selectedCandidate,
      args,
      context,
      operation
    );

    if (recurringResult) {
      return recurringResult;
    }

    // Not recurring or series intent was set - return resolved
    return {
      type: 'resolved',
      resolvedIds: [selectedCandidate.id],
      args: {
        ...args,
        eventId: selectedCandidate.id,
        recurringEventId: selectedCandidate.metadata?.recurringEventId,
        isRecurring: selectedCandidate.metadata?.isRecurring,
      },
      isRecurring: selectedCandidate.metadata?.isRecurring,
      recurringEventId: selectedCandidate.metadata?.recurringEventId,
    };
  }

  /**
   * Resolve delete by window - delete ALL matching events
   * Explicit operation: deleteByWindow
   */
  private async resolveDeleteByWindow(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const searchCriteria = args.searchCriteria || {};
    const summary = args.summary || searchCriteria.summary;
    const excludeSummaries = args.excludeSummaries;
    const timeMin = args.timeMin || searchCriteria.timeMin;
    const timeMax = args.timeMax || searchCriteria.timeMax;

    // Validate time window
    if (!timeMin || !timeMax) {
      // Try to derive window from args
      const derivedWindow = this.deriveWindow(args, summary);
      if (!derivedWindow) {
        return {
          type: 'not_found',
          error: 'Time window (timeMin/timeMax) required for deleteByWindow',
          searchedFor: summary || '',
        };
      }
      // Use derived window
      args.timeMin = derivedWindow.timeMin;
      args.timeMax = derivedWindow.timeMax;
    }

    // Fetch events in window
    const calendarService = getCalendarService();
    if (!calendarService) {
      return { type: 'not_found', error: 'Calendar service unavailable' };
    }

    const eventsResp = await calendarService.getEvents({
      timeMin: args.timeMin,
      timeMax: args.timeMax
    });
    if (!eventsResp.success || !eventsResp.data?.events) {
      return { type: 'not_found', error: 'Failed to fetch events' };
    }

    let events = eventsResp.data.events as any[];

    // Filter OUT excluded summaries
    if (excludeSummaries && excludeSummaries.length > 0) {
      events = events.filter(event => {
        const eventSummary = (event.summary || '').toLowerCase().trim();
        const shouldExclude = excludeSummaries.some((excludeTerm: string) => {
          const normalizedTerm = excludeTerm.toLowerCase().trim();
          return eventSummary.includes(normalizedTerm);
        });
        return !shouldExclude;
      });
    }

    // Filter IN by summary using FuzzyMatcher
    if (summary) {
      const matches = FuzzyMatcher.search<any>(
        summary,
        events,
        ['summary', 'description'],
        RESOLUTION_THRESHOLDS.CALENDAR_DELETE_THRESHOLD
      );
      events = matches.map(m => m.item);
    }

    if (events.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('event_not_found', context.language, {
          searchedFor: summary || `events in ${this.formatWindow(args.timeMin, args.timeMax)}`
        }),
        searchedFor: summary || '',
      };
    }

    // Map to master IDs (for recurring events)
    const masterIds = new Map<string, { id: string; summary: string; event: any }>();
    events.forEach(event => {
      const masterId = event.recurringEventId || event.id;
      if (masterId && !masterIds.has(masterId)) {
        masterIds.set(masterId, {
          id: masterId,
          summary: event.summary || 'Untitled Event',
          event: event,
        });
      }
    });

    // Return all IDs for deletion with explicit operation
    return {
      type: 'resolved',
      resolvedIds: Array.from(masterIds.keys()),
      args: {
        ...args,
        operation: 'deleteByWindow',  // Keep explicit operation name
        eventIds: Array.from(masterIds.keys()),
        deletedSummaries: Array.from(masterIds.values()).map(v => v.summary),
        originalEvents: Array.from(masterIds.values()).map(v => v.event),
      },
    };
  }

  /**
   * Resolve update by window - update ALL matching events
   * Explicit operation: updateByWindow
   */
  private async resolveUpdateByWindow(
    args: Record<string, any>,
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const searchCriteria = args.searchCriteria || {};
    const summary = args.summary || searchCriteria.summary;
    const excludeSummaries = args.excludeSummaries;
    let timeMin = args.timeMin || searchCriteria.timeMin;
    let timeMax = args.timeMax || searchCriteria.timeMax;

    // Validate time window
    if (!timeMin || !timeMax) {
      // Try to derive window from args
      const derivedWindow = this.deriveWindow(args, summary);
      if (!derivedWindow) {
        return {
          type: 'not_found',
          error: 'Time window (timeMin/timeMax) required for updateByWindow',
          searchedFor: summary || '',
        };
      }
      timeMin = derivedWindow.timeMin;
      timeMax = derivedWindow.timeMax;
    }

    // Fetch events in window
    const calendarService = getCalendarService();
    if (!calendarService) {
      return { type: 'not_found', error: 'Calendar service unavailable' };
    }

    const eventsResp = await calendarService.getEvents({ timeMin, timeMax });
    if (!eventsResp.success || !eventsResp.data?.events) {
      return { type: 'not_found', error: 'Failed to fetch events' };
    }

    let events = eventsResp.data.events as any[];

    // Filter OUT excluded summaries
    if (excludeSummaries && excludeSummaries.length > 0) {
      events = events.filter(event => {
        const eventSummary = (event.summary || '').toLowerCase().trim();
        const shouldExclude = excludeSummaries.some((excludeTerm: string) => {
          const normalizedTerm = excludeTerm.toLowerCase().trim();
          return eventSummary.includes(normalizedTerm);
        });
        return !shouldExclude;
      });
    }

    // Filter IN by summary using FuzzyMatcher
    if (summary) {
      const matches = FuzzyMatcher.search<any>(
        summary,
        events,
        ['summary', 'description'],
        RESOLUTION_THRESHOLDS.FUZZY_MATCH_MIN
      );
      events = matches.map(m => m.item);
    }

    if (events.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('event_not_found', context.language, {
          searchedFor: summary || `events in ${this.formatWindow(timeMin, timeMax)}`
        }),
        searchedFor: summary || '',
      };
    }

    // Return all event IDs for update with explicit operation
    return {
      type: 'resolved',
      resolvedIds: events.map(e => e.id),
      args: {
        ...args,
        operation: 'updateByWindow',  // Keep explicit operation name
        eventIds: events.map(e => e.id),
        originalEvents: events,  // For calculating new times
      },
    };
  }

  /**
   * Find event by criteria - multi-strategy search
   * V1: findEventByCriteria()
   */
  private async findEventByCriteria(
    criteria: {
      summary?: string;
      timeMin?: string;
      timeMax?: string;
      dayOfWeek?: string;
      startTime?: string;
      endTime?: string;
    },
    context: EntityResolverContext
  ): Promise<ResolutionOutput> {
    const candidates = await this.fetchAndFilterEvents(criteria, context);

    if (candidates.length === 0) {
      return {
        type: 'not_found',
        error: getDisambiguationMessage('event_not_found', context.language, {
          searchedFor: criteria.summary || ''
        }),
        searchedFor: criteria.summary || '',
      };
    }

    // Pick the best candidate (nearest upcoming if multiple)
    const selectedCandidate = candidates.length > 1
      ? this.pickNearestUpcoming(candidates)
      : candidates[0];

    // Note: findEventByCriteria is used by resolveUpdate which passes args separately
    // The recurring handling will be done by the caller (resolveUpdate)
    return {
      type: 'resolved',
      resolvedIds: [selectedCandidate.id],
      args: {
        eventId: selectedCandidate.id,
        recurringEventId: selectedCandidate.metadata?.recurringEventId,
        isRecurring: selectedCandidate.metadata?.isRecurring,
      },
      isRecurring: selectedCandidate.metadata?.isRecurring,
      recurringEventId: selectedCandidate.metadata?.recurringEventId,
    };
  }

  /**
   * Fetch events and filter by criteria
   */
  private async fetchAndFilterEvents(
    criteria: {
      summary?: string;
      timeMin?: string;
      timeMax?: string;
      dayOfWeek?: string;
      startTime?: string;
      endTime?: string;
    },
    context: EntityResolverContext
  ): Promise<ResolutionCandidate[]> {
    const calendarService = getCalendarService();
    if (!calendarService) {
      return [];
    }

    // Ensure we have a time window
    let { timeMin, timeMax } = criteria;
    if (!timeMin || !timeMax) {
      const now = new Date();
      timeMin = timeMin || new Date(now.getTime() - TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
      timeMax = timeMax || new Date(now.getTime() + TIME_WINDOW_DEFAULTS.CALENDAR_DEFAULT_DAYS_FORWARD * 24 * 60 * 60 * 1000).toISOString();
    }

    // Fetch events
    const eventsResp = await calendarService.getEvents({ timeMin, timeMax });
    if (!eventsResp.success || !eventsResp.data?.events?.length) {
      return [];
    }

    let events = eventsResp.data.events as any[];
    let candidates: ResolutionCandidate[] = [];

    // Filter by summary using FuzzyMatcher
    if (criteria.summary) {
      const matches = FuzzyMatcher.search<any>(
        criteria.summary,
        events,
        ['summary', 'description'],
        RESOLUTION_THRESHOLDS.FUZZY_MATCH_MIN
      );

      candidates = matches.map(m => ({
        id: m.item.id,
        displayText: this.formatEventDisplay(m.item),
        entity: m.item,
        score: m.score,
        metadata: {
          isRecurring: !!m.item.recurringEventId,
          recurringEventId: m.item.recurringEventId,
          start: m.item.start,
          end: m.item.end,
        },
      }));
    } else {
      // No summary filter - return all
      candidates = events.map(event => ({
        id: event.id,
        displayText: this.formatEventDisplay(event),
        entity: event,
        score: 1.0,
        metadata: {
          isRecurring: !!event.recurringEventId,
          recurringEventId: event.recurringEventId,
          start: event.start,
          end: event.end,
        },
      }));
    }

    // Filter by time of day
    if (criteria.startTime || criteria.endTime) {
      candidates = candidates.filter(c => {
        const event = c.entity;
        if (!event.start) return false;

        const parseToMinutes = (hhmm: string) => {
          const [h, m] = hhmm.split(':').map(Number);
          return h * 60 + m;
        };

        const eventDate = new Date(event.start.dateTime || event.start.date || event.start);
        const eventStartMinutes = eventDate.getHours() * 60 + eventDate.getMinutes();
        const eventEndDate = new Date(event.end?.dateTime || event.end?.date || event.end || event.start);
        const eventEndMinutes = eventEndDate.getHours() * 60 + eventEndDate.getMinutes();

        const windowStart = criteria.startTime ? parseToMinutes(criteria.startTime) : 0;
        const windowEnd = criteria.endTime ? parseToMinutes(criteria.endTime) : 24 * 60;

        // Check overlap
        return eventStartMinutes <= windowEnd && eventEndMinutes >= windowStart;
      });
    }

    // Filter by day of week
    if (criteria.dayOfWeek) {
      const dayNames: Record<string, number> = {
        'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
        'thursday': 4, 'friday': 5, 'saturday': 6,
        'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
        'חמישי': 4, 'שישי': 5, 'שבת': 6,
      };
      const targetDay = dayNames[criteria.dayOfWeek.toLowerCase()];

      if (targetDay !== undefined) {
        candidates = candidates.filter(c => {
          const event = c.entity;
          if (!event.start) return false;
          const eventDate = new Date(event.start.dateTime || event.start.date || event.start);
          return eventDate.getDay() === targetDay;
        });
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  // ==========================================================================
  // RECURRING EVENT HANDLING
  // ==========================================================================

  /**
   * Check if all candidates belong to the same recurring series
   * Returns true if all candidates have the same recurringEventId
   */
  private checkAllSameRecurringSeries(candidates: ResolutionCandidate[]): boolean {
    if (candidates.length < 2) return false;

    // Get the recurringEventId from the first candidate
    const firstRecurringId = candidates[0].metadata?.recurringEventId;

    // If first candidate is not recurring, not all are from same series
    if (!firstRecurringId) return false;

    // Check if ALL candidates have the same recurringEventId
    return candidates.every(c => c.metadata?.recurringEventId === firstRecurringId);
  }

  /**
   * Handle recurring event resolution
   * 
   * HITL triggers ONLY when:
   * - LLM resolver did NOT set recurringSeriesIntent: true
   * - AND entity resolver discovers the event is recurring (has recurringEventId)
   * 
   * NO HITL when:
   * - recurringSeriesIntent: true -> proceed directly with series operation
   * - Event is not recurring -> proceed normally
   * 
   * @returns ResolutionOutput if HITL needed or series intent, null to continue normal flow
   */
  private handleRecurringEventResolution(
    selectedCandidate: ResolutionCandidate,
    args: Record<string, any>,
    context: EntityResolverContext,
    operation: string
  ): ResolutionOutput | null {
    // Only handle delete and update operations
    if (operation !== 'delete' && operation !== 'update') {
      return null;
    }

    const isRecurringEvent = !!selectedCandidate.metadata?.recurringEventId;

    if (!isRecurringEvent) {
      // Not a recurring event - continue normal flow
      return null;
    }

    const recurringEventId = selectedCandidate.metadata!.recurringEventId;

    // Case 1: User explicitly wanted series -> proceed directly (NO HITL)
    if (args.recurringSeriesIntent === true) {
      console.log(`[CalendarEntityResolver] recurringSeriesIntent=true, using recurringEventId: ${recurringEventId}`);
      return {
        type: 'resolved',
        resolvedIds: [recurringEventId],
        args: {
          ...args,
          eventId: recurringEventId,
          isRecurringSeries: true,
        },
      };
    }

    // Case 2: User intended single event BUT event is recurring -> HITL
    // Ask: "This is a recurring event, do you want all or just this one?"
    console.log(`[CalendarEntityResolver] Event is recurring but no series intent - triggering HITL`);

    const recurrencePattern = this.formatRecurrencePattern(selectedCandidate, context.language);
    const instanceDisplay = this.formatEventDisplay(selectedCandidate.entity);
    
    // Build question with numbered options for clear user response
    const question = context.language === 'he'
      ? `האירוע שאתה מנסה לשנות הוא אירוע חוזר כל ${recurrencePattern}.\nהאם תרצה לשנות את כולם או רק את המופע הזה?\n\n1️⃣ כל המופעים\n2️⃣ רק המופע הזה (${instanceDisplay})`
      : `The event you're trying to modify recurs every ${recurrencePattern}.\nDo you want to modify all occurrences or just this instance?\n\n1️⃣ All occurrences\n2️⃣ Just this instance (${instanceDisplay})`;

    return {
      type: 'disambiguation',
      question,
      candidates: [
        {
          id: 'all',
          displayText: context.language === 'he' ? '1️⃣ כל המופעים' : '1️⃣ All occurrences',
          entity: selectedCandidate.entity,
          score: 1,
          metadata: {
            recurringEventId,
            isRecurringSeries: true
          }
        },
        {
          id: 'single',
          displayText: context.language === 'he'
            ? `2️⃣ רק המופע הזה (${instanceDisplay})`
            : `2️⃣ Just this instance (${instanceDisplay})`,
          entity: selectedCandidate.entity,
          score: 1,
          metadata: {
            eventId: selectedCandidate.id,
            isRecurringSeries: false
          }
        }
      ],
      allowMultiple: false,
    };
  }

  /**
   * Build recurring choice question for re-asking when user's answer was unclear
   */
  private buildRecurringChoiceQuestion(candidates: ResolutionCandidate[], language: string): string {
    const allCandidate = candidates.find(c => c.id === 'all');
    const singleCandidate = candidates.find(c => c.id === 'single');
    
    const instanceDisplay = singleCandidate?.entity 
      ? this.formatEventDisplay(singleCandidate.entity)
      : '';

    if (language === 'he') {
      return `לא הבנתי. בבקשה בחר:\n\n1️⃣ כל המופעים\n2️⃣ רק המופע הזה${instanceDisplay ? ` (${instanceDisplay})` : ''}`;
    }
    return `I didn't understand. Please select:\n\n1️⃣ All occurrences\n2️⃣ Just this instance${instanceDisplay ? ` (${instanceDisplay})` : ''}`;
  }

  /**
   * Format recurrence pattern for display in HITL question
   */
  private formatRecurrencePattern(candidate: ResolutionCandidate, language: 'he' | 'en' | 'other'): string {
    const event = candidate.entity;
    const start = event.start?.dateTime || event.start?.date || event.start;

    if (!start) {
      return language === 'he' ? 'באופן קבוע' : 'regularly';
    }

    const date = new Date(start);
    const dayNames = {
      he: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
      en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    };

    const dayName = language === 'he' ? dayNames.he[date.getDay()] : dayNames.en[date.getDay()];
    const time = date.toLocaleTimeString(language === 'he' ? 'he-IL' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (language === 'he') {
      return `יום ${dayName} ב-${time}`;
    }
    return `${dayName} at ${time}`;
  }

  // ==========================================================================
  // UTILITY METHODS (Ported from V1)
  // ==========================================================================

  /**
   * Derive time window from params or phrase
   * V1: deriveWindow()
   */
  private deriveWindow(params: any, phrase?: string): { timeMin: string; timeMax: string } | null {
    // 1. Explicit timeMin/timeMax
    if (params.timeMin && params.timeMax) {
      return { timeMin: params.timeMin, timeMax: params.timeMax };
    }

    // 2. From start/end ISO dates
    const isoSource = [params.start, params.end].find(
      (value: any) => typeof value === 'string' && value.includes('T')
    );
    if (isoSource) {
      const date = new Date(isoSource);
      if (!Number.isNaN(date.getTime())) {
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return { timeMin: start.toISOString(), timeMax: end.toISOString() };
      }
    }

    // 3. Parse from phrase
    if (phrase) {
      const range = TimeParser.parseDateRange(phrase);
      if (range) {
        return { timeMin: range.start, timeMax: range.end };
      }
    }

    // 4. From searchCriteria
    if (params.searchCriteria?.timeMin && params.searchCriteria?.timeMax) {
      return { timeMin: params.searchCriteria.timeMin, timeMax: params.searchCriteria.timeMax };
    }

    return null;
  }

  /**
   * Pick the nearest upcoming event from candidates
   * V1: Used in findEventByCriteria when multiple matches
   */
  private pickNearestUpcoming(candidates: ResolutionCandidate[]): ResolutionCandidate {
    const now = new Date().getTime();

    const sorted = candidates
      .map(c => ({
        candidate: c,
        startTime: new Date(
          c.entity.start?.dateTime || c.entity.start?.date || c.entity.start
        ).getTime(),
      }))
      .sort((a, b) => {
        // Prioritize future events
        const aFuture = a.startTime >= now;
        const bFuture = b.startTime >= now;

        if (aFuture && !bFuture) return -1;
        if (!aFuture && bFuture) return 1;

        // Both future or both past - pick nearest
        return Math.abs(a.startTime - now) - Math.abs(b.startTime - now);
      });

    return sorted[0]?.candidate || candidates[0];
  }

  /**
   * Group events by similarity
   */
  private groupEventsBySimilarity(candidates: ResolutionCandidate[]): EventGroups {
    const groups: EventGroups = {
      sameRecurringSeries: [],
      exactSummary: [],
      similar: [],
    };

    // Group by recurring series
    const recurringMap = new Map<string, ResolutionCandidate[]>();
    const nonRecurring: ResolutionCandidate[] = [];

    for (const candidate of candidates) {
      const recurringId = candidate.metadata?.recurringEventId;
      if (recurringId) {
        const existing = recurringMap.get(recurringId) || [];
        existing.push(candidate);
        recurringMap.set(recurringId, existing);
      } else {
        nonRecurring.push(candidate);
      }
    }

    // Add recurring series groups
    for (const [, events] of recurringMap) {
      if (events.length > 1) {
        groups.sameRecurringSeries.push(...events);
      } else {
        nonRecurring.push(...events);
      }
    }

    // Group non-recurring by summary similarity
    const summaryMap = new Map<string, ResolutionCandidate[]>();
    for (const candidate of nonRecurring) {
      const summary = (candidate.entity.summary || '').toLowerCase().trim();
      const existing = summaryMap.get(summary) || [];
      existing.push(candidate);
      summaryMap.set(summary, existing);
    }

    for (const [, events] of summaryMap) {
      if (events.length > 1) {
        groups.exactSummary.push(...events);
      } else {
        groups.similar.push(...events);
      }
    }

    return groups;
  }

  /**
   * Build disambiguation question
   * V1: buildDisambiguationMessage()
   */
  private buildDisambiguationQuestion(candidates: ResolutionCandidate[], language: 'he' | 'en' | 'other'): string {
    const lines = candidates.map((c, index) => {
      return `${index + 1}. ${c.displayText}`;
    });

    const optionsText = lines.join('\n');
    return getDisambiguationMessage('event_multiple', language, { options: optionsText });
  }

  /**
   * Format event for display
   */
  private formatEventDisplay(event: any): string {
    const summary = event.summary || 'Untitled Event';
    const start = event.start?.dateTime || event.start?.date || event.start;

    if (start) {
      const date = new Date(start);
      const formatted = date.toLocaleString('he-IL', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `${summary} (${formatted})`;
    }

    return summary;
  }

  /**
   * Format time window for display
   */
  private formatWindow(timeMin: string, timeMax: string): string {
    const start = new Date(timeMin).toLocaleDateString('he-IL');
    const end = new Date(timeMax).toLocaleDateString('he-IL');
    return `${start} - ${end}`;
  }
}

