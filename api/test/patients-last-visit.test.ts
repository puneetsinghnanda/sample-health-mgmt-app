import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';
const FRIDAY = '2026-10-23';

const lastVisitOf = async (app: Express, patientId: number) =>
  ((await request(app).get('/api/patients')).body.items as Array<{ id: number; last_visit_date: unknown }>)
    .find((p) => p.id === patientId)?.last_visit_date;

/** HMS-4: each patient list item carries the hospital-local day of its latest Completed appointment. */
describe.skipIf(!pgAvailable())('patient list last visit (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-8: is null for a patient with no appointments', async () => {
    expect(await lastVisitOf(app, 1)).toBeNull();
    expect(await lastVisitOf(app, 2)).toBeNull();
  });

  it('HMS-4 REQ-7: a Scheduled appointment does not count', async () => {
    ids.scheduled2 = (await book(app, 1, 2, FRIDAY, '10:00')).body.id;
    expect(await lastVisitOf(app, 2)).toBeNull();
  });

  it('HMS-4 REQ-2, REQ-4: shows the Completed appointment with the latest start, not the last one closed', async () => {
    ids.monday = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    ids.tuesday = (await book(app, 1, 1, TUESDAY, '09:00')).body.id;
    // Close the later appointment first, so ordering by closing time would pick Monday instead.
    const tuesdayClosed = testApp(db.pool, () => new Date(at(TUESDAY, '09:20')));
    expect((await request(tuesdayClosed).post(`/api/appointments/${ids.tuesday}/complete`).send({})).body)
      .toMatchObject({ status: 'COMPLETED' });
    const mondayClosed = testApp(db.pool, () => new Date(at(TUESDAY, '09:30')));
    expect((await request(mondayClosed).post(`/api/appointments/${ids.monday}/complete`).send({})).body)
      .toMatchObject({ status: 'COMPLETED' });
    expect(await lastVisitOf(app, 1)).toBe(TUESDAY);
  });

  it('HMS-4 REQ-5: a later Cancelled appointment does not count', async () => {
    const id = (await book(app, 1, 1, WEDNESDAY, '09:00')).body.id;
    const res = await request(app).post(`/api/appointments/${id}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect(await lastVisitOf(app, 1)).toBe(TUESDAY);
  });

  it('HMS-4 REQ-6: a later No-show appointment does not count', async () => {
    const id = (await book(app, 1, 1, THURSDAY, '09:00')).body.id;
    const started = testApp(db.pool, () => new Date(at(THURSDAY, '09:20')));
    expect((await request(started).post(`/api/appointments/${id}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect(await lastVisitOf(app, 1)).toBe(TUESDAY);
  });

  it('HMS-4 REQ-7: a later Scheduled appointment does not count', async () => {
    await book(app, 1, 1, FRIDAY, '09:00');
    expect(await lastVisitOf(app, 1)).toBe(TUESDAY);
  });

  it('HMS-4 REQ-3: the day is taken in the configured hospital time zone, not in UTC', async () => {
    // Tuesday 09:00 in Kolkata is 03:30 UTC on Tuesday, which is still Monday in New York.
    const newYork = createApp(db.pool, loadConfig({ HOSPITAL_TZ: 'America/New_York' }), () => NOW);
    expect(await lastVisitOf(newYork, 1)).toBe(MONDAY);
    expect(await lastVisitOf(app, 1)).toBe(TUESDAY);
  });

  it('HMS-4 REQ-9, REQ-13: the list keeps its paging shape and sends only the day string', async () => {
    const res = await request(app).get('/api/patients');
    expect(res.body).toMatchObject({ page: 1, page_size: 20, total: 2 });
    const one = (res.body.items as Array<{ id: number; last_visit_date: string | null }>).find((p) => p.id === 1)!;
    expect(one.last_visit_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/last_visit_at|Penicillin|allerg|medical/i);
  });

  it('HMS-4 REQ-10: search still finds the patient and carries the last visit', async () => {
    const items = (await request(app).get('/api/patients?q=patient one')).body.items as Array<{ id: number; last_visit_date: string | null }>;
    expect(items.map((p) => [p.id, p.last_visit_date])).toEqual([[1, TUESDAY]]);
  });

  it('HMS-4 REQ-11: the list stays newest first with the last visit added', async () => {
    const items = (await request(app).get('/api/patients')).body.items as Array<{ id: number }>;
    expect(items.map((p) => p.id)).toEqual([2, 1]);
  });

  it('HMS-4 REQ-9: an invalid page is still rejected and returns no list', async () => {
    const res = await request(app).get('/api/patients?page=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.items).toBeUndefined();
  });

  it('HMS-4 REQ-10: an invalid status filter is still rejected with a field error', async () => {
    const res = await request(app).get('/api/patients?status=SOMETIMES');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['status']);
  });

  it('HMS-4 REQ-9: a page past the end is empty and keeps the total', async () => {
    const res = await request(app).get('/api/patients?page=99');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], page: 99, page_size: 20, total: 2 });
  });
});
