import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

/** The fixture week after MONDAY (2026-10-19): Wednesday to Friday. */
const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';
const FRIDAY = '2026-10-23';

/** Local HH:MM of the 15-minute slots from 09:00 to 11:45 (doctor 1's fixture availability). */
const MORNING = Array.from({ length: 12 }, (_, i) => {
  const m = 9 * 60 + 15 * i;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

describe.skipIf(!pgAvailable())('appointment fits its doctor, edges (HMS-13)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-13 REQ-4 (S-1 AC4): the 51st upcoming appointment is flagged although the doctor page caps its list at 50', async () => {
    const ids: number[] = [];
    for (const day of [MONDAY, TUESDAY, WEDNESDAY, THURSDAY]) {
      for (const hhmm of MORNING) ids.push((await book(app, 1, 1, day, hhmm)).body.id);
    }
    for (const hhmm of ['09:00', '09:15', '09:30']) ids.push((await book(app, 1, 1, FRIDAY, hhmm)).body.id);
    expect(ids).toHaveLength(51);
    const fiftyFirst = ids[50]!;
    // Friday keeps only 09:00 to 09:30, so the 51st (Friday 09:30) falls outside; the first 50 stay inside.
    await request(app).put('/api/doctors/1/availability').send({
      availability: [
        ...[1, 2, 3, 4].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
        { weekday: 5, start: '09:00', end: '09:30' },
      ],
    });
    expect((await request(app).get(`/api/appointments/${fiftyFirst}`)).body.outsideAvailability).toBe(true);
    expect((await request(app).get(`/api/appointments/${ids[49]}`)).body.outsideAvailability).toBe(false);
    expect((await request(app).get('/api/doctors/1')).body.outsideAvailability).not.toContain(fiftyFirst);
  });

  it('HMS-13 REQ-2 (S-1 AC5): availability is judged on the hospital-local weekday across UTC midnight', async () => {
    const doc = await request(app).post('/api/doctors').send({
      fullName: 'Dr. Test Doctor Three', specializationId: 1, departmentId: 1, phone: '+91 00000 10003',
      feePaise: 30000, slotMinutes: 30, availability: [{ weekday: 2, start: '01:00', end: '01:30' }],
    });
    expect(doc.status).toBe(201);
    // Tuesday 01:00 in Asia/Kolkata (UTC+05:30) is Monday 19:30 UTC.
    const appt = (await book(app, doc.body.id, 2, TUESDAY, '01:00')).body;
    expect(appt.startsAt).toBe('2026-10-19T19:30:00.000Z');
    expect(appt.outsideAvailability).toBe(false);
    // Only a Monday 19:00 to 20:00 block remains: the UTC weekday would fit, the local weekday (Tuesday) does not.
    await request(app).put(`/api/doctors/${doc.body.id}/availability`).send({ availability: [{ weekday: 1, start: '19:00', end: '20:00' }] });
    expect((await request(app).get(`/api/appointments/${appt.id}`)).body.outsideAvailability).toBe(true);
  });

  it('HMS-13 REQ-3 edge: the flag holds at the exact start instant and clears one minute after', async () => {
    const appt = (await request(app).get('/api/appointments?doctorId=3')).body.items[0];
    const atStart = testApp(db.pool, () => new Date(appt.startsAt));
    const oneMinuteLater = testApp(db.pool, () => new Date(new Date(appt.startsAt).getTime() + 60_000));
    expect((await request(atStart).get(`/api/appointments/${appt.id}`)).body.outsideAvailability).toBe(true);
    expect((await request(oneMinuteLater).get(`/api/appointments/${appt.id}`)).body.outsideAvailability).toBe(false);
  });

  it('HMS-13 REQ-8 (S-4 AC2/AC3): Completed and No-show appointments of an Inactive doctor carry no availability flag', async () => {
    // Patient 1 already holds Monday 09:00 with doctor 1 (first test), so both use patient 2.
    const seen = (await book(app, 2, 2, MONDAY, '09:00')).body.id;
    const missed = (await book(app, 2, 2, MONDAY, '09:30')).body.id;
    const started = testApp(db.pool, () => new Date(at(MONDAY, '10:30')));
    expect((await request(started).post(`/api/appointments/${seen}/complete`)).body).toMatchObject({ status: 'COMPLETED', outsideAvailability: false });
    expect((await request(started).post(`/api/appointments/${missed}/no-show`)).body).toMatchObject({ status: 'NO_SHOW', outsideAvailability: false });
    await request(app).put('/api/doctors/2/availability').send({ availability: [{ weekday: 3, start: '09:00', end: '10:00' }] });
    await request(app).patch('/api/doctors/2').send({ status: 'INACTIVE' });
    for (const id of [seen, missed]) {
      expect((await request(app).get(`/api/appointments/${id}`)).body).toMatchObject({ doctorStatus: 'INACTIVE', outsideAvailability: false });
    }
  });

  it('HMS-13 REQ-1 error: an unknown appointment is still 404', async () => {
    const res = await request(app).get('/api/appointments/999999');
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty('doctorStatus');
  });
});
