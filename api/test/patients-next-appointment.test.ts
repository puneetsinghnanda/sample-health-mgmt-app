import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const nextOf = async (app: Express, patientId: number) =>
  ((await request(app).get('/api/patients')).body.items as Array<{ id: number; next_appointment: unknown }>)
    .find((p) => p.id === patientId)?.next_appointment;

/** HMS-1: each patient list item carries its earliest Scheduled appointment that starts after now. */
describe.skipIf(!pgAvailable())('patient list next appointment (HMS-1)', () => {
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

  it('shows null when the patient has no upcoming Scheduled appointment', async () => {
    expect(await nextOf(app, 2)).toBeNull();
  });

  it('shows the earliest Scheduled appointment with its start and doctor name', async () => {
    const later = (await book(app, 1, 1, TUESDAY, '10:00')).body;
    const earliest = (await book(app, 2, 1, MONDAY, '09:30')).body;
    expect(await nextOf(app, 1)).toEqual({ id: earliest.id, starts_at: at(MONDAY, '09:30'), doctor_name: 'Dr. Test Doctor Two' });
    expect(later.id).toBeGreaterThan(0);
  });

  it('skips a Cancelled appointment that starts before a later Scheduled one', async () => {
    const list = (await request(app).get('/api/patients')).body.items as Array<{ id: number; next_appointment: { id: number } }>;
    const cancelled = list.find((p) => p.id === 1)!.next_appointment.id;
    const res = await request(app).post(`/api/appointments/${cancelled}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect(await nextOf(app, 1)).toMatchObject({ starts_at: at(TUESDAY, '10:00'), doctor_name: 'Dr. Test Doctor One' });
  });

  it("keeps an Inactive doctor's name", async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    expect(await nextOf(app, 1)).toMatchObject({ doctor_name: 'Dr. Test Doctor One' });
  });

  it('ignores appointments that start before now', async () => {
    const afterwards = testApp(db.pool, () => new Date(at(TUESDAY, '11:00')));
    expect(await nextOf(afterwards, 1)).toBeNull();
  });

  it('keeps paging and search unchanged', async () => {
    const all = await request(app).get('/api/patients');
    expect(all.body).toMatchObject({ page: 1, page_size: 20, total: 2 });
    expect((await request(app).get('/api/patients?q=patient two')).body.items.map((p: { id: number }) => p.id)).toEqual([2]);
  });
});
