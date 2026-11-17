import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const detailNext = async (app: Express, patientId: number) => (await request(app).get(`/api/patients/${patientId}`)).body.next_appointment;

const listNext = async (app: Express, patientId: number) =>
  ((await request(app).get('/api/patients')).body.items as Array<{ id: number; next_appointment: unknown }>)
    .find((p) => p.id === patientId)?.next_appointment;

/** HMS-15: GET /api/patients/:id carries the earliest Scheduled appointment that starts strictly after now. */
describe.skipIf(!pgAvailable())('patient detail next appointment (HMS-15)', () => {
  let db: TestDb;
  let app: Express;
  let laterId = 0;
  let earliestId = 0;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-15 REQ-5: next_appointment is null when the patient has no upcoming Scheduled appointment', async () => {
    const res = await request(app).get('/api/patients/2');
    expect(res.status).toBe(200);
    expect(res.body.next_appointment).toBeNull();
  });

  it('HMS-15 REQ-4: picks the earliest start, not the first booked, with its id, UTC start and doctor name', async () => {
    laterId = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    earliestId = (await book(app, 2, 1, MONDAY, '09:30')).body.id;
    expect(await detailNext(app, 1)).toEqual({ id: earliestId, starts_at: at(MONDAY, '09:30'), doctor_name: 'Dr. Test Doctor Two' });
  });

  it('HMS-15 REQ-4: the patient page and the patients list agree', async () => {
    expect(await detailNext(app, 1)).toEqual(await listNext(app, 1));
  });

  it('HMS-15 REQ-7: an appointment starting exactly at now is not next', async () => {
    const atStart = testApp(db.pool, () => new Date(at(MONDAY, '09:30')));
    expect(await detailNext(atStart, 1)).toMatchObject({ id: laterId, starts_at: at(TUESDAY, '10:00') });
  });

  it('HMS-15 REQ-7: an appointment that has already started is not next', async () => {
    const started = testApp(db.pool, () => new Date(at(MONDAY, '09:45')));
    expect(await detailNext(started, 1)).toMatchObject({ id: laterId });
  });

  it('HMS-15 REQ-5, REQ-7: null once every Scheduled appointment has started', async () => {
    const afterwards = testApp(db.pool, () => new Date(at(TUESDAY, '10:05')));
    expect(await detailNext(afterwards, 1)).toBeNull();
  });

  it('HMS-15 REQ-6: skips an earlier Cancelled appointment and shows the later Scheduled one', async () => {
    const res = await request(app).post(`/api/appointments/${earliestId}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect(await detailNext(app, 1)).toEqual({ id: laterId, starts_at: at(TUESDAY, '10:00'), doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-15 REQ-8: the appointments array still holds every appointment, including the Cancelled one', async () => {
    const res = await request(app).get('/api/patients/1');
    expect(res.body.appointments.map((a: { id: number }) => a.id).sort()).toEqual([laterId, earliestId].sort());
  });

  it('HMS-15 EP-3: PATCH returns the same next_appointment as GET', async () => {
    const res = await request(app).patch('/api/patients/1').send({ address: 'Invented Street 15' });
    expect(res.status).toBe(200);
    expect(res.body.next_appointment).toEqual(await detailNext(app, 1));
  });

  it('HMS-15 EP-2: a newly registered patient has next_appointment null', async () => {
    const res = await request(app).post('/api/patients').send({
      fullName: 'Test Patient Fifteen', dateOfBirth: '1999-03-15', gender: 'OTHER', phone: '+91 00000 20015',
    });
    expect(res.status).toBe(201);
    expect(res.body.next_appointment).toBeNull();
  });

  it('HMS-15 REQ-4: an unknown patient is still 404', async () => {
    const res = await request(app).get('/api/patients/999');
    expect(res.status).toBe(404);
  });
});

/** HMS-15 REQ-10: one detail request uses a single "now" for appointments and next_appointment. */
describe.skipIf(!pgAvailable())('patient detail next appointment: one clock read per request (HMS-15)', () => {
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

  it('HMS-15 REQ-10: appointments and next_appointment agree even when the clock moves between reads', async () => {
    const soon = (await book(app, 2, 1, MONDAY, '09:30')).body;
    const later = (await book(app, 1, 1, TUESDAY, '10:00')).body;
    // Alternates 09:29 / 09:31 local on every read: any two reads straddle the 09:30 start, so a
    // second read would put the 09:30 appointment on different sides of "now" for the two fields.
    let reads = 0;
    const flipping = testApp(db.pool, () => new Date(at(MONDAY, reads++ % 2 === 0 ? '09:29' : '09:31')));
    const res = await request(flipping).get('/api/patients/1');
    expect(res.status).toBe(200);
    expect([soon.id, later.id]).toContain(res.body.next_appointment.id);
    expect(res.body.next_appointment.id).toBe(res.body.appointments[0].id);
  });
});

/** HMS-15: Completed and No-show appointments are never the next appointment. */
describe.skipIf(!pgAvailable())('patient detail next appointment: closed appointments (HMS-15)', () => {
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

  // Checks run at the default clock (Monday 08:00), when the closed 09:00 appointments still lie in the
  // future, so only the status filter keeps them out.
  it('HMS-15 REQ-6: skips a Completed appointment', async () => {
    const done = (await book(app, 1, 2, MONDAY, '09:00')).body;
    const next = (await book(app, 1, 2, TUESDAY, '09:00')).body;
    expect(await detailNext(app, 2)).toMatchObject({ id: done.id });
    const started = testApp(db.pool, () => new Date(at(MONDAY, '09:20')));
    expect((await request(started).post(`/api/appointments/${done.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect(await detailNext(app, 2)).toMatchObject({ id: next.id, starts_at: at(TUESDAY, '09:00') });
  });

  it('HMS-15 REQ-6: skips a No-show appointment', async () => {
    const missed = (await book(app, 2, 1, MONDAY, '09:00')).body;
    const next = (await book(app, 1, 1, TUESDAY, '09:30')).body;
    expect(await detailNext(app, 1)).toMatchObject({ id: missed.id });
    const started = testApp(db.pool, () => new Date(at(MONDAY, '09:20')));
    expect((await request(started).post(`/api/appointments/${missed.id}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect(await detailNext(app, 1)).toMatchObject({ id: next.id, doctor_name: 'Dr. Test Doctor One' });
  });
});
