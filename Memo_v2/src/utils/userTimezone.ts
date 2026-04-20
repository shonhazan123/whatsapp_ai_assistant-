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

function matchesWallTime(
  p: ReturnType<typeof getDatePartsInTimezone>,
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number
): boolean {
  return (
    p.year === y &&
    p.month === mo &&
    p.day === d &&
    p.hour === h &&
    p.minute === mi &&
    p.second === s
  );
}

/**
 * Map a calendar date + wall clock in an IANA zone to the UTC instant, as ISO 8601 with Z.
 * Uses iterative correction on naive UTC ms, then minute/second fallback for DST edge cases.
 */
function wallTimeToUtcInstantMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string
): number {
  const targetNaiveUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = targetNaiveUtc;

  for (let i = 0; i < 80; i++) {
    const p = getDatePartsInTimezone(tz, new Date(t));
    if (matchesWallTime(p, y, mo, d, h, mi, s)) {
      return t;
    }
    const gotNaiveUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    t += targetNaiveUtc - gotNaiveUtc;
  }

  // Rare: non-convergence (e.g. nonexistent local time). Linear search ±48h by minute, then seconds.
  const windowMin = 48 * 60;
  for (let deltaMin = -windowMin; deltaMin <= windowMin; deltaMin++) {
    const guess = targetNaiveUtc + deltaMin * 60_000;
    const p = getDatePartsInTimezone(tz, new Date(guess));
    if (p.year !== y || p.month !== mo || p.day !== d || p.hour !== h || p.minute !== mi) continue;
    for (let ds = -60; ds <= 60; ds++) {
      const t2 = guess + ds * 1000;
      const p2 = getDatePartsInTimezone(tz, new Date(t2));
      if (matchesWallTime(p2, y, mo, d, h, mi, s)) return t2;
    }
  }

  throw new Error(
    `No UTC instant maps to local ${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')} in ${tz} (nonexistent wall time?)`
  );
}

/**
 * Build an ISO string for a given local date and time in a timezone.
 * Example: buildDateTimeISOInZone("2025-03-03", "17:00", "Asia/Jerusalem")
 *   -> UTC ISO instant, e.g. "2025-03-03T15:00:00.000Z" (same instant, unambiguous for Postgres timestamptz)
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

  const utcMs = wallTimeToUtcInstantMs(y, m, d, hour, minute, second, tz);
  return new Date(utcMs).toISOString();
}

/** ISO datetime string has explicit offset or Z (not server-ambiguous). */
function hasOffset(iso: string): boolean {
  return /[+-]\d{2}:\d{2}$/.test(iso) || iso.endsWith('Z');
}

/**
 * If the string is a datetime without offset, treat it as local in the given
 * timezone and return a UTC ISO string (Z). Otherwise return as-is.
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
