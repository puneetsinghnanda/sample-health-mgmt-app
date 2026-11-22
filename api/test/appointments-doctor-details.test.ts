import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/**
 * HMS-31: the appointment detail carries the doctor's current specialization, department and fee.
 * Its own database, because the later tests change the doctor and its reference entries.
 */
describe.skipIf(!pgAvailable())('appointment detail doctor details (HMS-31)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const ids = { completed: 0, noShow: 0, cancelled: 0, scheduled: 0 };
  const detail = async (id: number) => (await request(app).get(`/api/appointments/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Doctor 1 (General Medicine, Outpatient, fee 50000 paise). Monday 09:00/09:15/09:30, Tuesday 10:00.
    ids.completed = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    ids.noShow = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    ids.cancelled = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    ids.scheduled = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    clock = new Date(at(MONDAY, '09:50'));
    await request(app).post(`/api/appointments/${ids.completed}/complete`);
    await request(app).post(`/api/appointments/${ids.noShow}/no-show`);
    await request(app).post(`/api/appointments/${ids.cancelled}/cancel`).send({ reason: 'Test reason' });
  });
  afterAll(async () => {
    await db.drop();
  });

  it("HMS-31 REQ-1/REQ-2/REQ-3: the detail carries the doctor's specialization, department and fee", async () => {
    const a = await detail(ids.scheduled);
    expect(a.doctor).toEqual({
      id: 1,
      code: 'D-0001',
      fullName: 'Dr. Test Doctor One',
      specialization: { id: 1, name: 'General Medicine', status: 'ACTIVE' },
      department: { id: 1, name: 'Outpatient', status: 'ACTIVE' },
      feePaise: 50000,
    });
  });

  it('HMS-31 (EP-2, EP-4): booking and cancelling answer with the same doctor details', async () => {
    const booked = await book(app, 1, 2, TUESDAY, '10:15');
    expect(booked.status).toBe(201);
    expect(booked.body.doctor).toMatchObject({ feePaise: 50000, department: { name: 'Outpatient' } });
    const cancelled = await request(app).post(`/api/appointments/${booked.body.id}/cancel`).send({ reason: 'Test reason' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.doctor).toMatchObject({ feePaise: 50000, specialization: { name: 'General Medicine' } });
  });

  it('HMS-31 REQ-9/REQ-10: the detail carries no doctor contact details and no patient medical history', async () => {
    const a = await detail(ids.completed);
    expect(Object.keys(a.doctor).sort()).toEqual(['code', 'department', 'feePaise', 'fullName', 'id', 'specialization']);
    const text = JSON.stringify(a);
    expect(text).not.toMatch(/doctor01@example\.com|00000 10001|phone|email/i);
    expect(text).not.toMatch(/Penicillin|Invented note|allerg|medical/i);
  });

  it('HMS-31 REQ-11: the appointment list keeps its doctor shape', async () => {
    const list = (await request(app).get('/api/appointments?doctorId=1')).body;
    expect(list.items.length).toBeGreaterThan(0);
    for (const item of list.items) {
      expect(Object.keys(item.doctor).sort()).toEqual(['code', 'fullName', 'id']);
    }
  });

  it('HMS-31 REQ-11 error: an unknown appointment is still 404', async () => {
    expect((await request(app).get('/api/appointments/9999')).status).toBe(404);
  });

  it("HMS-31 REQ-5: Completed, No-show and Cancelled appointments show the doctor's current fee, department and specialization", async () => {
    const res = await request(app).patch('/api/doctors/1').send({ feePaise: 60000, departmentId: 2, specializationId: 2 });
    expect(res.status).toBe(200);
    for (const id of [ids.completed, ids.noShow, ids.cancelled]) {
      const a = await detail(id);
      expect(a.doctor.feePaise).toBe(60000);
      expect(a.doctor.department).toEqual({ id: 2, name: 'Surgery', status: 'ACTIVE' });
      expect(a.doctor.specialization).toEqual({ id: 2, name: 'Cardiology', status: 'ACTIVE' });
    }
  });

  it('HMS-31 REQ-7 edge: an Inactive specialization is returned with status INACTIVE; the department stays ACTIVE', async () => {
    await request(app).patch('/api/specializations/2').send({ status: 'INACTIVE' });
    const a = await detail(ids.scheduled);
    expect(a.doctor.specialization).toEqual({ id: 2, name: 'Cardiology', status: 'INACTIVE' });
    expect(a.doctor.department.status).toBe('ACTIVE');
  });

  it('HMS-31 REQ-6: an Inactive doctor still has current specialization, department and fee', async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    const a = await detail(ids.scheduled);
    expect(a.doctor.feePaise).toBe(60000);
    expect(a.doctor.department.name).toBe('Surgery');
    expect(a.doctor.specialization.name).toBe('Cardiology');
  });
});
