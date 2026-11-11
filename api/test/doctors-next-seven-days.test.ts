import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** HMS-9: regression tests the design and threat model ask implement for (T-1, T-4, T-6, T-7). */
describe.skipIf(!pgAvailable())('doctor next 7 days (HMS-9)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    await book(app, 1, 1, MONDAY, '10:00');
    await book(app, 1, 2, TUESDAY, '10:00');
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-9 REQ-4: each day counts exactly the BOOKED and FREE slots the day schedule shows', async () => {
    const d = (await request(app).get('/api/doctors/1')).body;
    expect(d.nextSevenDays).toHaveLength(7);
    for (const n of d.nextSevenDays) {
      const day = (await request(app).get(`/api/doctors/1/slots?date=${n.date}`)).body;
      const states: string[] = day.slots.map((s: { state: string }) => s.state);
      expect(n.available).toBe(states.length > 0);
      expect(n.booked).toBe(n.available ? states.filter((s) => s === 'BOOKED').length : null);
      expect(n.free).toBe(n.available ? states.filter((s) => s === 'FREE').length : null);
    }
  });

  it('HMS-9 REQ-3 (T-1): each entry carries only date, available, booked and free', async () => {
    const d = (await request(app).get('/api/doctors/1')).body;
    for (const n of d.nextSevenDays) {
      expect(Object.keys(n).sort()).toEqual(['available', 'booked', 'date', 'free']);
    }
  });

  it('HMS-9 REQ-2 (T-7): days follow the hospital zone across UTC midnight', async () => {
    const before = clock;
    try {
      // 2026-11-11T19:00Z is 00:30 on 12 Nov in Asia/Kolkata (UTC+05:30): local today is 12 Nov, the UTC date is still 11 Nov.
      clock = new Date('2026-11-11T19:00:00Z');
      const d = (await request(app).get('/api/doctors/1')).body;
      expect(d.nextSevenDays.map((n: { date: string }) => n.date)).toEqual([
        '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18',
      ]);
    } finally {
      clock = before;
    }
  });

  it('HMS-9 REQ-10: nextSevenDays in a PATCH body is ignored', async () => {
    const before = (await request(app).get('/api/doctors/1')).body.nextSevenDays;
    const res = await request(app)
      .patch('/api/doctors/1')
      .send({ fullName: 'Dr. Test Doctor One', nextSevenDays: [{ date: MONDAY, available: true, booked: 99, free: 99 }] });
    expect(res.status).toBe(200);
    expect(res.body.nextSevenDays).toEqual(before);
  });
});
