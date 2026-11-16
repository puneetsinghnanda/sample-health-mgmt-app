import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

describe.skipIf(!pgAvailable())('appointment detail statuses for Book again (HMS-14)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  let original: number;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // The original appointment every Book again case starts from: doctor 1, patient 1, Monday 09:00.
    original = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-14 REQ-9/REQ-10: the booking and the detail carry doctor_status and patient_status as ACTIVE', async () => {
    const res = await request(app).get(`/api/appointments/${original}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-17 (A-05): the cancel action returns the same detail shape with both statuses', async () => {
    const res = await request(app).post(`/api/appointments/${original}/cancel`).send({ reason: 'Patient requested' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-17 (A-05): the reschedule action returns both statuses', async () => {
    const appt = (await book(app, 1, 2, MONDAY, '10:00')).body;
    const res = await request(app).post(`/api/appointments/${appt.id}/reschedule`).send({ startsAt: at(MONDAY, '10:30') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-17 (A-05): the complete and no-show actions return both statuses', async () => {
    const done = (await book(app, 1, 2, MONDAY, '11:00')).body;
    const missed = (await book(app, 2, 2, MONDAY, '09:30')).body;
    clock = new Date(at(MONDAY, '11:30'));
    const completed = await request(app).post(`/api/appointments/${done.id}/complete`);
    const noShow = await request(app).post(`/api/appointments/${missed.id}/no-show`);
    clock = NOW;
    expect(completed.body).toMatchObject({ status: 'COMPLETED', doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
    expect(noShow.body).toMatchObject({ status: 'NO_SHOW', doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-13/REQ-14 (S-5 AC3/AC4): booking again creates a new id and leaves the original and its history as they were', async () => {
    const before = (await request(app).get(`/api/appointments/${original}`)).body;
    const again = await book(app, 1, 1, TUESDAY, '09:00');
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(original);
    const after = (await request(app).get(`/api/appointments/${original}`)).body;
    expect(after).toEqual(before);
    expect(after.history.map((e: { event: string }) => e.event)).toEqual(['BOOKED', 'CANCELLED']);
  });

  it('HMS-14 REQ-19: the detail still carries no medical history', async () => {
    const res = await request(app).get(`/api/appointments/${original}`);
    expect(JSON.stringify(res.body)).not.toMatch(/Penicillin|allerg|medical/i);
  });

  it('HMS-14 REQ-10: an Inactive patient shows as INACTIVE on the original appointment', async () => {
    expect((await request(app).patch('/api/patients/1').send({ status: 'INACTIVE' })).status).toBe(200);
    const res = await request(app).get(`/api/appointments/${original}`);
    expect(res.body).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'INACTIVE' });
  });

  it('HMS-14 REQ-9: an Inactive doctor shows as INACTIVE on the original appointment', async () => {
    expect((await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' })).status).toBe(200);
    const res = await request(app).get(`/api/appointments/${original}`);
    expect(res.body).toMatchObject({ doctor_status: 'INACTIVE', patient_status: 'INACTIVE' });
  });

  it('HMS-14 REQ-9/REQ-12 error: booking again with an Inactive doctor is still refused server-side', async () => {
    const res = await book(app, 1, 2, TUESDAY, '10:00');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.doctorId).toMatch(/Inactive/);
  });

  it('HMS-14 REQ-10/REQ-12 error: booking again with an Inactive patient is still refused server-side', async () => {
    const res = await book(app, 2, 1, MONDAY, '09:00');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.patientId).toMatch(/Inactive/);
  });

  it('HMS-14 REQ-17 error: an unknown appointment id on the detail GET is still 404', async () => {
    const res = await request(app).get('/api/appointments/999999');
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Appointment A-999999 not found');
    expect(res.body).not.toHaveProperty('doctor_status');
  });
});
