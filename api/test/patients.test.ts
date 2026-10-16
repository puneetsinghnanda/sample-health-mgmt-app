import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { book, loadFixture, MONDAY, testApp } from './helpers';

const NEW_PATIENT = {
  fullName: 'Test Patient Three', dateOfBirth: '2001-12-31', gender: 'OTHER', phone: '+91 00000 20003',
  email: 'Patient003@Example.com', address: 'Invented Street 1', emergencyContact: { name: 'Contact Three', phone: '+91 00000 30003' },
  bloodGroup: 'O+', allergies: ['Dust', ' '], chronicConditions: ['Asthma'], currentMedications: ['Inhaler'],
  medicalNotes: 'Invented history',
};

describe.skipIf(!pgAvailable())('patient management (PRD §4.2)', () => {
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

  it('PAT-1: registers a patient with a generated code and medical history', async () => {
    const res = await request(app).post('/api/patients').send(NEW_PATIENT);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'P-000003', age: 24, email: 'patient003@example.com', status: 'ACTIVE',
      emergencyContact: { name: 'Contact Three', phone: '+91 00000 30003' },
      medicalHistory: { bloodGroup: 'O+', allergies: ['Dust'], chronicConditions: ['Asthma'] },
    });
  });

  it('PAT-1: rejects invalid fields with one message per field', async () => {
    const res = await request(app).post('/api/patients').send({ fullName: 'Q', dateOfBirth: '2099-01-01', gender: 'X', phone: 'abc' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['dateOfBirth', 'fullName', 'gender', 'phone']);
    const old = await request(app).post('/api/patients').send({ ...NEW_PATIENT, fullName: 'Too Old', dateOfBirth: '1890-01-01' });
    expect(old.body.error.fields.dateOfBirth).toMatch(/120 years/);
  });

  it('PAT-2: lists newest first, 20 per page, and searches name, code or phone', async () => {
    const all = await request(app).get('/api/patients');
    expect(all.body).toMatchObject({ page: 1, page_size: 20, total: 3 });
    expect(all.body.items[0].code).toBe('P-000003');
    expect((await request(app).get('/api/patients?q=patient two')).body.items[0].id).toBe(2);
    expect((await request(app).get('/api/patients?q=P-000001')).body.items[0].id).toBe(1);
    expect((await request(app).get('/api/patients?q=0000020002')).body.items[0].id).toBe(2);
  });

  it('PAT-3: shows details, history and appointments, upcoming first', async () => {
    await book(app, 1, 1, MONDAY, '09:30');
    await book(app, 2, 1, MONDAY, '09:00');
    const res = await request(app).get('/api/patients/1');
    expect(res.body.medicalHistory.allergies).toEqual(['Penicillin']);
    expect(res.body.appointments.map((a: { doctor: { id: number } }) => a.doctor.id)).toEqual([2, 1]);
  });

  it('PAT-4: edits fields but never the code', async () => {
    const res = await request(app).patch('/api/patients/3').send({ code: 'P-999999', allergies: [], medicalNotes: '' });
    expect(res.body).toMatchObject({ code: 'P-000003', medicalHistory: { allergies: [], notes: null } });
  });

  it('PAT-5: warns about a likely duplicate and lets staff continue', async () => {
    const dup = { ...NEW_PATIENT, fullName: 'test patient three', phone: '+910000020003' };
    const warned = await request(app).post('/api/patients').send(dup);
    expect(warned.status).toBe(409);
    expect(warned.body.error).toMatchObject({ reason: 'POSSIBLE_DUPLICATE', existing: { id: 3, code: 'P-000003' } });
    const forced = await request(app).post('/api/patients').send({ ...dup, confirmDuplicate: true });
    expect(forced.status).toBe(201);
  });

  it('PAT-6: a patient with appointments cannot be deleted; one without can', async () => {
    expect((await request(app).delete('/api/patients/1')).status).toBe(409);
    expect((await request(app).delete('/api/patients/4')).status).toBe(204);
  });

  it('PAT-7: an Inactive patient cannot be booked', async () => {
    await request(app).patch('/api/patients/2').send({ status: 'INACTIVE' });
    const res = await book(app, 1, 2, MONDAY, '10:00');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.patientId).toMatch(/Inactive/);
  });

  it('PAT-8: lists and appointment views never carry medical history', async () => {
    const list = await request(app).get('/api/patients');
    for (const p of list.body.items) {
      expect(Object.keys(p).sort()).toEqual(['age', 'code', 'dateOfBirth', 'fullName', 'gender', 'id', 'phone', 'registeredAt', 'status']);
    }
    const appts = await request(app).get('/api/appointments?patientId=1');
    expect(JSON.stringify(appts.body)).not.toMatch(/Penicillin|allerg|medical/i);
  });
});
