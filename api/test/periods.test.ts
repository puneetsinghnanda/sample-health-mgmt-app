import { describe, expect, it } from 'vitest';
import { lastDays } from '../src/lib/periods';
import { dayBounds } from '../src/lib/time';
import { at, MONDAY, NOW } from './helpers';

const TZ = 'Asia/Kolkata';

/** HMS-7: the shared Last-N-days rule used by the dashboard and the doctor page. */
describe('lastDays (HMS-7)', () => {
  it('HMS-7 REQ-2/REQ-4: 30 days ends today and starts 29 days earlier, as the dashboard 30d period', () => {
    const w = lastDays(NOW, TZ, 30);
    expect(w).toMatchObject({ from: '2026-09-20', to: MONDAY });
    expect(w.start).toEqual(dayBounds('2026-09-20', TZ).start);
    expect(w.end).toEqual(dayBounds(MONDAY, TZ).end);
  });

  it('HMS-7 REQ-3: "today" is the hospital day, not the UTC day', () => {
    // 00:10 on Monday in Kolkata is still Sunday in UTC.
    const w = lastDays(new Date(at(MONDAY, '00:10')), TZ, 1);
    expect(w).toMatchObject({ from: MONDAY, to: MONDAY });
  });

  it('HMS-7 REQ-2 edge: 1 day is exactly today, as the dashboard Today period', () => {
    const w = lastDays(NOW, TZ, 1);
    expect(w).toMatchObject({ from: MONDAY, to: MONDAY });
    expect(w).toMatchObject(dayBounds(MONDAY, TZ));
  });
});
