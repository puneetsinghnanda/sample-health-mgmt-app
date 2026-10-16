import type { AppointmentStatus } from '../api/types';

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function weekdayName(isoWeekday: number): string {
  return WEEKDAYS[isoWeekday - 1] ?? `Day ${isoWeekday}`;
}

/** Paise to "₹500.00" (PRD: fees in INR, stored as integer paise). */
export function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "500" or "500.50" rupees to integer paise, or null when not a valid amount. */
export function toPaise(value: string): number | null {
  const t = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function dateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function time(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Today's date (YYYY-MM-DD) in the hospital's time zone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export const GENDER_LABEL: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Prefer not to say',
};
