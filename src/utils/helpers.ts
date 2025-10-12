// src/utils/helpers.ts
  /**
   * Parse natural language time expressions to Date objects
   */
  export function parseNaturalTime(expression: string): Date {
    const now = new Date();
    const lowerExpr = expression.toLowerCase();
  
    // Handle "tomorrow"
    if (lowerExpr.includes('tomorrow')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      if (lowerExpr.includes('morning')) {
        tomorrow.setHours(9, 0, 0, 0);
      } else if (lowerExpr.includes('afternoon')) {
        tomorrow.setHours(14, 0, 0, 0);
      } else if (lowerExpr.includes('evening')) {
        tomorrow.setHours(19, 0, 0, 0);
      } else {
        tomorrow.setHours(10, 0, 0, 0);
      }
      
      return tomorrow;
    }
  
    // Handle "today"
    if (lowerExpr.includes('today')) {
      const today = new Date(now);
      
      if (lowerExpr.includes('morning')) {
        today.setHours(9, 0, 0, 0);
      } else if (lowerExpr.includes('afternoon')) {
        today.setHours(14, 0, 0, 0);
      } else if (lowerExpr.includes('evening')) {
        today.setHours(19, 0, 0, 0);
      } else {
        today.setHours(now.getHours() + 1, 0, 0, 0);
      }
      
      return today;
    }
  
    // Handle "this weekend"
    if (lowerExpr.includes('weekend') || lowerExpr.includes('saturday')) {
      const saturday = new Date(now);
      const daysUntilSaturday = (6 - now.getDay() + 7) % 7;
      saturday.setDate(saturday.getDate() + daysUntilSaturday);
      saturday.setHours(10, 0, 0, 0);
      return saturday;
    }
  
    // Default: 1 hour from now
    const future = new Date(now);
    future.setHours(future.getHours() + 1);
    return future;
  }
  
  /**
   * Format date for display
   */
  export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  /**
   * Validate email format
   */
  export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Sanitize phone number
   */
  export function sanitizePhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '');
  }
  
  /**
   * Generate UUID v4
   */
  export function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  /**
   * Truncate text to specified length
   */
  export function truncateText(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
  
  /**
   * Sleep/delay utility
   */
  export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Retry function with exponential backoff
   */
  export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, i);
          await sleep(delay);
        }
      }
    }
    
    throw lastError;
  }