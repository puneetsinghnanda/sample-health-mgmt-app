import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

type NextDay = { date: string; available: boolean; booked: number | null; free: number | null };

/**
 * HMS-9: edge cases of nextSevenDays on the doctor detail. Doctor 2 has 30-minute slots on Monday 09:00–10:00 only,
 * so each week has one day with two slots and six days with none. Its own database and clock.
 */
describe.skipIf(!pgAvailable())('doctor next 7 days, edge cases (HMS-9)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const week = async (id: number): Promise<NextDay[] | null> => (await request(app).get(`/api/doctors/${id}`)).body.nextSevenDays;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-9 REQ-2/REQ-3: rows run from today to 6 days ahead with date, booked and free', async () => {
    const days = (await week(2))!;
    expect(days.map((n) => n.date)).toEqual([
      MONDAY, TUESDAY, '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(days[0]).toEqual({ date: MONDAY, available: true, booked: 0, free: 2 });
  });

  it('HMS-9 REQ-5: a day without slots is not available and has no counts', async () => {
    const days = (await week(2))!;
    for (const n of days.slice(1)) expect(n).toEqual({ date: n.date, available: false, booked: null, free: null });
  });

  it('HMS-9 REQ-4: a Scheduled appointment counts as booked, not free', async () => {
    expect((await book(app, 2, 1, MONDAY, '09:00')).status).toBe(201);
    expect((await week(2))![0]).toMatchObject({ booked: 1, free: 1 });
  });

  it('HMS-9 REQ-4/REQ-6: after both slots start, the booked one stays booked and the empty one counts as neither', async () => {
    const before = clock;
    try {
      clock = new Date(at(MONDAY, '09:45'));
      expect((await week(2))![0]).toEqual({ date: MONDAY, available: true, booked: 1, free: 0 });
    } finally {
      clock = before;
    }
  });

  it('HMS-9 REQ-4 edge: a Cancelled appointment frees its slot again', async () => {
    const appt = (await book(app, 1, 2, TUESDAY, '11:00')).body;
    const tuesday = (d: NextDay[] | null) => d!.find((n) => n.date === TUESDAY)!;
    const booked = tuesday(await week(1));
    await request(app).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'Test cancellation' });
    const after = tuesday(await week(1));
    expect(after.booked).toBe(booked.booked! - 1);
    expect(after.free).toBe(booked.free! + 1);
  });

  it('HMS-9 REQ-4 (S-1 AC3, S-2 AC2): passed slots with a Completed or No-show appointment count as booked; a future slot stays free', async () => {
    // Doctor 1 has 15-minute slots 09:00–12:00 on weekdays: 09:00 Completed, 09:15 No-show, 09:30 onwards still to come.
    const wednesday = '2026-10-21';
    const seen = (await book(app, 1, 1, wednesday, '09:00')).body.id;
    const missed = (await book(app, 1, 2, wednesday, '09:15')).body.id;
    const before = clock;
    try {
      clock = new Date(at(wednesday, '09:20'));
      expect((await request(app).post(`/api/appointments/${seen}/complete`)).status).toBe(200);
      expect((await request(app).post(`/api/appointments/${missed}/no-show`)).status).toBe(200);
      const today = (await week(1))![0]!;
      const day = (await request(app).get(`/api/doctors/1/slots?date=${wednesday}`)).body;
      const free = day.slots.filter((s: { state: string }) => s.state === 'FREE').length;
      expect(free).toBeGreaterThan(0);
      expect(today).toEqual({ date: wednesday, available: true, booked: 2, free });
    } finally {
      clock = before;
    }
  });

  it('HMS-9 REQ-6 (S-2 AC3): a day whose slots have all passed empty shows booked 0 and free 0, still available', async () => {
    const thursday = '2026-10-22';
    const before = clock;
    try {
      clock = new Date(at(thursday, '18:00'));
      expect((await week(1))![0]).toEqual({ date: thursday, available: true, booked: 0, free: 0 });
    } finally {
      clock = before;
    }
  });

  it('HMS-9 REQ-9: an Inactive doctor has nextSevenDays null', async () => {
    expect((await request(app).patch('/api/doctors/2').send({ status: 'INACTIVE' })).status).toBe(200);
    expect(await week(2)).toBeNull();
  });

  it('HMS-9 REQ-10 error: an unknown doctor is still 404', async () => {
    expect((await request(app).get('/api/doctors/9999')).status).toBe(404);
  });
});
