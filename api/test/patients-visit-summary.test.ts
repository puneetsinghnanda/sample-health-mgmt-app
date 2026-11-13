import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** HMS-5: all-time Visit summary on the patient detail. Its own database, so other tests do not move the counts. */
describe.skipIf(!pgAvailable())('patient Visit summary (HMS-5)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const patient = async (id: number) => (await request(app).get(`/api/patients/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Patient 1, Monday with doctor 1: 09:00 and 09:15 Completed, 09:30 No-show, 09:45 left Scheduled after
    // its start, 11:00 Cancelled (the latest start); Tuesday 10:00 Scheduled. Patient 2: Monday 10:15 Completed.
    const seen1 = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const seen2 = (await book(app, 1, 1, MONDAY, '09:15')).body.id;
    const missed = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    await book(app, 1, 1, MONDAY, '09:45');
    const called = (await book(app, 1, 1, MONDAY, '11:00')).body.id;
    await book(app, 1, 1, TUESDAY, '10:00');
    const other = (await book(app, 1, 2, MONDAY, '10:15')).body.id;
    await request(app).post(`/api/appointments/${called}/cancel`).send({ reason: 'Test reason' });
    clock = new Date(at(MONDAY, '10:30'));
    await request(app).post(`/api/appointments/${seen1}/complete`);
    await request(app).post(`/api/appointments/${seen2}/complete`);
    await request(app).post(`/api/appointments/${missed}/no-show`);
    await request(app).post(`/api/appointments/${other}/complete`);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-5 REQ-2/REQ-3: the patient detail counts Completed and No-show appointments', async () => {
    expect((await patient(1)).visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-4 edge: Scheduled (even past and unclosed) and Cancelled (even the latest) are not counted', async () => {
    const p = await patient(1);
    expect(p.appointments).toHaveLength(6);
    expect(p.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it("HMS-5 REQ-2 edge: only this patient's appointments are counted", async () => {
    expect((await patient(2)).visitSummary).toEqual({ completed: 1, noShow: 0 });
  });

  it('HMS-5 REQ-6: counts are all time, not limited to a period', async () => {
    const before = clock;
    try {
      clock = new Date(at('2027-06-01', '09:00'));
      expect((await patient(1)).visitSummary).toEqual({ completed: 2, noShow: 1 });
    } finally {
      clock = before;
    }
  });

  it('HMS-5 REQ-5: a new patient with no appointments shows 0 for each, also in the POST response', async () => {
    const res = await request(app).post('/api/patients').send({
      fullName: 'Test Patient Three', dateOfBirth: '2001-12-31', gender: 'OTHER', phone: '+91 00000 20003',
    });
    expect(res.status).toBe(201);
    expect(res.body.visitSummary).toEqual({ completed: 0, noShow: 0 });
    expect((await patient(res.body.id)).visitSummary).toEqual({ completed: 0, noShow: 0 });
  });

  it('HMS-5 REQ-1: the PATCH response carries the same counts', async () => {
    const res = await request(app).patch('/api/patients/1').send({ address: 'Invented Street 2' });
    expect(res.status).toBe(200);
    expect(res.body.visitSummary).toEqual({ completed: 2, noShow: 1 });
  });

  it('HMS-5 REQ-2 error: an unknown patient is still 404', async () => {
    expect((await request(app).get('/api/patients/9999')).status).toBe(404);
  });

  it('HMS-5 REQ-1 error: PATCH on an unknown patient is still 404', async () => {
    expect((await request(app).patch('/api/patients/9999').send({ address: 'Invented Street 3' })).status).toBe(404);
  });

  it('HMS-5 REQ-1 error: POST with invalid fields is still 400 with field errors and no summary', async () => {
    const res = await request(app).post('/api/patients').send({ fullName: 'Q', dateOfBirth: '2099-01-01', gender: 'X', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['dateOfBirth', 'fullName', 'gender', 'phone']);
    expect(res.body.visitSummary).toBeUndefined();
  });

  it('HMS-5 REQ-4/REQ-5 (S-2 AC2): only Scheduled and Cancelled appointments shows 0 for each', async () => {
    const created = await request(app).post('/api/patients').send({
      fullName: 'Test Patient Four', dateOfBirth: '1999-03-03', gender: 'FEMALE', phone: '+91 00000 20004',
    });
    const id = created.body.id as number;
    await book(app, 1, id, TUESDAY, '10:30');
    const called = (await book(app, 1, id, TUESDAY, '10:45')).body.id;
    await request(app).post(`/api/appointments/${called}/cancel`).send({ reason: 'Test reason' });
    const p = await patient(id);
    expect(p.appointments).toHaveLength(2);
    expect(p.visitSummary).toEqual({ completed: 0, noShow: 0 });
  });

  it('HMS-5 REQ-2/REQ-3: the summary holds two integers and nothing else', async () => {
    const s = (await patient(1)).visitSummary;
    expect(Object.keys(s).sort()).toEqual(['completed', 'noShow']);
    expect(Number.isInteger(s.completed) && Number.isInteger(s.noShow)).toBe(true);
  });
});
