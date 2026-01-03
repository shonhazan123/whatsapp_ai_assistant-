/**
 * Time utility for natural language time parsing
 * 
 * Adapted from V1 src/utils/time.ts
 * Handles Hebrew and English time expressions.
 */

import * as chrono from 'chrono-node';
import { addDays, addWeeks, startOfDay, startOfWeek, endOfDay, endOfWeek } from 'date-fns';

const TIMEZONE = 'Asia/Jerusalem';

export class TimeParser {
  /**
   * Parse natural language time expression to ISO string
   * Examples: "מחר ב10", "tomorrow at 10am", "next Monday", "בעוד שבוע"
   */
  static parseToISO(text: string, referenceDate: Date = new Date()): string | null {
    // Try chrono-node first (handles English well)
    const parsed = chrono.parse(text, referenceDate, { forwardDate: true });
    
    if (parsed.length > 0) {
      const date = parsed[0].start.date();
      return date.toISOString();
    }

    // Handle Hebrew expressions
    const hebrewParsed = this.parseHebrew(text, referenceDate);
    if (hebrewParsed) {
      return hebrewParsed.toISOString();
    }

    return null;
  }

  /**
   * Parse Hebrew time expressions
   */
  private static parseHebrew(text: string, referenceDate: Date): Date | null {
    const lowerText = text.toLowerCase();

    // Today
    if (lowerText.includes('היום')) {
      return this.extractTime(lowerText, startOfDay(referenceDate));
    }

    // Tomorrow
    if (lowerText.includes('מחר')) {
      return this.extractTime(lowerText, addDays(startOfDay(referenceDate), 1));
    }

    // Yesterday
    if (lowerText.includes('אתמול')) {
      return this.extractTime(lowerText, addDays(startOfDay(referenceDate), -1));
    }

    // Next week
    if (lowerText.includes('שבוע הבא') || lowerText.includes('בעוד שבוע')) {
      return addWeeks(referenceDate, 1);
    }

    // This week
    if (lowerText.includes('השבוע')) {
      return startOfWeek(referenceDate, { weekStartsOn: 0 });
    }

    // Days of week in Hebrew
    const dayMap: Record<string, number> = {
      'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
      'חמישי': 4, 'שישי': 5, 'שבת': 6
    };

    for (const [hebrewDay, dayNum] of Object.entries(dayMap)) {
      if (lowerText.includes(hebrewDay)) {
        const targetDate = this.getNextDayOfWeek(referenceDate, dayNum);
        return this.extractTime(lowerText, targetDate);
      }
    }

    return null;
  }

  /**
   * Extract time from text and apply to date
   */
  private static extractTime(text: string, baseDate: Date): Date {
    // Match patterns like "10:00", "ב10", "בשעה 14:30"
    const timeMatch = text.match(/(\d{1,2})(?::(\d{2}))?/);
    
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      
      const result = new Date(baseDate);
      result.setHours(hours, minutes, 0, 0);
      return result;
    }

    // Default to 10:00 if no time specified
    const result = new Date(baseDate);
    result.setHours(10, 0, 0, 0);
    return result;
  }

  /**
   * Get next occurrence of day of week
   */
  private static getNextDayOfWeek(referenceDate: Date, targetDay: number): Date {
    const current = referenceDate.getDay();
    const daysToAdd = (targetDay - current + 7) % 7 || 7;
    return addDays(referenceDate, daysToAdd);
  }

  /**
   * Parse date range from text
   */
  static parseDateRange(text: string): { start: string; end: string } | null {
    const lowerText = text.toLowerCase();
    const now = new Date();

    if (lowerText.includes('היום') || lowerText.includes('today')) {
      return {
        start: startOfDay(now).toISOString(),
        end: endOfDay(now).toISOString()
      };
    }

    if (lowerText.includes('השבוע') || lowerText.includes('this week')) {
      return {
        start: startOfWeek(now, { weekStartsOn: 0 }).toISOString(),
        end: endOfWeek(now, { weekStartsOn: 0 }).toISOString()
      };
    }

    if (lowerText.includes('החודש') || lowerText.includes('this month')) {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return {
        start: start.toISOString(),
        end: end.toISOString()
      };
    }

    return null;
  }

  /**
   * Parse recurrence pattern
   */
  static parseRecurrence(text: string): RecurrencePattern | null {
    const lowerText = text.toLowerCase();

    // Daily
    if (lowerText.includes('כל יום') || lowerText.includes('daily') || lowerText.includes('יומי')) {
      return { type: 'daily', interval: 1 };
    }

    // Weekly
    if (lowerText.includes('כל שבוע') || lowerText.includes('weekly') || lowerText.includes('שבועי')) {
      const days = this.extractDaysOfWeek(text);
      return { type: 'weekly', interval: 1, days };
    }

    // Every two weeks
    if (lowerText.includes('כל שבועיים') || lowerText.includes('biweekly')) {
      const days = this.extractDaysOfWeek(text);
      return { type: 'weekly', interval: 2, days };
    }

    // Monthly
    if (lowerText.includes('כל חודש') || lowerText.includes('monthly') || lowerText.includes('חודשי')) {
      return { type: 'monthly', interval: 1 };
    }

    return null;
  }

  /**
   * Extract days of week from text
   */
  private static extractDaysOfWeek(text: string): string[] {
    const dayMap: Record<string, string> = {
      'ראשון': 'Sunday', 'א\'': 'Sunday',
      'שני': 'Monday', 'ב\'': 'Monday',
      'שלישי': 'Tuesday', 'ג\'': 'Tuesday',
      'רביעי': 'Wednesday', 'ד\'': 'Wednesday',
      'חמישי': 'Thursday', 'ה\'': 'Thursday',
      'שישי': 'Friday', 'ו\'': 'Friday',
      'שבת': 'Saturday', 'ש\'': 'Saturday'
    };

    const days: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [hebrew, english] of Object.entries(dayMap)) {
      if (lowerText.includes(hebrew.toLowerCase())) {
        if (!days.includes(english)) {
          days.push(english);
        }
      }
    }

    // English days
    const englishDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    englishDays.forEach(day => {
      if (lowerText.includes(day)) {
        const capitalized = day.charAt(0).toUpperCase() + day.slice(1);
        if (!days.includes(capitalized)) {
          days.push(capitalized);
        }
      }
    });

    return days;
  }

  /**
   * Format date for display (Hebrew)
   */
  static formatForDisplay(date: Date, includeTime: boolean = true): string {
    const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
    const dayOfWeek = days[date.getDay()];
    const day = date.getDate();
    const month = date.getMonth() + 1;
    
    let result = `${dayOfWeek} ${day}/${month}`;
    
    if (includeTime) {
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      result += ` ${hours}:${minutes}`;
    }
    
    return result;
  }
}

export interface RecurrencePattern {
  type: 'daily' | 'weekly' | 'monthly';
  interval: number;
  days?: string[]; // For weekly: ['Monday', 'Wednesday']
  until?: string; // ISO string
}

