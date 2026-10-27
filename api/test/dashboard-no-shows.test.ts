import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** HMS-3: the No-shows tile. Its own database, so no other test's state moves these counts. */
describe.skipIf(!pgAvailable())('dashboard No-shows (HMS-3)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const dashboard = async (period?: string) =>
    (await request(app).get(`/api/dashboard${period ? `?period=${period}` : ''}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Today (Monday): 09:00 No-show, 09:15 completed. Tomorrow: 10:00 scheduled.
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

  it('HMS-3 REQ-2/REQ-4: counts a No-show that starts in the selected period', async () => {
    expect((await dashboard()).totals.noShows).toBe(1);
  });

  it('HMS-3 REQ-8: a No-show leaves the Completed, Cancelled and upcoming counts as they are', async () => {
    expect((await dashboard()).totals).toMatchObject({ completed: 1, cancelled: 0, upcoming: 1, noShows: 1 });
  });

  it('HMS-3 REQ-6/REQ-7: the tile’s No-show list for the period holds exactly the counted appointments', async () => {
    for (const period of ['today', '7d', '30d']) {
      const d = await dashboard(period);
      const list = await request(app).get(`/api/appointments?status=NO_SHOW&from=${d.period.from}&to=${d.period.to}`);
      expect(list.body.total).toBe(d.totals.noShows);
    }
  });

  it('HMS-3 REQ-5 edge: the next day’s Today excludes Monday’s No-show; Last 7 and 30 days include it', async () => {
    const before = clock;
    clock = new Date(at(TUESDAY, '09:00'));
    try {
      expect((await dashboard()).totals.noShows).toBe(0);
      expect((await dashboard('7d')).totals.noShows).toBe(1);
      expect((await dashboard('30d')).totals.noShows).toBe(1);
    } finally {
      clock = before;
    }
  });

  it('HMS-3 REQ-3 error: an unknown period is still rejected', async () => {
    const res = await request(app).get('/api/dashboard?period=year');
    expect(res.status).toBe(400);
  });

  it('HMS-3 REQ-9/REQ-10: with a No-show counted, the dashboard carries no contact details or medical history', async () => {
    const text = JSON.stringify(await dashboard());
    expect(text).not.toMatch(/phone|email|allerg|medical|Penicillin/i);
  });
});
