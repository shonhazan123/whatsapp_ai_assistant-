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
export function getTimeContextString(): string {
  const now = new Date();

  // Get Israel local time components with proper DST handling
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Jerusalem',
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

  // Get ISO-like format in Israel timezone
  const isoFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const isoLocal = isoFormatter.format(now).replace(' ', 'T');

  // Determine Israel timezone offset (UTC+2 standard, UTC+3 DST)
  const offset = getIsraelTimezoneOffset(now);

  // Format: readable date + ISO for precise parsing + day of week info
  // Include day index (0=Sunday, 1=Monday, etc.) for better day-of-week understanding
  const dayIndex = now.getDay();
  const dayInfo = `Day: ${dateParts.weekday} (${dayIndex})`;

  return `[Current time: ${dateParts.weekday}, ${dateParts.day}/${dateParts.month}/${dateParts.year} ${dateParts.hour}:${dateParts.minute} (${isoLocal}${offset}), ${dayInfo}, Timezone: Asia/Jerusalem]`;
}

/**
 * Get Israel timezone offset string (+02:00 or +03:00 depending on DST)
 * Uses a reliable method to determine the actual offset for the given date
 */
function getIsraelTimezoneOffset(date: Date): string {
  // Method 1: Try using Intl.DateTimeFormat with timeZoneName
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
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
  } catch (e) {
    // Fallback if the browser doesn't support shortOffset
  }

  // Method 2: Fallback - Compare times to calculate offset
  // Create a specific test date to avoid ambiguity
  const testDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);

  // Format in UTC and Israel time
  const utcStr = testDate.toLocaleString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const israelStr = testDate.toLocaleString('en-US', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  // Parse the hour from each string
  const utcHour = parseInt(utcStr.split(' ')[1].split(':')[0]);
  const israelHour = parseInt(israelStr.split(' ')[1].split(':')[0]);

  // Calculate offset
  let offset = israelHour - utcHour;

  // Handle day boundary
  if (offset < 0) {
    offset += 24;
  }

  // Israel is UTC+2 (standard) or UTC+3 (DST)
  return `${offset >= 0 ? '+' : ''}${String(offset).padStart(2, '0')}:00`;
}

/**
 * Prepend time context to a message string
 * @param message Original user message
 * @param timezone Timezone to use (default: Asia/Jerusalem)
 * @returns Message with time context prepended
 */
export function prependTimeContext(message: string, timezone: string = 'Asia/Jerusalem'): string {
  const timeContext = getTimeContextString();
  return `${timeContext}\n\n${message}`;
}

