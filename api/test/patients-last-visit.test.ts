import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const lastOf = async (app: Express, patientId: number) =>
  ((await request(app).get('/api/patients')).body.items as Array<{ id: number; last_visit_at: unknown }>)
    .find((p) => p.id === patientId)?.last_visit_at;

/** HMS-4: each patient list item carries the start of its latest Completed appointment. */
describe.skipIf(!pgAvailable())('patient list last visit (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  /** Tuesday 10:20 in Kolkata: every appointment below has started and can be closed. */
  let later: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    later = testApp(db.pool, () => new Date(at(TUESDAY, '10:20')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-7: shows null when the patient has no Completed appointment', async () => {
    expect(await lastOf(app, 1)).toBeNull();
  });

  it('HMS-4 REQ-2, REQ-13: shows the start of the latest of two Completed appointments', async () => {
    const first = (await book(app, 1, 1, MONDAY, '09:00')).body;
    const second = (await book(app, 1, 1, TUESDAY, '09:00')).body;
    for (const id of [first.id, second.id]) {
      expect((await request(later).post(`/api/appointments/${id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    }
    expect(await lastOf(app, 1)).toBe(at(TUESDAY, '09:00'));
  });

  it('HMS-4 REQ-4, REQ-7: a patient whose only appointment is Cancelled shows null, not another patient\'s visit', async () => {
    const called = (await book(app, 2, 2, MONDAY, '09:30')).body;
    expect((await request(app).post(`/api/appointments/${called.id}/cancel`).send({ reason: 'Patient requested' })).body)
      .toMatchObject({ status: 'CANCELLED' });
    expect(await lastOf(app, 2)).toBeNull();
    expect(await lastOf(app, 1)).toBe(at(TUESDAY, '09:00'));
  });

  it('HMS-4 REQ-8, REQ-9: search and paging still return the matched patient with its last visit', async () => {
    const res = await request(app).get('/api/patients?q=patient one');
    expect(res.body).toMatchObject({ page: 1, page_size: 20, total: 1 });
    expect(res.body.items.map((p: { id: number; last_visit_at: string | null }) => [p.id, p.last_visit_at]))
      .toEqual([[1, at(TUESDAY, '09:00')]]);
  });

  it('HMS-4 REQ-9: an invalid list filter is still rejected with a field error', async () => {
    const res = await request(app).get('/api/patients?status=SOMETIMES');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['status']);
  });
});

/** HMS-4: paging and order of the list are unchanged by the last visit. */
describe.skipIf(!pgAvailable())('patient list last visit: paging and order (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    const later = testApp(db.pool, () => new Date(at(TUESDAY, '10:20')));
    await loadFixture(app);
    // The oldest patient (fixture patient 1) gets a visit, so page 2 can show it with its date.
    const visit = (await book(app, 1, 1, MONDAY, '09:00')).body;
    expect((await request(later).post(`/api/appointments/${visit.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    // 19 invented patients on top of the 2 in the fixture: 21 in all, one more than a page.
    for (let i = 1; i <= 19; i++) {
      const n = String(i).padStart(4, '0');
      const res = await request(app).post('/api/patients')
        .send({ fullName: `Test Patient P${n}`, dateOfBirth: '1990-01-01', gender: 'OTHER', phone: `+91 00000 4${n}` });
      expect(res.status).toBe(201);
    }
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-8: page 1 holds 20 patients and page 2 still carries last_visit_at', async () => {
    const first = await request(app).get('/api/patients');
    expect(first.body).toMatchObject({ page: 1, page_size: 20, total: 21 });
    expect(first.body.items).toHaveLength(20);
    for (const p of first.body.items) expect(p).toHaveProperty('last_visit_at', null);
    const second = await request(app).get('/api/patients?page=2');
    expect(second.body).toMatchObject({ page: 2, page_size: 20, total: 21 });
    expect(second.body.items.map((p: { id: number; last_visit_at: string | null }) => [p.id, p.last_visit_at]))
      .toEqual([[1, at(MONDAY, '09:00')]]);
  });

  it('HMS-4 REQ-10: the list stays newest first across pages', async () => {
    const ids = [
      ...(await request(app).get('/api/patients')).body.items,
      ...(await request(app).get('/api/patients?page=2')).body.items,
    ].map((p: { id: number }) => p.id);
    expect(ids).toHaveLength(21);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
});

/** HMS-4: Cancelled, No-show and Scheduled appointments never count as a visit. */
describe.skipIf(!pgAvailable())('patient list last visit: other statuses (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  let later: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    later = testApp(db.pool, () => new Date(at(TUESDAY, '10:20')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-4, REQ-5, REQ-6: later Cancelled, No-show and Scheduled appointments leave the Completed one', async () => {
    const done = (await book(app, 1, 2, MONDAY, '09:00')).body;
    const missed = (await book(app, 1, 2, TUESDAY, '09:00')).body;
    const cancelled = (await book(app, 1, 2, TUESDAY, '09:30')).body;
    await book(app, 1, 2, TUESDAY, '10:00');
    expect((await request(later).post(`/api/appointments/${done.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect((await request(later).post(`/api/appointments/${missed.id}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect((await request(later).post(`/api/appointments/${cancelled.id}/cancel`).send({ reason: 'Patient requested' })).body)
      .toMatchObject({ status: 'CANCELLED' });
    expect(await lastOf(app, 2)).toBe(at(MONDAY, '09:00'));
  });
});
