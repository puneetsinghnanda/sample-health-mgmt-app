import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { book, loadFixture, MONDAY, testApp } from './helpers';

describe.skipIf(!pgAvailable())('appointment detail statuses for Book again (HMS-14)', () => {
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

  it('HMS-14 REQ-9/REQ-10: the detail carries doctor_status and patient_status as ACTIVE', async () => {
    const appt = (await book(app, 1, 1, MONDAY, '09:00')).body;
    expect(appt).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
    const res = await request(app).get(`/api/appointments/${appt.id}`);
    expect(res.body).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-17 (A-05): the cancel action returns the same detail shape with both statuses', async () => {
    const res = await request(app).post('/api/appointments/1/cancel').send({ reason: 'Patient requested' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'CANCELLED', doctor_status: 'ACTIVE', patient_status: 'ACTIVE' });
  });

  it('HMS-14 REQ-10: an Inactive patient shows as INACTIVE on the original appointment', async () => {
    await request(app).patch('/api/patients/1').send({ status: 'INACTIVE' });
    const res = await request(app).get('/api/appointments/1');
    expect(res.body).toMatchObject({ doctor_status: 'ACTIVE', patient_status: 'INACTIVE' });
  });

  it('HMS-14 REQ-9: an Inactive doctor shows as INACTIVE on the original appointment', async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    const res = await request(app).get('/api/appointments/1');
    expect(res.body).toMatchObject({ doctor_status: 'INACTIVE', patient_status: 'INACTIVE' });
  });

  it('HMS-14 REQ-19: the detail still carries no medical history', async () => {
    const res = await request(app).get('/api/appointments/1');
    expect(JSON.stringify(res.body)).not.toMatch(/Penicillin|allerg|medical/i);
  });
});
