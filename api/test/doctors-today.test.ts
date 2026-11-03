import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

type Row = { id: number; fullName: string; today_count?: number };

const todayOf = async (app: Express, query = '') => {
  const res = await request(app).get(`/api/doctors?with_today=true${query}`);
  expect(res.status).toBe(200);
  return Object.fromEntries((res.body.items as Row[]).map((d) => [d.id, d.today_count]));
};

/** HMS-6: GET /api/doctors?with_today=true adds each doctor's appointments that start today, except Cancelled. */
describe.skipIf(!pgAvailable())('doctors list today count (HMS-6)', () => {
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

  it('HMS-6 REQ-5: a doctor with no appointments today shows 0', async () => {
    expect(await todayOf(app)).toEqual({ 1: 0, 2: 0 });
  });

  it("HMS-6 REQ-2: counts only appointments that start on today's date in the hospital zone", async () => {
    expect((await book(app, 1, 1, MONDAY, '09:00')).status).toBe(201);
    expect((await book(app, 1, 1, MONDAY, '09:15')).status).toBe(201);
    expect((await book(app, 2, 2, MONDAY, '09:00')).status).toBe(201);
    expect((await book(app, 1, 1, TUESDAY, '10:00')).status).toBe(201);
    expect(await todayOf(app)).toEqual({ 1: 2, 2: 1 });
  });

  it('HMS-6 REQ-2: the day follows the clock, so Tuesday counts only Tuesday', async () => {
    const tuesday = testApp(db.pool, () => new Date(at(TUESDAY, '08:00')));
    expect(await todayOf(tuesday)).toEqual({ 1: 1, 2: 0 });
  });

  it('HMS-6 REQ-3: a Cancelled appointment is not counted', async () => {
    const list = (await request(app).get(`/api/appointments?doctorId=1&from=${MONDAY}&to=${MONDAY}`)).body.items as Array<{ id: number }>;
    const res = await request(app).post(`/api/appointments/${list[1]!.id}/cancel`).send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED' });
    expect(await todayOf(app)).toEqual({ 1: 1, 2: 1 });
  });

  it('HMS-6 REQ-3: Completed and No-show appointments still count', async () => {
    const [d1] = (await request(app).get(`/api/appointments?doctorId=1&status=SCHEDULED&from=${MONDAY}&to=${MONDAY}`)).body.items as Array<{ id: number }>;
    const [d2] = (await request(app).get(`/api/appointments?doctorId=2&from=${MONDAY}&to=${MONDAY}`)).body.items as Array<{ id: number }>;
    expect((await request(started).post(`/api/appointments/${d1!.id}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect((await request(started).post(`/api/appointments/${d2!.id}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect(await todayOf(app)).toEqual({ 1: 1, 2: 1 });
  });

  it("HMS-6 REQ-4: the counts add up to the dashboard's Appointments today tile", async () => {
    const counts = Object.values(await todayOf(app)) as number[];
    const tile = (await request(app).get('/api/dashboard')).body.totals.appointmentsToday;
    expect(counts.reduce((a, b) => a + b, 0)).toBe(tile);
  });

  it('HMS-6 REQ-8, REQ-9: keeps 20 per page and the order by name', async () => {
    const res = await request(app).get('/api/doctors?with_today=true');
    expect(res.body).toMatchObject({ page: 1, page_size: 20, total: 2 });
    expect((res.body.items as Row[]).map((d) => d.fullName)).toEqual(['Dr. Test Doctor One', 'Dr. Test Doctor Two']);
  });

  it('HMS-6 REQ-10: filters and search still apply, and the count follows the filtered rows', async () => {
    expect(await todayOf(app, '&q=doctor two')).toEqual({ 2: 1 });
    expect(await todayOf(app, '&departmentId=1')).toEqual({ 1: 1 });
  });

  it('HMS-6 REQ-10: a search with no match returns an empty page', async () => {
    const res = await request(app).get('/api/doctors?with_today=true&q=nobody matches');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0 });
  });

  it('HMS-6: without with_today the list and the detail are unchanged', async () => {
    for (const url of ['/api/doctors', '/api/doctors?with_today=false']) {
      const items = (await request(app).get(url)).body.items as Row[];
      expect(items).toHaveLength(2);
      expect(items.every((d) => !('today_count' in d))).toBe(true);
    }
    expect('today_count' in (await request(app).get('/api/doctors/1')).body).toBe(false);
  });

  it('HMS-6: an invalid with_today is rejected with a field error', async () => {
    const res = await request(app).get('/api/doctors?with_today=yes');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['with_today']);
  });
});
