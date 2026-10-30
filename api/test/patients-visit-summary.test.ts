import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** Four weeks after MONDAY, also a Monday, so doctor 1 is available. */
const LATER_MONDAY = '2026-11-16';

/** HMS-5: the Visit summary on the patient page. Its own database, so no other test's state moves these counts. */
describe.skipIf(!pgAvailable())('patient visit summary (HMS-5)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  let emptyPatient: number;
  let missedOnlyPatient: number;
  let farApartPatient: number;
  const summary = async (id: number) => (await request(app).get(`/api/patients/${id}`)).body.visit_summary;
  const register = async (fullName: string, phone: string): Promise<number> =>
    (await request(app).post('/api/patients').send({ fullName, dateOfBirth: '1999-03-03', gender: 'OTHER', phone })).body.id;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    emptyPatient = await register('Test Patient Visit', '+91 00000 20009');
    missedOnlyPatient = await register('Test Patient Missed', '+91 00000 20010');
    farApartPatient = await register('Test Patient Far', '+91 00000 20011');
    // Patient 1, Monday: 09:00 No-show, 09:15 Completed, 09:30 Cancelled; Tuesday 10:00 stays Scheduled.
    const missed = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const seen = (await book(app, 1, 1, MONDAY, '09:15')).body.id;
    const called = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    await book(app, 1, 1, TUESDAY, '10:00');
    // Patient 2, Monday: 09:45 Completed.
    const other = (await book(app, 1, 2, MONDAY, '09:45')).body.id;
    // No-show-only patient, Monday 10:00. Far-apart patient: Monday 10:15 Completed, four weeks later No-show.
    const onlyMissed = (await book(app, 1, missedOnlyPatient, MONDAY, '10:00')).body.id;
    const farSeen = (await book(app, 1, farApartPatient, MONDAY, '10:15')).body.id;
    const farMissed = (await book(app, 1, farApartPatient, LATER_MONDAY, '09:00')).body.id;
    await request(app).post(`/api/appointments/${called}/cancel`).send({ reason: 'Patient requested' });
    clock = new Date(at(MONDAY, '10:20'));
    await request(app).post(`/api/appointments/${missed}/no-show`);
    await request(app).post(`/api/appointments/${seen}/complete`);
    await request(app).post(`/api/appointments/${other}/complete`);
    await request(app).post(`/api/appointments/${onlyMissed}/no-show`);
    await request(app).post(`/api/appointments/${farSeen}/complete`);
    clock = new Date(at(LATER_MONDAY, '09:20'));
    await request(app).post(`/api/appointments/${farMissed}/no-show`);
    // The checks run on Monday 09:50: the Tuesday appointment is upcoming, the Monday ones are past.
    clock = new Date(at(MONDAY, '09:50'));
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-5 REQ-2/REQ-3: shows the number of Completed and No-show appointments', async () => {
    expect(await summary(1)).toEqual({ completed: 1, no_show: 1 });
  });

  it('HMS-5 REQ-4/REQ-5: Scheduled and Cancelled appointments are counted in neither number', async () => {
    const res = await request(app).get('/api/patients/1');
    const statuses = res.body.appointments.map((a: { status: string }) => a.status).sort();
    expect(statuses).toEqual(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'SCHEDULED']);
    expect(res.body.visit_summary).toEqual({ completed: 1, no_show: 1 });
  });

  it('HMS-5 REQ-6 edge: a patient with no Completed or No-show appointments shows 0 for each', async () => {
    expect(await summary(emptyPatient)).toEqual({ completed: 0, no_show: 0 });
  });

  it('HMS-5 REQ-6 edge: a patient with Completed but no No-show appointments shows 0 No-shows', async () => {
    expect(await summary(2)).toEqual({ completed: 1, no_show: 0 });
  });

  it('HMS-5 REQ-6 edge: a patient with No-show but no Completed appointments shows 0 Completed', async () => {
    expect(await summary(missedOnlyPatient)).toEqual({ completed: 0, no_show: 1 });
  });

  it('HMS-5 REQ-2: each patient gets only their own counts', async () => {
    expect(await summary(1)).toEqual({ completed: 1, no_show: 1 });
    expect(await summary(2)).toEqual({ completed: 1, no_show: 0 });
    expect(await summary(missedOnlyPatient)).toEqual({ completed: 0, no_show: 1 });
  });

  it('HMS-5 REQ-9: closed appointments four weeks apart are both counted, with no date window', async () => {
    expect(await summary(farApartPatient)).toEqual({ completed: 1, no_show: 1 });
    const before = clock;
    clock = new Date(at(LATER_MONDAY, '11:00'));
    try {
      expect(await summary(farApartPatient)).toEqual({ completed: 1, no_show: 1 });
      expect(await summary(1)).toEqual({ completed: 1, no_show: 1 });
    } finally {
      clock = before;
    }
  });

  it('HMS-5 REQ-7: the appointments list keeps the same appointments in the same order, upcoming first', async () => {
    const res = await request(app).get('/api/patients/1');
    expect(res.body.appointments.map((a: { startsAt: string }) => a.startsAt)).toEqual([
      at(TUESDAY, '10:00'),
      at(MONDAY, '09:30'),
      at(MONDAY, '09:15'),
      at(MONDAY, '09:00'),
    ]);
  });

  it('HMS-5 REQ-8: medical history is returned as before; visit_summary holds only the two counts', async () => {
    const res = await request(app).get('/api/patients/1');
    expect(res.body.medicalHistory.allergies).toEqual(['Penicillin']);
    expect(Object.keys(res.body.visit_summary).sort()).toEqual(['completed', 'no_show']);
  });

  it('HMS-5 error: an unknown patient is still 404 with no visit summary', async () => {
    const res = await request(app).get('/api/patients/999');
    expect(res.status).toBe(404);
    expect(res.body.visit_summary).toBeUndefined();
  });

  it('HMS-5 error: a visit_summary sent in an edit is ignored while the real edit applies', async () => {
    const res = await request(app)
      .patch('/api/patients/2')
      .send({ address: 'Invented Street 5', visit_summary: { completed: 99, no_show: 99 } });
    expect(res.status).toBe(200);
    expect(res.body.address).toBe('Invented Street 5');
    expect(res.body.visit_summary).toEqual({ completed: 1, no_show: 0 });
    expect(await summary(2)).toEqual({ completed: 1, no_show: 0 });
  });
});
