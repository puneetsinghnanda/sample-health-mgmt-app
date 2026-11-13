import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, testApp, TUESDAY } from './helpers';

/** HMS-13: the appointment detail tells whether the appointment still fits its doctor. */
describe.skipIf(!pgAvailable())('appointment fits its doctor (HMS-13)', () => {
  let db: TestDb;
  let app: Express;
  let apptId: number;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
    apptId = (await book(app, 1, 1, TUESDAY, '11:00')).body.id;
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-13 REQ-1 REQ-2: flags a Scheduled appointment outside the availability exactly when DOC-7 does', async () => {
    expect((await request(app).get(`/api/appointments/${apptId}`)).body).toMatchObject({ doctorStatus: 'ACTIVE', outsideAvailability: false });
    await request(app).put('/api/doctors/1/availability').send({
      availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '10:00' })),
    });
    expect((await request(app).get(`/api/appointments/${apptId}`)).body.outsideAvailability).toBe(true);
    expect((await request(app).get('/api/doctors/1')).body.outsideAvailability).toContain(apptId);
  });

  it('HMS-13 REQ-3: no availability flag once the start time has passed', async () => {
    const later = testApp(db.pool, () => new Date(at(TUESDAY, '11:05')));
    const res = await request(later).get(`/api/appointments/${apptId}`);
    expect(res.body).toMatchObject({ status: 'SCHEDULED', outsideAvailability: false });
  });

  it('HMS-13 REQ-5 REQ-7: carries the Inactive doctor status alongside the availability flag', async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    expect((await request(app).get(`/api/appointments/${apptId}`)).body).toMatchObject({ doctorStatus: 'INACTIVE', outsideAvailability: true });
  });

  it('HMS-13 REQ-9: only the doctor status is added; the doctor object and other fields are unchanged', async () => {
    const body = (await request(app).get(`/api/appointments/${apptId}`)).body;
    expect(Object.keys(body.doctor).sort()).toEqual(['code', 'fullName', 'id']);
    for (const field of ['phone', 'email', 'feePaise', 'slotMinutes', 'availability', 'specialization', 'department']) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('HMS-13 REQ-8: a Cancelled appointment never carries the availability flag', async () => {
    const res = await request(app).post(`/api/appointments/${apptId}/cancel`).send({ reason: 'Doctor unavailable' });
    expect(res.body).toMatchObject({ status: 'CANCELLED', doctorStatus: 'INACTIVE', outsideAvailability: false });
  });
});
