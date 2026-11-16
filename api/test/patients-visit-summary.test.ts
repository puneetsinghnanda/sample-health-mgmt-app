import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

const PATIENT_THREE = { fullName: 'Test Patient Three', dateOfBirth: '1979-03-09', gender: 'OTHER', phone: '+91 00000 20003' };
const PATIENT_FOUR = { fullName: 'Test Patient Four', dateOfBirth: '1995-07-21', gender: 'FEMALE', phone: '+91 00000 20004' };

/** HMS-5: Visit summary on the patient detail. Its own database, so other tests do not move the counts. */
describe.skipIf(!pgAvailable())('patient visit summary (HMS-5)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const patient = async (id: number) => (await request(app).get(`/api/patients/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    await request(app).post('/api/patients').send(PATIENT_THREE);
    // Patient 1, doctor 1: Monday 09:00 and 09:15 Completed, 09:30 No-show, 09:45 left Scheduled,
    // Tuesday 10:00 Cancelled (the latest start of all).
    const seenA = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const seenB = (await book(app, 1, 1, MONDAY, '09:15')).body.id;
    const missed = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    await book(app, 1, 1, MONDAY, '09:45');
    const calledOff = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    // Patient 2: one Completed. Patient 3: one Scheduled and one Cancelled only.
    const other = (await book(app, 1, 2, MONDAY, '10:00')).body.id;
    await book(app, 1, 3, MONDAY, '10:15');
    const calledOffThree = (await book(app, 1, 3, TUESDAY, '10:15')).body.id;
    await request(app).post(`/api/appointments/${calledOff}/cancel`).send({ reason: 'Test reason' });
    await request(app).post(`/api/appointments/${calledOffThree}/cancel`).send({ reason: 'Test reason' });
    clock = new Date(at(MONDAY, '10:30'));
    await request(app).post(`/api/appointments/${seenA}/complete`);
    await request(app).post(`/api/appointments/${seenB}/complete`);
    await request(app).post(`/api/appointments/${missed}/no-show`);
    await request(app).post(`/api/appointments/${other}/complete`);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-5 REQ-2/REQ-3: the patient detail counts Completed and No-show appointments (S-1 AC1)', async () => {
    const res = await request(app).get('/api/patients/1');
    expect(res.status).toBe(200);
    expect(res.body.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-2/REQ-3: the summary holds exactly two integer counts', async () => {
    const summary = (await patient(1)).visitSummary;
    expect(Object.keys(summary).sort()).toEqual(['completed', 'noShow']);
    expect(Number.isInteger(summary.completed)).toBe(true);
    expect(Number.isInteger(summary.noShow)).toBe(true);
  });

  it('HMS-5 REQ-4 edge: a Cancelled appointment with the latest start is not counted (S-2 AC1)', async () => {
    const p = await patient(1);
    const statuses = p.appointments.map((a: { status: string }) => a.status);
    expect(statuses.filter((s: string) => s === 'CANCELLED')).toHaveLength(1);
    const latest = [...p.appointments].sort(
      (a: { startsAt: string }, b: { startsAt: string }) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime(),
    )[0];
    expect(latest.status).toBe('CANCELLED');
    expect(p.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-4 edge: a past appointment that is still Scheduled counts as neither (S-2 AC4)', async () => {
    const p = await patient(1);
    const open = p.appointments.filter((a: { status: string }) => a.status === 'SCHEDULED');
    expect(open).toHaveLength(1);
    expect(new Date(open[0].startsAt).getTime()).toBeLessThan(clock.getTime());
    expect(p.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it("HMS-5 REQ-2 edge: another patient's appointments are not counted (S-1 AC5)", async () => {
    expect((await patient(2)).visitSummary).toEqual({ completed: 1, noShow: 0 });
  });

  it('HMS-5 REQ-4/REQ-5: a patient with only Scheduled and Cancelled appointments shows 0 for each (S-2 AC2)', async () => {
    const p = await patient(3);
    expect(p.appointments.map((a: { status: string }) => a.status).sort()).toEqual(['CANCELLED', 'SCHEDULED']);
    expect(p.visitSummary).toEqual({ completed: 0, noShow: 0 });
  });

  it('HMS-5 REQ-6: the counts cover all time, also long after the appointments (S-1 AC3)', async () => {
    const before = clock;
    try {
      clock = new Date(at('2027-06-01', '09:00'));
      expect((await patient(1)).visitSummary).toEqual({ completed: 2, noShow: 1 });
    } finally {
      clock = before;
    }
  });

  it('HMS-5 REQ-5: a new patient has 0 for each, in the POST response and in the detail (S-2 AC3)', async () => {
    const created = await request(app).post('/api/patients').send(PATIENT_FOUR);
    expect(created.status).toBe(201);
    expect(created.body.visitSummary).toEqual({ completed: 0, noShow: 0 });
    expect((await patient(created.body.id)).visitSummary).toEqual({ completed: 0, noShow: 0 });
  });

  it('HMS-5 REQ-1: the PATCH response carries the counts', async () => {
    const res = await request(app).patch('/api/patients/1').send({ address: 'Invented Street 5' });
    expect(res.status).toBe(200);
    expect(res.body.address).toBe('Invented Street 5');
    expect(res.body.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-1 edge: a visitSummary sent in a PATCH body is ignored', async () => {
    const res = await request(app).patch('/api/patients/1').send({ address: 'Invented Street 6', visitSummary: { completed: 99, noShow: 99 } });
    expect(res.body.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-2 error: an unknown patient is still 404, with no summary', async () => {
    const res = await request(app).get('/api/patients/9999');
    expect(res.status).toBe(404);
    expect(res.body.visitSummary).toBeUndefined();
    expect(res.body.error.code).toBeTruthy();
  });

  it('HMS-5 REQ-2 error: an invalid patient id is still 400', async () => {
    expect((await request(app).get('/api/patients/abc')).status).toBe(400);
  });

  it('HMS-5 REQ-1 error: PATCH on an unknown patient is still 404', async () => {
    const res = await request(app).patch('/api/patients/9999').send({ address: 'Invented Street 7' });
    expect(res.status).toBe(404);
    expect(res.body.visitSummary).toBeUndefined();
  });

  it('HMS-5 REQ-1 error: POST with invalid fields is still 400 with one message per field, and no summary', async () => {
    const res = await request(app).post('/api/patients').send({ fullName: 'Q', dateOfBirth: '2099-01-01', gender: 'X', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['dateOfBirth', 'fullName', 'gender', 'phone']);
    expect(res.body.visitSummary).toBeUndefined();
  });

  it('HMS-5 REQ-7: the appointments list of the detail is unchanged, upcoming first then past', async () => {
    const before = clock;
    try {
      // 09:40 on Monday: 09:45 (Scheduled) and Tuesday 10:00 (Cancelled) are upcoming, soonest first;
      // then the past ones, most recent first.
      clock = new Date(at(MONDAY, '09:40'));
      const p = await patient(1);
      expect(p.appointments.map((a: { startsAt: string }) => new Date(a.startsAt).toISOString())).toEqual([
        at(MONDAY, '09:45'), at(TUESDAY, '10:00'), at(MONDAY, '09:30'), at(MONDAY, '09:15'), at(MONDAY, '09:00'),
      ]);
    } finally {
      clock = before;
    }
  });

  it('HMS-5 REQ-8: medical history is unchanged, and the summary carries none of it', async () => {
    const p = await patient(1);
    expect(p.medicalHistory).toEqual({
      bloodGroup: null, allergies: ['Penicillin'], chronicConditions: [], currentMedications: [], notes: 'Invented note',
    });
    expect(JSON.stringify(p.visitSummary)).not.toMatch(/Penicillin|allerg|medical|phone|email/i);
  });
});
