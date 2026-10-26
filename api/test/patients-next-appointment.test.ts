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

  it('HMS-1 REQ-7: shows null when the patient has no upcoming Scheduled appointment', async () => {
    expect(await nextOf(app, 2)).toBeNull();
  });

  it('HMS-1 REQ-2: shows the earliest Scheduled appointment with its start and doctor name', async () => {
    const later = (await book(app, 1, 1, TUESDAY, '10:00')).body;
    const earliest = (await book(app, 2, 1, MONDAY, '09:30')).body;
    expect(await nextOf(app, 1)).toEqual({ id: earliest.id, starts_at: at(MONDAY, '09:30'), doctor_name: 'Dr. Test Doctor Two' });
    expect(later.id).toBeGreaterThan(0);
  });

  it('HMS-1 REQ-6: skips a Cancelled appointment that starts before a later Scheduled one', async () => {
    const list = (await request(app).get('/api/patients')).body.items as Array<{ id: number; next_appointment: { id: number } }>;
    const cancelled = list.find((p) => p.id === 1)!.next_appointment.id;
    const res = await request(app).post(`/api/appointments/${cancelled}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect(await nextOf(app, 1)).toMatchObject({ starts_at: at(TUESDAY, '10:00'), doctor_name: 'Dr. Test Doctor One' });
  });

  it("HMS-1 REQ-13: keeps an Inactive doctor's name", async () => {
    await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' });
    expect(await nextOf(app, 1)).toMatchObject({ doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-1 REQ-2: ignores appointments that start before now', async () => {
    const afterwards = testApp(db.pool, () => new Date(at(TUESDAY, '11:00')));
    expect(await nextOf(afterwards, 1)).toBeNull();
  });

  it('HMS-1 REQ-9, REQ-10: keeps paging and search unchanged', async () => {
    const all = await request(app).get('/api/patients');
    expect(all.body).toMatchObject({ page: 1, page_size: 20, total: 2 });
    expect((await request(app).get('/api/patients?q=patient two')).body.items.map((p: { id: number }) => p.id)).toEqual([2]);
  });

  it('HMS-1 REQ-10: an invalid list filter is still rejected with a field error', async () => {
    const res = await request(app).get('/api/patients?status=SOMETIMES');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['status']);
  });
});

/** HMS-1: Completed and No-show appointments never show, and the list order is unchanged. */
describe.skipIf(!pgAvailable())('patient list next appointment: closed appointments and order (HMS-1)', () => {
  let db: TestDb;
  let app: Express;
  /** Monday 09:20 in Kolkata: the 09:00 appointments have started and can be closed. */
  let started: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    started = testApp(db.pool, () => new Date(at(MONDAY, '09:20')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  // The checks use the default clock (Monday 08:00), when the closed 09:00 appointment still lies in the
  // future, so only the status filter can keep it out of the column.
  it('HMS-1 REQ-6: skips a Completed appointment and shows the next Scheduled one', async () => {
    const done = (await book(app, 1, 2, MONDAY, '09:00')).body;
    const next = (await book(app, 1, 2, TUESDAY, '09:00')).body;
    expect(await nextOf(app, 2)).toMatchObject({ id: done.id });
    const res = await request(started).post(`/api/appointments/${done.id}/complete`).send({});
    expect(res.body).toMatchObject({ status: 'COMPLETED' });
    expect(await nextOf(app, 2)).toMatchObject({ id: next.id, starts_at: at(TUESDAY, '09:00') });
  });

  it('HMS-1 REQ-6: skips a No-show appointment and shows the next Scheduled one', async () => {
    const missed = (await book(app, 2, 1, MONDAY, '09:00')).body;
    const next = (await book(app, 1, 1, TUESDAY, '09:30')).body;
    expect(await nextOf(app, 1)).toMatchObject({ id: missed.id });
    const res = await request(started).post(`/api/appointments/${missed.id}/no-show`).send({});
    expect(res.body).toMatchObject({ status: 'NO_SHOW' });
    expect(await nextOf(app, 1)).toMatchObject({ id: next.id, doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-1 REQ-11: keeps the list newest first', async () => {
    const ids = (await request(app).get('/api/patients')).body.items.map((p: { id: number }) => p.id);
    expect(ids).toEqual([2, 1]);
  });
});
