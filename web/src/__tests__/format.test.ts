import { describe, expect, it } from 'vitest';
import { date, dateTime, rupees, todayIn, toPaise, weekdayName } from '../lib/format';

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

  it('HMS-26 REQ-8: date prints the local date only, on the local side of midnight', () => {
    // 20:00 UTC on 9 March is 01:30 on 10 March in Kolkata (UTC+05:30).
    expect(date('2026-03-09T20:00:00.000Z', 'Asia/Kolkata')).toMatch(/10 Mar 2026/);
    expect(date('2026-03-09T20:00:00.000Z', 'Asia/Kolkata')).not.toMatch(/:/);
    expect(date('2026-03-09T20:00:00.000Z', 'UTC')).toMatch(/09 Mar 2026/);
  });
});
