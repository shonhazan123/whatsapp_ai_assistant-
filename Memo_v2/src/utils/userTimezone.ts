/**
 * User-timezone utilities – single source of truth for "user local" time.
 *
 * All calendar and time logic must use these helpers with the user's timezone
 * from state (state.user.timezone / state.input.timezone). Never use server
 * local time (new Date().setHours etc.) for user-facing times.
 *
 * Uses Intl only; no extra dependencies.
 */

const DEFAULT_TZ = 'Asia/Jerusalem';

/**
 * Get date/time parts for an instant in a given timezone.
 */
export function getDatePartsInTimezone(
  timezone: string,
  date: Date = new Date()
): { year: number; month: number; day: number; dayOfWeek: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const dayOfWeek = ((): number => {
    const w = get('weekday');
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return map[w] ?? 0;
  })();
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    dayOfWeek,
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
  };
}

/**
 * Format offset in minutes as "+02:00" or "-05:30".
 */
function formatOffsetMinutes(offsetMin: number): string {
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Build an ISO string for a given local date and time in a timezone.
 * Example: buildDateTimeISOInZone("2025-03-03", "17:00", "Asia/Jerusalem")
 *   -> "2025-03-03T17:00:00+02:00"
 */
export function buildDateTimeISOInZone(
  dateStr: string,
  timeStr: string,
  timezone: string
): string {
  const tz = timezone || DEFAULT_TZ;
  const [y, m, d] = dateStr.split('-').map(Number);
  const timeParts = timeStr.split(':');
  const hour = parseInt(timeParts[0], 10);
  const minute = timeParts[1] ? parseInt(timeParts[1], 10) : 0;
  const second = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

  const trialUtc = Date.UTC(y, m - 1, d, hour, minute, second);
  const trialDate = new Date(trialUtc);
  const localParts = getDatePartsInTimezone(tz, trialDate);
  const desiredMin = hour * 60 + minute;
  const actualMin = localParts.hour * 60 + localParts.minute;
  const offsetMin = desiredMin - actualMin;
  const realUtc = trialUtc - offsetMin * 60 * 1000;
  const realDate = new Date(realUtc);
  const localAtReal = getDatePartsInTimezone(tz, realDate);
  const utcMin = realDate.getUTCHours() * 60 + realDate.getUTCMinutes();
  const localMinAtReal = localAtReal.hour * 60 + localAtReal.minute;
  const zoneOffsetMin = localMinAtReal - utcMin;
  const offsetStr = formatOffsetMinutes(zoneOffsetMin);

  const timePart = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return `${dateStr}T${timePart}${offsetStr}`;
}

/** ISO datetime string has explicit offset or Z (not server-ambiguous). */
function hasOffset(iso: string): boolean {
  return /[+-]\d{2}:\d{2}$/.test(iso) || iso.endsWith('Z');
}

/**
 * If the string is a datetime without offset, treat it as local in the given
 * timezone and return an ISO string with offset. Otherwise return as-is.
 */
export function normalizeToISOWithOffset(value: string, timezone: string): string {
  if (!value || typeof value !== 'string') return value;
  if (hasOffset(value)) return value;
  const tz = timezone || DEFAULT_TZ;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (dateOnly) return value;
  const m = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return value;
  const [, dateStr, h, min, sec] = m;
  const timeStr = sec ? `${h.padStart(2, '0')}:${min}:${sec}` : `${h.padStart(2, '0')}:${min}`;
  return buildDateTimeISOInZone(dateStr, timeStr, tz);
}

/**
 * Start of the given day (or "today" in zone) as ISO string in that timezone.
 */
export function getStartOfDayInTimezone(
  timezone: string,
  date: Date = new Date()
): string {
  const tz = timezone || DEFAULT_TZ;
  const p = getDatePartsInTimezone(tz, date);
  const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return buildDateTimeISOInZone(dateStr, '00:00', tz);
}

/**
 * End of the given day (or "today" in zone) as ISO string in that timezone (23:59:59).
 */
export function getEndOfDayInTimezone(
  timezone: string,
  date: Date = new Date()
): string {
  const tz = timezone || DEFAULT_TZ;
  const p = getDatePartsInTimezone(tz, date);
  const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return buildDateTimeISOInZone(dateStr, '23:59:59', tz);
}
