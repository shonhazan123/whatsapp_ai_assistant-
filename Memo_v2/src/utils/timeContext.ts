/**
 * Time Context Utility
 * 
 * Adapted from V1 src/utils/timeContext.ts
 * Provides current time context for LLM injection.
 * This allows system prompts to remain static (for caching) while still
 * giving the LLM accurate time awareness for interpreting user requests.
 * 
 * Uses Israel timezone (Asia/Jerusalem) with automatic DST handling.
 */

/**
 * Get current time context string to prepend to user messages
 * Format: [Current time: Day, DD/MM/YYYY HH:mm (ISO), Timezone: Asia/Jerusalem]
 */
export function getTimeContextString(timezone: string = 'Asia/Jerusalem'): string {
  const now = new Date();
  
  // Get local time components with proper DST handling
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    hour12: false
  };
  
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  
  // Build parts map
  const dateParts: Record<string, string> = {};
  parts.forEach(p => dateParts[p.type] = p.value);
  
  // Get ISO-like format in the timezone
  const isoFormatter = new Intl.DateTimeFormat('sv-SE', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const isoLocal = isoFormatter.format(now).replace(' ', 'T');
  
  // Determine timezone offset
  const offset = getTimezoneOffset(now, timezone);
  
  // Format: readable date + ISO for precise parsing + day of week info
  const dayIndex = now.getDay();
  const dayInfo = `Day: ${dateParts.weekday} (${dayIndex})`;
  
  return `[Current time: ${dateParts.weekday}, ${dateParts.day}/${dateParts.month}/${dateParts.year} ${dateParts.hour}:${dateParts.minute} (${isoLocal}${offset}), ${dayInfo}, Timezone: ${timezone}]`;
}

/**
 * Get timezone offset string (e.g., +02:00 or +03:00)
 */
function getTimezoneOffset(date: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    
    const parts = formatter.formatToParts(date);
    const offsetPart = parts.find(p => p.type === 'timeZoneName');
    
    if (offsetPart && offsetPart.value) {
      // Should return something like "GMT+2" or "GMT+3"
      const match = offsetPart.value.match(/([+-]\d+)/);
      if (match) {
        const hours = parseInt(match[1]);
        return `${hours >= 0 ? '+' : ''}${String(Math.abs(hours)).padStart(2, '0')}:00`;
      }
    }
  } catch {
    // Fallback for environments that don't support shortOffset
  }
  
  // Default fallback
  return '+02:00';
}

/**
 * Prepend time context to a message string
 * @param message Original user message
 * @param timezone Timezone to use (default: Asia/Jerusalem)
 * @returns Message with time context prepended
 */
export function prependTimeContext(message: string, timezone: string = 'Asia/Jerusalem'): string {
  const timeContext = getTimeContextString(timezone);
  return `${timeContext}\n\n${message}`;
}

