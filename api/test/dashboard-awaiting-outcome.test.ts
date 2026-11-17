import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** Saturday 1 August 2026: outside Last 30 days of Monday 19 October 2026 (S-2, S-3). */
const AUGUST_1 = '2026-08-01';
/** The day before, when the 1 August appointment can still be booked and has not started. */
const JULY_31 = '2026-07-31';

/** HMS-21: the Awaiting outcome tile and the list behind it. Its own database, so no other test moves these counts. */
describe.skipIf(!pgAvailable())('dashboard Awaiting outcome (HMS-21)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const ids: Record<string, number> = {};
  const dashboard = async (period?: string) =>
    (await request(app).get(`/api/dashboard${period ? `?period=${period}` : ''}`)).body;
  const awaitingList = () => request(app).get('/api/appointments?status=SCHEDULED&started=true');
  const withClock = async (instant: string, fn: () => Promise<void>): Promise<void> => {
    const before = clock;
    clock = new Date(instant);
    try {
      await fn();
    } finally {
      clock = before;
    }
  };

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // 31 July: give doctor 2 a Saturday block and book Saturday 1 August 09:00, which stays Scheduled.
    clock = new Date(at(JULY_31, '09:00'));
    const avail = await request(app).put('/api/doctors/2/availability').send({
      availability: [{ weekday: 1, start: '09:00', end: '10:00' }, { weekday: 6, start: '09:00', end: '10:00' }],
    });
    if (avail.status !== 200) throw new Error(`availability: ${avail.status} ${JSON.stringify(avail.body)}`);
    const august = await book(app, 2, 2, AUGUST_1, '09:00');
    if (august.status !== 201) throw new Error(`1 August booking: ${august.status} ${JSON.stringify(august.body)}`);
    ids.august = august.body.id;
    clock = NOW;
    // Monday: 09:00 stays Scheduled, 09:15 Completed, 09:30 No-show, 09:45 Cancelled,
    // 10:00 Scheduled (exactly now), 10:30 Scheduled (later today). Tuesday 10:00 Scheduled.
    ids.open = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    ids.seen = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    ids.missed = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    ids.cancelled = (await book(app, 1, 2, MONDAY, '09:45')).body.id;
    ids.atNow = (await book(app, 1, 1, MONDAY, '10:00')).body.id;
    ids.later = (await book(app, 1, 2, MONDAY, '10:30')).body.id;
    ids.tomorrow = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    await request(app).post(`/api/appointments/${ids.cancelled}/cancel`).send({ reason: 'Patient request' });
    clock = new Date(at(MONDAY, '10:00'));
    await request(app).post(`/api/appointments/${ids.seen}/complete`);
    await request(app).post(`/api/appointments/${ids.missed}/no-show`);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-21 REQ-2/REQ-3/REQ-4: counts only Scheduled appointments that started strictly before now', async () => {
    // 1 August and Monday 09:00 count; Completed, No-show and Cancelled do not; 10:00 (exactly now) and 10:30 have not started.
    expect((await dashboard()).totals.awaitingOutcome).toBe(2);
  });

  it('HMS-21 REQ-5 (S-2 AC1): with one appointment outside Last 30 days, the count is 2 for every period', async () => {
    for (const period of ['today', '7d', '30d']) {
      const d = await dashboard(period);
      expect(d.period.from > AUGUST_1).toBe(true);
      expect(d.totals.awaitingOutcome).toBe(2);
    }
  });

  it('HMS-21 REQ-5 edge: on the next day, Monday’s open appointments still count, whatever the period', async () => {
    await withClock(at(TUESDAY, '09:00'), async () => {
      for (const period of ['today', '7d', '30d']) {
        expect((await dashboard(period)).totals.awaitingOutcome).toBe(4);
      }
    });
  });

  it('HMS-21 REQ-7 / S-3 AC3 edge: before any appointment has started the count is 0 and its list is empty', async () => {
    await withClock(at(JULY_31, '10:00'), async () => {
      expect((await dashboard()).totals.awaitingOutcome).toBe(0);
      const list = await awaitingList();
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(0);
      expect(list.body.items).toEqual([]);
    });
  });

  it('HMS-21 REQ-6 (S-3 AC2): the tile’s list holds exactly the counted appointments, including 1 August', async () => {
    const d = await dashboard();
    const list = await awaitingList();
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(d.totals.awaitingOutcome);
    expect(list.body.items.map((a: { id: number }) => a.id)).toEqual([ids.august, ids.open]);
  });

  it('HMS-21 REQ-6 edge: the list applies the same strict before-now rule on the next day', async () => {
    await withClock(at(TUESDAY, '09:00'), async () => {
      const list = await awaitingList();
      expect(list.body.items.map((a: { id: number }) => a.id)).toEqual([ids.august, ids.open, ids.atNow, ids.later]);
      expect(list.body.total).toBe((await dashboard()).totals.awaitingOutcome);
    });
  });

  it('HMS-21 REQ-6 edge: without started the list is unchanged and includes appointments not yet started', async () => {
    const list = await request(app).get('/api/appointments?status=SCHEDULED');
    expect(list.body.total).toBe(5);
  });

  it('HMS-21 REQ-6 edge: an empty started value is treated as absent', async () => {
    const list = await request(app).get('/api/appointments?status=SCHEDULED&started=');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(5);
  });

  it('HMS-21 REQ-6 error: any started value other than true is a 400 field error', async () => {
    for (const value of ['false', 'yes', '1']) {
      const res = await request(app).get(`/api/appointments?started=${value}`);
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toHaveProperty('started');
    }
  });

  it('HMS-21 REQ-8/REQ-9: the other totals and the next list are unchanged', async () => {
    const d = await dashboard();
    expect(d.totals).toMatchObject({ upcoming: 2, completed: 1, cancelled: 1, noShows: 1 });
    expect(d.next.map((a: { id: number }) => a.id)).toEqual([ids.later, ids.tomorrow]);
  });

  it('HMS-21 REQ-10/REQ-11: neither the dashboard nor the tile’s list carries contact details or medical history', async () => {
    expect(JSON.stringify(await dashboard())).not.toMatch(/phone|email|allerg|medical|Penicillin/i);
    expect(JSON.stringify((await awaitingList()).body)).not.toMatch(/phone|email|allerg|medical|Penicillin/i);
  });

  // Runs last: it records an outcome, which changes the counts the tests above assert.
  it('HMS-21 REQ-2 (S-1 AC5): recording an outcome for an awaiting appointment drops the count by one', async () => {
    expect((await dashboard()).totals.awaitingOutcome).toBe(2);
    const done = await request(app).post(`/api/appointments/${ids.open}/complete`);
    expect(done.status).toBe(200);
    expect((await dashboard()).totals.awaitingOutcome).toBe(1);
    expect((await awaitingList()).body.items.map((a: { id: number }) => a.id)).toEqual([ids.august]);
  });
});
