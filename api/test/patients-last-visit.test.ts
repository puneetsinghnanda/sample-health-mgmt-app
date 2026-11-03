import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const lastVisitOf = async (app: Express, patientId: number) =>
  ((await request(app).get('/api/patients')).body.items as Array<{ id: number; lastVisitAt: string | null }>)
    .find((p) => p.id === patientId)?.lastVisitAt;

/** HMS-4: each patient list item carries the start of its latest Completed appointment, or null. */
describe.skipIf(!pgAvailable())('patient list last visit (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  /** Tuesday 11:00 in Kolkata: every appointment booked below has started and can be closed. */
  let later: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    later = testApp(db.pool, () => new Date(at(TUESDAY, '11:00')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-8: is null when the patient has no Completed appointment', async () => {
    expect(await lastVisitOf(app, 2)).toBeNull();
  });

  it('HMS-4 REQ-2, REQ-3, REQ-4: is the start of the Completed appointment with the latest start', async () => {
    const first = (await book(app, 1, 1, MONDAY, '09:00')).body;
    const second = (await book(app, 1, 1, TUESDAY, '09:00')).body;
    // Close the later one first, so the order of closing cannot decide the value.
    expect((await request(later).post(`/api/appointments/${second.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect((await request(later).post(`/api/appointments/${first.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect(await lastVisitOf(app, 1)).toBe(at(TUESDAY, '09:00'));
  });

  it('HMS-4 REQ-7: ignores Cancelled, No-show and Scheduled appointments that start after the Completed one', async () => {
    const done = (await book(app, 2, 2, MONDAY, '09:30')).body;
    const missed = (await book(app, 1, 2, TUESDAY, '10:00')).body;
    const cancelled = (await book(app, 1, 2, TUESDAY, '10:30')).body;
    expect((await book(app, 1, 2, TUESDAY, '09:30')).body).toMatchObject({ status: 'SCHEDULED' });
    await request(later).post(`/api/appointments/${done.id}/complete`).send({});
    expect((await request(later).post(`/api/appointments/${missed.id}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect((await request(app).post(`/api/appointments/${cancelled.id}/cancel`).send({ reason: 'Patient requested' })).body)
      .toMatchObject({ status: 'CANCELLED' });
    expect(await lastVisitOf(app, 2)).toBe(at(MONDAY, '09:30'));
  });

  it('HMS-4 REQ-9, REQ-10, REQ-11: keeps one row per patient, the page size and the order', async () => {
    const all = (await request(app).get('/api/patients')).body;
    expect(all).toMatchObject({ page: 1, page_size: 20, total: 2 });
    expect(all.items.map((p: { id: number }) => p.id)).toEqual([2, 1]);
    expect((await request(app).get('/api/patients?q=patient two')).body.items.map((p: { id: number }) => p.id)).toEqual([2]);
  });
});
