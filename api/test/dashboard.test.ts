import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

describe.skipIf(!pgAvailable())('dashboard (PRD §4.4)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Today (Monday): 09:00 completed, 09:15 cancelled, 09:30 scheduled. Tomorrow: 10:00 scheduled.
    const a1 = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const a2 = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    await book(app, 1, 1, MONDAY, '09:30');
    await book(app, 1, 2, TUESDAY, '10:00');
    await request(app).post(`/api/appointments/${a2}/cancel`).send({ reason: 'Doctor unavailable' });
    clock = new Date(at(MONDAY, '09:20'));
    await request(app).post(`/api/appointments/${a1}/complete`);
    await request(app).patch('/api/patients/2').send({ status: 'INACTIVE' });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('DSH-1..6: counts patients, doctors and appointments by their definitions', async () => {
    const res = await request(app).get('/api/dashboard');
    expect(res.body.today).toBe(MONDAY);
    expect(res.body.totals).toEqual({
      patients: 1, // DSH-1: Active only
      doctors: 2, // DSH-2
      appointmentsToday: 2, // DSH-3: any status except Cancelled
      upcoming: 2, // DSH-4: Scheduled, after now
      completed: 1, // DSH-5
      cancelled: 1, // DSH-6
      noShows: 0, // HMS-3: none yet
    });
  });

  it('DSH-4: lists the next Scheduled appointments in time order', async () => {
    const next = (await request(app).get('/api/dashboard')).body.next;
    expect(next.map((a: { startsAt: string }) => a.startsAt)).toEqual([at(MONDAY, '09:30'), at(TUESDAY, '10:00')]);
  });

  it('DSH-7: the period is Today, Last 7 days or Last 30 days, default Today', async () => {
    expect((await request(app).get('/api/dashboard?period=7d')).body.period).toEqual({ name: '7d', from: '2026-10-13', to: MONDAY });
    expect((await request(app).get('/api/dashboard?period=30d')).body.period.from).toBe('2026-09-20');
    expect((await request(app).get('/api/dashboard?period=year')).status).toBe(400);
  });

  it('DSH-8: the cancelled tile’s list matches its count', async () => {
    const d = (await request(app).get('/api/dashboard?period=7d')).body;
    const list = await request(app).get(`/api/appointments?status=CANCELLED&from=${d.period.from}&to=${d.period.to}`);
    expect(list.body.total).toBe(d.totals.cancelled);
  });

  it('DSH-9: carries no contact details or medical history', async () => {
    const text = JSON.stringify((await request(app).get('/api/dashboard')).body);
    expect(text).not.toMatch(/phone|email|allerg|medical|Penicillin/i);
  });
});
