import { addDays, dayBounds, localDay } from './time';

/** A run of whole hospital-local days ending today: the days as YYYY-MM-DD and [start, end) as UTC instants. */
export interface DayWindow {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

/**
 * The last `days` hospital-local days up to the end of today. This is the dashboard's period rule
 * (today, 7d, 30d), shared so the doctor page's No-shows count matches the dashboard tile (HMS-7 REQ-4).
 */
export function lastDays(now: Date, tz: string, days: number): DayWindow {
  const to = localDay(now, tz);
  const from = addDays(to, 1 - days);
  return { from, to, start: dayBounds(from, tz).start, end: dayBounds(to, tz).end };
}
