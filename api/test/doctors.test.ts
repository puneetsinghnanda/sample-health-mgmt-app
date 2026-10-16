import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

describe.skipIf(!pgAvailable())('doctor management (PRD §4.1)', () => {
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

  it('DOC-1: creates a doctor with availability and a generated code', async () => {
    const res = await request(app).post('/api/doctors').send({
      fullName: 'Dr. Third', specializationId: 1, departmentId: 1, phone: '+91 00000 10003', feePaise: 30000,
      availability: [{ weekday: 3, start: '10:00', end: '11:00' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'D-0003', slotMinutes: 15, status: 'ACTIVE', feePaise: 30000 });
    expect(res.body.availability).toEqual([{ weekday: 3, start: '10:00', end: '11:00' }]);
  });

  it('DOC-1: rejects invalid fields with one message per field', async () => {
    const res = await request(app).post('/api/doctors').send({
      fullName: 'X', specializationId: 1, departmentId: 1, phone: '12', email: 'nope', feePaise: -1, slotMinutes: 7,
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['email', 'feePaise', 'fullName', 'phone', 'slotMinutes']);
  });

  it('DOC-1: rejects overlapping availability blocks', async () => {
    const res = await request(app).put('/api/doctors/1/availability').send({
      availability: [{ weekday: 1, start: '09:00', end: '11:00' }, { weekday: 1, start: '10:30', end: '12:00' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.availability).toMatch(/overlap/);
  });

  it('DOC-2: lists 20 per page by name, with search and filters', async () => {
    const all = await request(app).get('/api/doctors');
    expect(all.body).toMatchObject({ page: 1, page_size: 20, total: 3 });
    expect(all.body.items.map((d: { fullName: string }) => d.fullName)).toEqual(['Dr. Test Doctor One', 'Dr. Test Doctor Two', 'Dr. Third']);
    expect((await request(app).get('/api/doctors?q=two')).body.total).toBe(1);
    expect((await request(app).get('/api/doctors?q=D-0002')).body.items[0].id).toBe(2);
    expect((await request(app).get('/api/doctors?departmentId=1&specializationId=1')).body.total).toBe(2);
  });

  it('DOC-3: shows details, availability and upcoming appointments', async () => {
    await book(app, 1, 1, MONDAY, '09:00');
    const res = await request(app).get('/api/doctors/1');
    expect(res.body.availability).toHaveLength(5);
    expect(res.body.upcoming).toHaveLength(1);
    expect(res.body.upcoming[0].patient.fullName).toBe('Test Patient One');
  });

  it('DOC-4: edits fields but never the code', async () => {
    const res = await request(app).patch('/api/doctors/3').send({ fullName: 'Dr. Third Renamed', code: 'D-9999', feePaise: 35000 });
    expect(res.body).toMatchObject({ code: 'D-0003', fullName: 'Dr. Third Renamed', feePaise: 35000 });
  });

  it('DOC-5: a doctor with appointments cannot be deleted; one without can', async () => {
    expect((await request(app).delete('/api/doctors/1')).status).toBe(409);
    expect((await request(app).delete('/api/doctors/3')).status).toBe(204);
    expect((await request(app).get('/api/doctors/3')).status).toBe(404);
  });

  it('DOC-7: changing availability keeps appointments and flags those outside it', async () => {
    const appt = (await book(app, 1, 2, TUESDAY, '11:00')).body;
    await request(app).put('/api/doctors/1/availability').send({
      availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '10:00' })),
    });
    const doc = (await request(app).get('/api/doctors/1')).body;
    expect(doc.upcoming.map((a: { id: number }) => a.id)).toContain(appt.id);
    expect(doc.outsideAvailability).toEqual([appt.id]);
  });

  it('DOC-6: an Inactive doctor cannot be booked but keeps existing appointments', async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    const res = await book(app, 1, 2, TUESDAY, '09:00');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.doctorId).toMatch(/Inactive/);
    expect((await request(app).get('/api/doctors/1')).body.upcoming.length).toBeGreaterThan(0);
  });
});
