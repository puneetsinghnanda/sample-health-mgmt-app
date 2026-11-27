import { describe, expect, it } from 'vitest';
import { dateTime, rupees, STATUS_LABEL, todayIn, toPaise, weekdayName } from '../lib/format';

describe('formatting (INR, Asia/Kolkata)', () => {
  it('shows paise as rupees and parses rupees back to paise', () => {
    expect(rupees(50050)).toBe('₹500.50');
    expect(toPaise('500')).toBe(50000);
    expect(toPaise('500.5')).toBe(50050);
    expect(toPaise('5.555')).toBeNull();
    expect(toPaise('-1')).toBeNull();
  });

  it('shows times in the hospital time zone', () => {
    expect(dateTime('2026-10-19T03:30:00Z', 'Asia/Kolkata')).toMatch(/19 Oct 2026.*09:00/);
    expect(todayIn('Asia/Kolkata', new Date('2026-10-19T19:00:00Z'))).toBe('2026-10-20');
    expect(weekdayName(7)).toBe('Sunday');
  });

  it('HMS-34 REQ-1: labels the STALE status "Stale" and keeps the other labels', () => {
    expect(STATUS_LABEL.STALE).toBe('Stale');
    expect(STATUS_LABEL).toEqual({
      SCHEDULED: 'Scheduled', COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show', STALE: 'Stale',
    });
  });
});
