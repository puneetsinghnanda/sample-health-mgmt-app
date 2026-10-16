import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { loadFixture, testApp } from './helpers';

describe.skipIf(!pgAvailable())('departments and specializations (PRD §4.5)', () => {
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

  it('REF-1: lists, adds and renames entries', async () => {
    const created = await request(app).post('/api/specializations').send({ name: 'Dermatology' });
    expect(created.status).toBe(201);
    const renamed = await request(app).patch(`/api/specializations/${created.body.id}`).send({ name: 'Skin care' });
    expect(renamed.body.name).toBe('Skin care');
    const list = await request(app).get('/api/specializations');
    expect(list.body.items.map((e: { name: string }) => e.name)).toEqual(['Cardiology', 'General Medicine', 'Skin care']);
  });

  it('REF-1: names are unique, ignoring case', async () => {
    const res = await request(app).post('/api/departments').send({ name: 'outpatient' });
    expect(res.status).toBe(409);
  });

  it('REF-2: an entry used by a doctor cannot be deleted, an unused one can', async () => {
    expect((await request(app).delete('/api/departments/1')).status).toBe(409);
    const spare = await request(app).post('/api/departments').send({ name: 'Diagnostics' });
    expect((await request(app).delete(`/api/departments/${spare.body.id}`)).status).toBe(204);
  });

  it('REF-3: an Inactive entry cannot be chosen, but doctors who have it keep it', async () => {
    await request(app).patch('/api/specializations/2').send({ status: 'INACTIVE' });
    const res = await request(app).post('/api/doctors').send({
      fullName: 'Dr. Another', specializationId: 2, departmentId: 1, phone: '+91 00000 10009', feePaise: 0,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.specializationId).toMatch(/Inactive/);
    const kept = await request(app).patch('/api/doctors/2').send({ phone: '+91 00000 10012' });
    expect(kept.status).toBe(200);
    expect(kept.body.specialization).toMatchObject({ id: 2, status: 'INACTIVE' });
    await request(app).patch('/api/specializations/2').send({ status: 'ACTIVE' });
  });

  it('REF-4: a rename shows on existing doctors', async () => {
    await request(app).patch('/api/departments/2').send({ name: 'Surgical' });
    expect((await request(app).get('/api/doctors/2')).body.department.name).toBe('Surgical');
  });
});
