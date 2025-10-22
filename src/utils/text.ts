/**
 * Text utilities for language detection and normalization
 */

export class TextUtils {
  /**
   * Detect if text is primarily Hebrew
   */
  static isHebrew(text: string): boolean {
    const hebrewChars = text.match(/[\u0590-\u05FF]/g);
    const totalChars = text.replace(/\s/g, '').length;
    
    if (totalChars === 0) return false;
    
    const hebrewRatio = (hebrewChars?.length || 0) / totalChars;
    return hebrewRatio > 0.5;
  }

  /**
   * Detect language (he/en)
   */
  static detectLanguage(text: string): 'he' | 'en' {
    return this.isHebrew(text) ? 'he' : 'en';
  }

  /**
   * Normalize text for comparison
   */
  static normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Extract email addresses from text
   */
  static extractEmails(text: string): string[] {
    const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
    return text.match(emailRegex) || [];
  }

  /**
   * Extract phone numbers from text
   */
  static extractPhones(text: string): string[] {
    const phoneRegex = /(\+?972|0)?[\s-]?5\d{1}[\s-]?\d{3}[\s-]?\d{4}/g;
    return text.match(phoneRegex) || [];
  }

  /**
   * Extract numbers from text
   */
  static extractNumbers(text: string): number[] {
    const numberRegex = /\d+/g;
    const matches = text.match(numberRegex);
    return matches ? matches.map(n => parseInt(n, 10)) : [];
  }

  /**
   * Truncate text to max length
   */
  static truncate(text: string, maxLength: number, suffix: string = '...'): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Get appropriate greeting based on language
   */
  static getGreeting(language: 'he' | 'en'): string {
    return language === 'he' ? 'שלום' : 'Hello';
  }

  /**
   * Get confirmation message based on language
   */
  static getConfirmation(language: 'he' | 'en', action: string): string {
    if (language === 'he') {
      return `האם אתה בטוח שברצונך ${action}?`;
    }
    return `Are you sure you want to ${action}?`;
  }

  /**
   * Get error message based on language
   */
  static getErrorMessage(language: 'he' | 'en', error: string): string {
    if (language === 'he') {
      return `אירעה שגיאה: ${error}`;
    }
    return `An error occurred: ${error}`;
  }

  /**
   * Get success message based on language
   */
  static getSuccessMessage(language: 'he' | 'en', action: string): string {
    if (language === 'he') {
      return `${action} בוצע בהצלחה`;
    }
    return `${action} completed successfully`;
  }

  /**
   * Format list for display
   */
  static formatList(items: string[], language: 'he' | 'en'): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    
    const separator = language === 'he' ? ' ו' : ' and ';
    const lastItem = items[items.length - 1];
    const otherItems = items.slice(0, -1).join(', ');
    
    return `${otherItems}${separator}${lastItem}`;
  }

  /**
   * Clean text for LLM processing
   */
  static cleanForLLM(text: string): string {
    return text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract quoted text
   */
  static extractQuoted(text: string): string[] {
    const quoted: string[] = [];
    const singleQuoteRegex = /'([^']*)'/g;
    const doubleQuoteRegex = /"([^"]*)"/g;
    
    let match;
    while ((match = singleQuoteRegex.exec(text)) !== null) {
      quoted.push(match[1]);
    }
    while ((match = doubleQuoteRegex.exec(text)) !== null) {
      quoted.push(match[1]);
    }
    
    return quoted;
  }
}

