import type { AvailabilityBlock } from '../types';
import { isoWeekday, localParts, MINUTE, parseHhmm, zonedToUtc } from './time';

/**
 * Slot rules (PRD APT-1, APT-2, DOC-7). A doctor's day is cut into slots of `slotMinutes`, starting at the start
 * of each availability block; a slot must end within its block.
 */

/** Slot start minutes for one weekday, in order. */
export function slotStarts(blocks: AvailabilityBlock[], weekday: number, slotMinutes: number): number[] {
  const starts: number[] = [];
  for (const b of blocks.filter((x) => x.weekday === weekday)) {
    const from = parseHhmm(b.start) ?? 0;
    const to = parseHhmm(b.end) ?? 0;
    for (let m = from; m + slotMinutes <= to; m += slotMinutes) starts.push(m);
  }
  return starts.sort((a, b) => a - b);
}

/** True when an appointment starting at `start` is a slot of the doctor's weekly availability. */
export function isSlot(blocks: AvailabilityBlock[], slotMinutes: number, start: Date, tz: string): boolean {
  const { day, minutes } = localParts(start, tz);
  if (start.getTime() % MINUTE !== 0) return false;
  return slotStarts(blocks, isoWeekday(day), slotMinutes).includes(minutes);
}

/** True when [start, end) lies inside one availability block, whatever the slot grid (DOC-7). */
export function withinAvailability(blocks: AvailabilityBlock[], start: Date, end: Date, tz: string): boolean {
  const s = localParts(start, tz);
  const e = localParts(new Date(end.getTime() - MINUTE), tz);
  if (s.day !== e.day) return false;
  const wd = isoWeekday(s.day);
  return blocks.some(
    (b) => b.weekday === wd && (parseHhmm(b.start) ?? 0) <= s.minutes && e.minutes + 1 <= (parseHhmm(b.end) ?? 0),
  );
}

/** Slots of one hospital-local day as UTC instants. */
export function daySlots(blocks: AvailabilityBlock[], slotMinutes: number, day: string, tz: string): Array<{ start: Date; end: Date; label: string }> {
  return slotStarts(blocks, isoWeekday(day), slotMinutes).map((m) => {
    const start = zonedToUtc(day, m, tz);
    const label = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return { start, end: new Date(start.getTime() + slotMinutes * MINUTE), label };
  });
}

/** Blocks of one weekday must not overlap, and each must start before it ends. Returns an error message or null. */
export function availabilityProblem(blocks: AvailabilityBlock[]): string | null {
  for (const b of blocks) {
    if (!Number.isInteger(b.weekday) || b.weekday < 1 || b.weekday > 7) return 'weekday must be 1 (Monday) to 7 (Sunday)';
    const s = parseHhmm(b.start);
    const e = parseHhmm(b.end);
    if (s === null || e === null) return 'times must be HH:MM';
    if (s >= e) return 'each block must start before it ends';
  }
  for (let wd = 1; wd <= 7; wd++) {
    const day = blocks
      .filter((b) => b.weekday === wd)
      .map((b) => [parseHhmm(b.start)!, parseHhmm(b.end)!] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < day.length; i++) if (day[i]![0] < day[i - 1]![1]) return 'blocks on the same day must not overlap';
  }
  return null;
}
