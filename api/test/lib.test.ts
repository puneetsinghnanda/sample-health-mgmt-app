import { describe, expect, it } from 'vitest';
import { formatCode, idFromCode } from '../src/lib/codes';
import { availabilityProblem, isSlot, slotStarts, withinAvailability } from '../src/lib/slots';
import { dayBounds, isDay, isoWeekday, localDay, zonedToUtc } from '../src/lib/time';

const TZ = 'Asia/Kolkata';

describe('hospital time zone (NFR-2)', () => {
  it('maps local wall-clock times to UTC', () => {
    expect(zonedToUtc('2026-10-19', 9 * 60, TZ).toISOString()).toBe('2026-10-19T03:30:00.000Z');
    expect(zonedToUtc('2026-03-08', 9 * 60, 'America/New_York').toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('knows the local day of an instant and its bounds', () => {
    expect(localDay(new Date('2026-10-19T19:00:00Z'), TZ)).toBe('2026-10-20');
    expect(dayBounds('2026-10-20', TZ).start.toISOString()).toBe('2026-10-19T18:30:00.000Z');
  });

  it('validates days and weekdays', () => {
    expect(isDay('2026-02-30')).toBe(false);
    expect(isoWeekday('2026-10-19')).toBe(1);
    expect(isoWeekday('2026-10-25')).toBe(7);
  });
});

describe('slots (APT-2, DOC-7)', () => {
  const blocks = [
    { weekday: 1, start: '09:00', end: '10:00' },
    { weekday: 1, start: '14:00', end: '14:40' },
  ];

  it('APT-2: cuts each block into slots that end inside it', () => {
    expect(slotStarts(blocks, 1, 20)).toEqual([540, 560, 580, 840, 860]);
    expect(slotStarts(blocks, 2, 20)).toEqual([]);
  });

  it('APT-2: accepts only slot starts', () => {
    expect(isSlot(blocks, 20, new Date('2026-10-19T03:50:00Z'), TZ)).toBe(true);
    expect(isSlot(blocks, 20, new Date('2026-10-19T03:45:00Z'), TZ)).toBe(false);
  });

  it('DOC-7: tells whether an appointment still fits the availability', () => {
    const s = new Date('2026-10-19T08:30:00Z');
    expect(withinAvailability(blocks, s, new Date(s.getTime() + 40 * 60_000), TZ)).toBe(true);
    expect(withinAvailability(blocks, s, new Date(s.getTime() + 41 * 60_000), TZ)).toBe(false);
  });

  it('DOC-1: rejects overlapping or inverted blocks', () => {
    expect(availabilityProblem(blocks)).toBeNull();
    expect(availabilityProblem([...blocks, { weekday: 1, start: '09:30', end: '11:00' }])).toMatch(/overlap/);
    expect(availabilityProblem([{ weekday: 2, start: '11:00', end: '10:00' }])).toMatch(/before/);
  });
});

describe('display codes', () => {
  it('formats and parses D-, P- and A- codes', () => {
    expect(formatCode('D', 7)).toBe('D-0007');
    expect(formatCode('P', 42)).toBe('P-000042');
    expect(idFromCode('P', 'p-000042')).toBe(42);
    expect(idFromCode('P', 'Meera')).toBeNull();
  });
});
