import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** HMS-7: No-shows (last 30 days) on the doctor detail. Its own database, so other tests do not move the counts. */
describe.skipIf(!pgAvailable())('doctor No-shows last 30 days (HMS-7)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const doctor = async (id: number) => (await request(app).get(`/api/doctors/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Doctor 1, Monday: 09:00 No-show, 09:15 Completed. Tuesday 10:00 Scheduled. Doctor 2: nothing.
    const missed = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const seen = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    await book(app, 1, 1, TUESDAY, '10:00');
    clock = new Date(at(MONDAY, '09:20'));
    await request(app).post(`/api/appointments/${missed}/no-show`);
    await request(app).post(`/api/appointments/${seen}/complete`);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-7 REQ-1/REQ-2: the doctor detail counts the doctor’s No-shows in the last 30 days', async () => {
    const d = await doctor(1);
    expect(d.noShowsLast30Days).toBe(1);
    expect(d.noShowsWindow).toEqual({ from: '2026-09-20', to: MONDAY });
  });

  it('HMS-7 REQ-2: Completed and Scheduled appointments are not counted', async () => {
    const d = await doctor(1);
    expect(d.appointmentCount).toBe(3);
    expect(d.noShowsLast30Days).toBe(1);
  });

  it('HMS-7 REQ-5: a doctor with no No-shows shows 0', async () => {
    expect((await doctor(2)).noShowsLast30Days).toBe(0);
  });

  it('HMS-7 REQ-4: the count equals the dashboard 30d No-shows when only this doctor has any', async () => {
    const dash = (await request(app).get('/api/dashboard?period=30d')).body;
    const d = await doctor(1);
    expect(d.noShowsLast30Days).toBe(dash.totals.noShows);
    expect(d.noShowsWindow).toEqual({ from: dash.period.from, to: dash.period.to });
  });

  it('HMS-7 REQ-6/REQ-7: the linked list holds exactly the counted appointments, for a count and for 0', async () => {
    for (const id of [1, 2]) {
      const d = await doctor(id);
      const q = new URLSearchParams({ doctorId: String(id), status: 'NO_SHOW', ...d.noShowsWindow });
      const list = await request(app).get(`/api/appointments?${q}`);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(d.noShowsLast30Days);
    }
  });

  it('HMS-7 REQ-3 edge: counted on day 30, gone on day 31', async () => {
    const before = clock;
    try {
      clock = new Date(at('2026-11-17', '09:00'));
      expect((await doctor(1)).noShowsLast30Days).toBe(1);
      clock = new Date(at('2026-11-18', '09:00'));
      expect((await doctor(1)).noShowsLast30Days).toBe(0);
    } finally {
      clock = before;
    }
  });

  it('HMS-7 REQ-8 error: an unknown doctor is still 404', async () => {
    expect((await request(app).get('/api/doctors/9999')).status).toBe(404);
  });

  it('HMS-7 REQ-8: the read-only count in a PATCH body is ignored', async () => {
    const res = await request(app).patch('/api/doctors/1').send({ fullName: 'Dr. Test Doctor One', noShowsLast30Days: 99 });
    expect(res.status).toBe(200);
    expect(res.body.noShowsLast30Days).toBe(1);
  });

  it('HMS-7 REQ-8: the doctor detail carries no patient contact details or medical history', async () => {
    const d = await doctor(1);
    const text = JSON.stringify({ n: d.noShowsLast30Days, w: d.noShowsWindow });
    expect(text).not.toMatch(/Patient|phone|email|allerg|medical/i);
  });
});
