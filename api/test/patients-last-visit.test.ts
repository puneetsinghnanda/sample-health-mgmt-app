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

  it('HMS-4 REQ-13: a patient with a Completed visit still has no medical history in the list', async () => {
    const list = await request(app).get('/api/patients');
    expect(list.body.items.find((p: { id: number }) => p.id === 1).lastVisitAt).not.toBeNull();
    expect(JSON.stringify(list.body)).not.toMatch(/Penicillin|Invented note|allerg|medical/i);
  });

  it('HMS-4 REQ-10: an invalid list filter is still rejected with a field error', async () => {
    const res = await request(app).get('/api/patients?status=SOMETIMES');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['status']);
  });
});

/** HMS-4 S-3: with visits on the 1st and 20th rows, paging and search still give one row per patient. */
describe.skipIf(!pgAvailable())('patient list last visit: paging and search (HMS-4)', () => {
  let db: TestDb;
  let app: Express;
  let later: Express;
  type Item = { id: number; lastVisitAt: string | null };
  const ids = (items: Item[]) => items.map((p) => p.id);

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    later = testApp(db.pool, () => new Date(at(TUESDAY, '11:00')));
    await loadFixture(app);
    // Patients 3 to 21, so the list holds 21 patients (newest first: 21, 20, ..., 1).
    for (let n = 3; n <= 21; n += 1) {
      const code = String(n).padStart(3, '0');
      const res = await request(app).post('/api/patients').send({
        fullName: `Test Patient ${code}`, dateOfBirth: '1990-01-01', gender: 'OTHER', phone: `+91 00000 30${code}`,
      });
      expect(res.status).toBe(201);
    }
    // The 1st row (patient 21) and the 20th row (patient 2) each get two Completed, one Cancelled and one No-show.
    const visits = async (patientId: number, times: [string, string, string, string]) => {
      const booked: number[] = [];
      for (const t of times) booked.push((await book(app, 1, patientId, MONDAY, t)).body.id as number);
      const [a, b, c, d] = booked as [number, number, number, number];
      await request(later).post(`/api/appointments/${a}/complete`).send({});
      await request(later).post(`/api/appointments/${b}/complete`).send({});
      await request(app).post(`/api/appointments/${c}/cancel`).send({ reason: 'Patient requested' });
      await request(later).post(`/api/appointments/${d}/no-show`).send({});
    };
    await visits(21, ['10:00', '10:15', '10:30', '10:45']);
    await visits(2, ['09:00', '09:15', '09:30', '09:45']);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-4 REQ-9, REQ-11: page one holds 20 rows, page two only the 21st, each patient once', async () => {
    const one = (await request(app).get('/api/patients')).body;
    const two = (await request(app).get('/api/patients?page=2')).body;
    expect(one).toMatchObject({ page: 1, page_size: 20, total: 21 });
    expect(one.items).toHaveLength(20);
    expect(ids(two.items)).toEqual([1]);
    const all = [...ids(one.items), ...ids(two.items)];
    expect(new Set(all).size).toBe(21);
    expect(ids(one.items)[0]).toBe(21);
    expect(ids(one.items)[19]).toBe(2);
  });

  it('HMS-4 REQ-2, REQ-3: the rows with several appointments show their latest Completed start', async () => {
    const items = (await request(app).get('/api/patients')).body.items as Item[];
    expect(items.find((p) => p.id === 21)!.lastVisitAt).toBe(at(MONDAY, '10:15'));
    expect(items.find((p) => p.id === 2)!.lastVisitAt).toBe(at(MONDAY, '09:15'));
    expect(items.find((p) => p.id === 20)!.lastVisitAt).toBeNull();
  });

  it('HMS-4 REQ-10: search returns each matching patient once, with its Last visit value', async () => {
    const items = (await request(app).get('/api/patients?q=Test Patient 02')).body.items as Item[];
    expect(ids(items)).toEqual([21, 20]);
    expect(items[0]!.lastVisitAt).toBe(at(MONDAY, '10:15'));
    expect(items[1]!.lastVisitAt).toBeNull();
  });

  it('HMS-4 REQ-11, REQ-15: the order stays newest first, not by Last visit', async () => {
    const items = (await request(app).get('/api/patients')).body.items as Item[];
    expect(ids(items).slice(0, 3)).toEqual([21, 20, 19]);
  });
});
