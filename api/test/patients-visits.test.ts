import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const visitsOf = async (app: Express, patientId: number) =>
  (await request(app).get(`/api/patients/${patientId}`)).body.visits;

/** HMS-26: the patient detail carries next and last visit and the closed counts, over all appointments. */
describe.skipIf(!pgAvailable())('patient detail visits (HMS-26)', () => {
  let db: TestDb;
  let app: Express;
  /** Monday 09:40 in Kolkata: the 09:30 appointment has started and can be closed. */
  let afterNineThirty: Express;
  /** Monday 10:10 in Kolkata: the 10:00 appointment has started and can be closed. */
  let afterTen: Express;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    afterNineThirty = testApp(db.pool, () => new Date(at(MONDAY, '09:40')));
    afterTen = testApp(db.pool, () => new Date(at(MONDAY, '10:10')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-26 REQ-6, REQ-10, REQ-14: a patient with no appointments has no next, no last and three counts of 0', async () => {
    expect(await visitsOf(app, 2)).toEqual({ next: null, last: null, completed: 0, cancelled: 0, no_show: 0 });
  });

  it('HMS-26 REQ-3, REQ-4: next is the earliest Scheduled appointment after now, with its start and doctor name', async () => {
    ids.a = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    ids.b = (await book(app, 2, 1, MONDAY, '09:30')).body.id;
    ids.c = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    ids.d = (await book(app, 1, 1, TUESDAY, '09:00')).body.id;
    expect((await visitsOf(app, 1)).next).toEqual({ id: ids.a, starts_at: at(MONDAY, '09:00'), doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-26 REQ-3 edge: a Cancelled earlier appointment is skipped', async () => {
    const res = await request(app).post(`/api/appointments/${ids.a}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect((await visitsOf(app, 1)).next).toEqual({ id: ids.b, starts_at: at(MONDAY, '09:30'), doctor_name: 'Dr. Test Doctor Two' });
  });

  it('HMS-26 REQ-3 edge: a Scheduled appointment that already started is not next', async () => {
    expect((await visitsOf(afterNineThirty, 1)).next).toMatchObject({ id: ids.d, starts_at: at(TUESDAY, '09:00') });
  });

  it('HMS-26 REQ-7: last is the latest Completed appointment, not a later No-show', async () => {
    expect((await visitsOf(app, 1)).last).toBeNull();
    const done = await request(afterNineThirty).post(`/api/appointments/${ids.b}/complete`).send({});
    expect(done.body).toMatchObject({ status: 'COMPLETED' });
    ids.e = (await book(app, 1, 1, MONDAY, '10:00')).body.id;
    const missed = await request(afterTen).post(`/api/appointments/${ids.e}/no-show`).send({});
    expect(missed.body).toMatchObject({ status: 'NO_SHOW' });
    expect((await visitsOf(afterTen, 1)).last).toEqual({ id: ids.b, starts_at: at(MONDAY, '09:30'), doctor_name: 'Dr. Test Doctor Two' });
  });

  it('HMS-26 REQ-11: counts cover every date, including a future Cancelled one, and never count Scheduled', async () => {
    await request(app).post(`/api/appointments/${ids.c}/cancel`).send({ reason: 'Patient requested' });
    expect(await visitsOf(afterTen, 1)).toMatchObject({ completed: 1, cancelled: 2, no_show: 1 });
  });

  it('HMS-26 REQ-18: the appointment list is still returned alongside the visits', async () => {
    const body = (await request(app).get('/api/patients/1')).body;
    expect(body.appointments.map((a: { id: number }) => a.id)).toEqual(expect.arrayContaining([ids.a, ids.b, ids.c, ids.d, ids.e]));
    expect(body.medicalHistory).toMatchObject({ allergies: ['Penicillin'] });
  });

  it('HMS-26 error: an unknown patient is still 404', async () => {
    const res = await request(app).get('/api/patients/999');
    expect(res.status).toBe(404);
  });

  it('HMS-26 REQ-7 (S-2 AC1): of two Completed appointments with different doctors, the later one is last', async () => {
    /** Monday 11:10 in Kolkata: both appointments below have started and can be closed. */
    const afterEleven = testApp(db.pool, () => new Date(at(MONDAY, '11:10')));
    // Booked later-first, so the later visit has the lower id and an id order would pick the wrong one.
    ids.p = (await book(app, 1, 2, MONDAY, '11:00')).body.id;
    ids.q = (await book(app, 2, 2, MONDAY, '09:00')).body.id;
    for (const id of [ids.q, ids.p]) {
      expect((await request(afterEleven).post(`/api/appointments/${id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    }
    expect((await visitsOf(afterEleven, 2)).last).toEqual({ id: ids.p, starts_at: at(MONDAY, '11:00'), doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-26 REQ-7, REQ-11 edge (A-02): with more appointments than the capped list holds, last and counts still cover all', async () => {
    // 101 Cancelled appointments in the future sort first in the capped appointment list and push the
    // two Completed Monday visits out of it, so only queries over all appointments still find them.
    await db.pool.query(
      `INSERT INTO appointment (doctor_id, patient_id, starts_at, ends_at, status, cancellation_reason, created_by, updated_by)
       SELECT 1, 2, $1::timestamptz + n * interval '1 day', $1::timestamptz + n * interval '1 day' + interval '15 minutes',
              'CANCELLED', 'Test reason 001', 'staff', 'staff'
         FROM generate_series(1, 101) AS n`,
      [at(TUESDAY, '09:00')],
    );
    // Read after both Monday visits, so they are past and the 101 future rows fill the capped list first.
    const afterEleven = testApp(db.pool, () => new Date(at(MONDAY, '11:10')));
    const body = (await request(afterEleven).get('/api/patients/2')).body;
    expect(body.appointments).toHaveLength(100);
    expect(body.appointments.map((a: { id: number }) => a.id)).not.toContain(ids.p);
    expect(body.visits).toEqual({
      next: null,
      last: { id: ids.p, starts_at: at(MONDAY, '11:00'), doctor_name: 'Dr. Test Doctor One' },
      completed: 2,
      cancelled: 101,
      no_show: 0,
    });
  });
});
