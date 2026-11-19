import { describe, expect, it } from 'vitest';
import { dateTime, localDate, rupees, todayIn, toPaise, weekdayName } from '../lib/format';

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

  it('HMS-24 REQ-8: localDate prints a hospital-local day as the table date without a time', () => {
    expect(localDate('2026-03-10')).toBe('10 Mar 2026');
    // The same style as dateTime's date part.
    expect(dateTime('2026-03-10T04:30:00Z', 'Asia/Kolkata').startsWith(localDate('2026-03-10'))).toBe(true);
  });

  it('HMS-24 REQ-8 edge: localDate never shifts the day, at year end or month start', () => {
    expect(localDate('2026-12-31')).toBe('31 Dec 2026');
    expect(localDate('2026-11-01')).toBe('01 Nov 2026');
  });
});
