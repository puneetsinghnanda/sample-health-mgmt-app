/**
 * Hospital-local calendar helpers (PRD NFR-2). Times are stored in UTC; availability, slots and "today"
 * are reasoned about in the hospital's IANA time zone.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MINUTE = 60_000;
export const DAY_MS = 24 * 60 * MINUTE;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** True for a real calendar date in YYYY-MM-DD form. */
export function isDay(value: string): boolean {
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** "HH:MM" to minutes after midnight, or null. */
export function parseHhmm(value: string): number | null {
  const m = HHMM_RE.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatHhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

interface LocalParts {
  day: string;
  minutes: number;
}

/** The hospital-local calendar day and minute of an instant. */
export function localParts(instant: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** The hospital-local date (YYYY-MM-DD) of an instant. */
export function localDay(instant: Date, tz: string): string {
  return localParts(instant, tz).day;
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (positive east of UTC). */
function offsetMs(instant: Date, tz: string): number {
  const { day, minutes } = localParts(instant, tz);
  const asUtc = Date.parse(`${day}T00:00:00Z`) + minutes * MINUTE;
  const truncated = Math.floor(instant.getTime() / MINUTE) * MINUTE;
  return asUtc - truncated;
}

/** The UTC instant of a hospital-local wall-clock time on a hospital-local day. */
export function zonedToUtc(day: string, minutes: number, tz: string): Date {
  const guess = Date.parse(`${day}T00:00:00Z`) + minutes * MINUTE;
  let result = guess - offsetMs(new Date(guess), tz);
  // A second pass settles days where the offset changes (daylight saving zones).
  result = guess - offsetMs(new Date(result), tz);
  return new Date(result);
}

/** ISO weekday of a calendar day: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The calendar day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** [start, end) of a hospital-local day as UTC instants. */
export function dayBounds(day: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(day, 0, tz), end: zonedToUtc(addDays(day, 1), 0, tz) };
}
