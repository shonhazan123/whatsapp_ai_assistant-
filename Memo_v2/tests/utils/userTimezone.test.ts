import { describe, expect, it } from 'vitest';
import {
  buildDateTimeISOInZone,
  getDatePartsInTimezone,
  getEndOfDayInTimezone,
  getStartOfDayInTimezone,
  normalizeToISOWithOffset,
} from '../../src/utils/userTimezone.js';

describe('userTimezone', () => {
  describe('buildDateTimeISOInZone', () => {
    it('round-trips evening wall time in Asia/Jerusalem (regression: no bogus -21:00 offset)', () => {
      const iso = buildDateTimeISOInZone('2026-04-06', '20:05', 'Asia/Jerusalem');
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(iso));
      expect(p.year).toBe(2026);
      expect(p.month).toBe(4);
      expect(p.day).toBe(6);
      expect(p.hour).toBe(20);
      expect(p.minute).toBe(5);
      expect(p.second).toBe(0);
    });

    it('round-trips midnight local start of day', () => {
      const iso = buildDateTimeISOInZone('2026-01-15', '00:00', 'Asia/Jerusalem');
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(iso));
      expect(p.year).toBe(2026);
      expect(p.month).toBe(1);
      expect(p.day).toBe(15);
      expect(p.hour).toBe(0);
      expect(p.minute).toBe(0);
    });

    it('round-trips wall time in Europe/London', () => {
      const iso = buildDateTimeISOInZone('2026-06-15', '14:30', 'Europe/London');
      const p = getDatePartsInTimezone('Europe/London', new Date(iso));
      expect(p.year).toBe(2026);
      expect(p.month).toBe(6);
      expect(p.day).toBe(15);
      expect(p.hour).toBe(14);
      expect(p.minute).toBe(30);
    });

    it('supports seconds (end of day)', () => {
      const iso = buildDateTimeISOInZone('2026-03-01', '23:59:59', 'Asia/Jerusalem');
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(iso));
      expect(p.hour).toBe(23);
      expect(p.minute).toBe(59);
      expect(p.second).toBe(59);
    });
  });

  describe('normalizeToISOWithOffset', () => {
    it('normalizes datetime without offset using user zone', () => {
      const out = normalizeToISOWithOffset('2026-04-06T20:05', 'Asia/Jerusalem');
      expect(out.endsWith('Z')).toBe(true);
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(out));
      expect(p.day).toBe(6);
      expect(p.hour).toBe(20);
      expect(p.minute).toBe(5);
    });

    it('passes through values that already have Z', () => {
      const z = '2026-04-06T17:05:00.000Z';
      expect(normalizeToISOWithOffset(z, 'Asia/Jerusalem')).toBe(z);
    });
  });

  describe('getStartOfDayInTimezone / getEndOfDayInTimezone', () => {
    it('start of day is 00:00:00 local', () => {
      const anchor = new Date('2026-07-10T12:00:00Z');
      const start = getStartOfDayInTimezone('Asia/Jerusalem', anchor);
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(start));
      expect(p.hour).toBe(0);
      expect(p.minute).toBe(0);
      expect(p.second).toBe(0);
    });

    it('end of day is 23:59:59 local', () => {
      const anchor = new Date('2026-07-10T12:00:00Z');
      const end = getEndOfDayInTimezone('Asia/Jerusalem', anchor);
      const p = getDatePartsInTimezone('Asia/Jerusalem', new Date(end));
      expect(p.hour).toBe(23);
      expect(p.minute).toBe(59);
      expect(p.second).toBe(59);
    });
  });
});
