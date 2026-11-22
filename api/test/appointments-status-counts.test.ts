import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

const WEDNESDAY = '2026-10-21';

/** HMS-30: per-status counts on the appointment list. Its own database, so other tests do not move the counts. */
describe.skipIf(!pgAvailable())('appointment list status counts (HMS-30)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const list = async (q: Record<string, string>) => request(app).get(`/api/appointments?${new URLSearchParams(q)}`);

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Doctor 1, Monday: 09:00 patient 1 No-show, 09:15 patient 2 Completed, 09:30 patient 1 Cancelled.
    const missed = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const seen = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    const dropped = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    // Doctor 1, Tuesday: 10:00 patient 1 and 11:45 (last slot of the day) patient 2, both Scheduled.
    await book(app, 1, 1, TUESDAY, '10:00');
    await book(app, 1, 2, TUESDAY, '11:45');
    // Doctor 1, Wednesday 09:00 patient 1 Scheduled: the day after a range ending Tuesday.
    await book(app, 1, 1, WEDNESDAY, '09:00');
    // Doctor 2, Monday 09:30 patient 2 Scheduled: another doctor in the same range.
    await book(app, 2, 2, MONDAY, '09:30');
    // Doctor 1, Wednesday 01:00 local = 19:30 UTC on Tuesday: local Wednesday, UTC Tuesday.
    // Outside availability, so written directly; the list filter only looks at starts_at.
    await db.pool.query(
      `INSERT INTO appointment (doctor_id, patient_id, starts_at, ends_at, reason, created_by, updated_by)
       VALUES (1, 1, $1, $2, 'Check-up', 'staff', 'staff')`,
      [at(WEDNESDAY, '01:00'), at(WEDNESDAY, '01:15')],
    );
    await request(app).post(`/api/appointments/${dropped}/cancel`).send({ reason: 'Test reason 001' });
    clock = new Date(at(MONDAY, '09:50'));
    await request(app).post(`/api/appointments/${missed}/no-show`);
    await request(app).post(`/api/appointments/${seen}/complete`);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-30 REQ-1/REQ-2/REQ-8: a doctor list returns one count per status that adds up to the total', async () => {
    const res = await list({ doctorId: '1', from: MONDAY, to: TUESDAY });
    expect(res.status).toBe(200);
    expect(res.body.status_counts).toEqual({ SCHEDULED: 2, COMPLETED: 1, CANCELLED: 1, NO_SHOW: 1 });
    expect(Object.keys(res.body.status_counts)).toEqual(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
    const sum = Object.values(res.body.status_counts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sum).toBe(res.body.total);
    expect(res.body.total).toBe(5);
  });

  it('HMS-30 REQ-5: the counts ignore the Status filter while the rows and total follow it', async () => {
    const res = await list({ doctorId: '1', from: MONDAY, to: TUESDAY, status: 'CANCELLED' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe('CANCELLED');
    expect(res.body.status_counts).toEqual({ SCHEDULED: 2, COMPLETED: 1, CANCELLED: 1, NO_SHOW: 1 });
  });

  it('HMS-30 REQ-4: the counts cover every page, not only the one returned', async () => {
    const page1 = await list({ doctorId: '1', from: MONDAY, to: TUESDAY });
    const page2 = await list({ doctorId: '1', from: MONDAY, to: TUESDAY, page: '2' });
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(0);
    expect(page2.body.status_counts).toEqual(page1.body.status_counts);
  });

  it('HMS-30 REQ-4 edge: the last local day of the range counts; local Wednesday 01:00 (UTC Tuesday) does not', async () => {
    const toTuesday = await list({ doctorId: '1', from: MONDAY, to: TUESDAY });
    // Tuesday 10:00 and 11:45 only; Wednesday 01:00 local is 19:30 UTC on Tuesday but is local Wednesday.
    expect(toTuesday.body.status_counts.SCHEDULED).toBe(2);
    const toWednesday = await list({ doctorId: '1', from: MONDAY, to: WEDNESDAY });
    expect(toWednesday.body.status_counts.SCHEDULED).toBe(4);
  });

  it('HMS-30 REQ-4/REQ-6: another doctor’s appointments are not counted, and empty statuses show 0', async () => {
    const res = await list({ doctorId: '2', from: MONDAY, to: TUESDAY });
    expect(res.body.status_counts).toEqual({ SCHEDULED: 1, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 });
    expect(res.body.total).toBe(1);
  });

  it('HMS-30 REQ-4: a patient list counts only that patient’s appointments', async () => {
    const p1 = await list({ patientId: '1', from: MONDAY, to: TUESDAY });
    expect(p1.body.status_counts).toEqual({ SCHEDULED: 1, COMPLETED: 0, CANCELLED: 1, NO_SHOW: 1 });
    const p2 = await list({ patientId: '2', from: MONDAY, to: TUESDAY });
    expect(p2.body.status_counts).toEqual({ SCHEDULED: 2, COMPLETED: 1, CANCELLED: 0, NO_SHOW: 0 });
  });

  it('HMS-30 REQ-6 edge: a list with no matches returns all four statuses as 0', async () => {
    const res = await list({ doctorId: '2', from: WEDNESDAY, to: WEDNESDAY });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.status_counts).toEqual({ SCHEDULED: 0, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 });
  });

  it('HMS-30 REQ-9/REQ-10: rows stay ordered by start time with the list envelope unchanged', async () => {
    const res = await list({ doctorId: '1' });
    expect(res.body.page).toBe(1);
    expect(res.body.page_size).toBe(20);
    const starts = (res.body.items as { startsAt: string }[]).map((a) => a.startsAt);
    expect(starts).toEqual([...starts].sort());
  });

  it('HMS-30 REQ-4/REQ-10 (S-2 AC1, S-4 AC2): 21 matches show 20 rows on page 1, the 21st on page 2, and the counts include it', async () => {
    const THURSDAY = '2026-10-22';
    const FRIDAY = '2026-10-23';
    // Doctor 1 has twelve 15-minute slots a day (09:00–12:00): all of Thursday, then Friday 09:00–11:00.
    const slots = (day: string, n: number) =>
      Array.from({ length: n }, (_, i) => {
        const m = 9 * 60 + i * 15;
        return [day, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`] as const;
      });
    const ids: number[] = [];
    for (const [day, hhmm] of [...slots(THURSDAY, 12), ...slots(FRIDAY, 9)]) {
      const res = await book(app, 1, 1, day, hhmm);
      expect(res.body.id).toBeTypeOf('number');
      ids.push(res.body.id);
    }
    // The 21st by start time (Friday 11:00) becomes a No-show.
    const before = clock;
    try {
      clock = new Date(at(FRIDAY, '11:10'));
      expect((await request(app).post(`/api/appointments/${ids[20]}/no-show`)).body.status).toBe('NO_SHOW');
    } finally {
      clock = before;
    }
    const range = { doctorId: '1', from: THURSDAY, to: FRIDAY };
    const page1 = await list(range);
    expect(page1.body.total).toBe(21);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items.map((a: { id: number }) => a.id)).not.toContain(ids[20]);
    expect(page1.body.status_counts).toEqual({ SCHEDULED: 20, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 1 });
    const page2 = await list({ ...range, page: '2' });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).toBe(ids[20]);
    expect(page2.body.items[0].status).toBe('NO_SHOW');
    expect(page2.body.status_counts).toEqual(page1.body.status_counts);
  });

  it('HMS-30 REQ-11 error: an invalid status filter is still rejected with a field error', async () => {
    const res = await list({ doctorId: '1', status: 'LATE' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('status');
    expect(res.body.status_counts).toBeUndefined();
  });
});
