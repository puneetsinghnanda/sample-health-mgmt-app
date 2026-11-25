import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import type { AppContext } from '../src/services';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';
const FRIDAY = '2026-10-23';

/** HMS-34: Scheduled appointments 24h past their start become Stale. Its own database; the tests run in order. */
describe.skipIf(!pgAvailable())('Stale appointments (HMS-34)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const ids: Record<string, number> = {};
  const markStale = (): Promise<number> => (app.locals.ctx as AppContext).services.appointments.markStale('system');
  const get = async (id: number) => (await request(app).get(`/api/appointments/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // All booked at NOW (Monday 08:00). Monday ones start at 10:00 or later, so none is 24h past before Tuesday 10:00.
    const slots: Array<[string, number, string, string]> = [
      ['open', 1, MONDAY, '10:00'],
      ['completed', 2, MONDAY, '10:15'],
      ['moved', 1, MONDAY, '10:30'],
      ['cancelled', 2, MONDAY, '10:45'],
      ['noShow', 1, MONDAY, '11:00'],
      ['staleComplete', 2, MONDAY, '11:15'],
      ['staleNoShow', 1, MONDAY, '11:30'],
      ['staleCancel', 2, MONDAY, '11:45'],
      ['future', 2, WEDNESDAY, '10:00'],
    ];
    for (const [name, patientId, day, hhmm] of slots) {
      const res = await book(app, 1, patientId, day, hhmm);
      if (res.status !== 201) throw new Error(`${name}: ${res.status} ${JSON.stringify(res.body)}`);
      ids[name] = res.body.id;
    }
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-34 REQ-2 (S-1 AC2) edge: one minute before 24h after the start the appointment is still Scheduled', async () => {
    clock = new Date(at(TUESDAY, '09:59'));
    expect(await markStale()).toBe(0);
    expect((await get(ids.open!)).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-4/REQ-5/REQ-6/REQ-16 (S-2): staff close or move appointments within the day', async () => {
    clock = new Date(at(TUESDAY, '09:59'));
    expect((await request(app).post(`/api/appointments/${ids.completed}/complete`)).body.status).toBe('COMPLETED');
    const moved = await request(app).post(`/api/appointments/${ids.moved}/reschedule`).send({ startsAt: at(THURSDAY, '10:00') });
    expect(moved.body).toMatchObject({ status: 'SCHEDULED', startsAt: at(THURSDAY, '10:00') });
    const cancelled = await request(app).post(`/api/appointments/${ids.cancelled}/cancel`).send({ reason: 'Test reason 001' });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect((await request(app).post(`/api/appointments/${ids.noShow}/no-show`)).body.status).toBe('NO_SHOW');
  });

  it('HMS-34 REQ-1/REQ-2/REQ-3 (S-1 AC1): one minute past 24h the job marks the appointment Stale with actor system', async () => {
    clock = new Date(at(TUESDAY, '10:01'));
    expect(await markStale()).toBe(1);
    const open = await get(ids.open!);
    expect(open.status).toBe('STALE');
    expect(open.history.at(-1)).toMatchObject({ event: 'STALE', actor: 'system' });
  });

  it('HMS-34 REQ-4/REQ-5/REQ-6/REQ-16 (S-2 AC1-AC4): appointments closed or moved within the day are not Stale', async () => {
    expect((await get(ids.completed!)).status).toBe('COMPLETED');
    expect(await get(ids.moved!)).toMatchObject({ status: 'SCHEDULED', startsAt: at(THURSDAY, '10:00') });
    expect((await get(ids.cancelled!)).status).toBe('CANCELLED');
    expect((await get(ids.noShow!)).status).toBe('NO_SHOW');
  });

  it('HMS-34 REQ-2 (S-1 AC3) edge: a future Scheduled appointment stays Scheduled', async () => {
    expect((await get(ids.future!)).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-1 edge: a second run at the same time changes nothing and adds no history', async () => {
    const before = (await get(ids.open!)).history.length;
    expect(await markStale()).toBe(0);
    expect((await get(ids.open!)).history.length).toBe(before);
  });

  it('HMS-34 REQ-12/REQ-13 (S-5 AC1, AC3): the list shows Stale and filters by it', async () => {
    const stale = (await request(app).get('/api/appointments?status=STALE')).body;
    expect(stale.items.map((a: { id: number }) => a.id)).toEqual([ids.open]);
    expect(stale.items[0].status).toBe('STALE');
    const scheduled = (await request(app).get('/api/appointments?status=SCHEDULED')).body;
    expect(scheduled.items.map((a: { id: number }) => a.id)).not.toContain(ids.open);
  });

  it('HMS-34 REQ-13 error: an unknown status filter is still rejected with a field error', async () => {
    const res = await request(app).get('/api/appointments?status=STALEST');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.status).toBeTruthy();
  });

  it('HMS-34 REQ-12 (S-7 AC1): the patient page shows Stale for the Stale appointment and Scheduled for the other', async () => {
    const patient = (await request(app).get('/api/patients/1')).body;
    const status = (id: number) => patient.appointments.find((a: { id: number }) => a.id === id)?.status;
    expect(status(ids.open!)).toBe('STALE');
    expect(status(ids.moved!)).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-12 (S-7 AC2): the doctor page lists the Scheduled appointment and not the Stale one', async () => {
    const upcoming = (await request(app).get('/api/doctors/1')).body.upcoming.map((a: { id: number }) => a.id);
    expect(upcoming).toContain(ids.future);
    expect(upcoming).not.toContain(ids.open);
  });

  it('HMS-34 REQ-14 (S-5 AC4): the dashboard has the same tiles and no Stale tile', async () => {
    const totals = (await request(app).get('/api/dashboard')).body.totals;
    expect(Object.keys(totals).some((k) => /stale/i.test(k))).toBe(false);
    expect(totals).toHaveProperty('noShows');
    expect(totals).toHaveProperty('upcoming');
  });

  it('HMS-34 REQ-7/REQ-8/REQ-9 (S-3): staff can still complete, mark No-show or cancel a Stale appointment', async () => {
    clock = new Date(at(TUESDAY, '12:00'));
    expect(await markStale()).toBe(3);
    for (const name of ['staleComplete', 'staleNoShow', 'staleCancel']) expect((await get(ids[name]!)).status).toBe('STALE');
    expect((await request(app).post(`/api/appointments/${ids.staleComplete}/complete`)).body.status).toBe('COMPLETED');
    expect((await request(app).post(`/api/appointments/${ids.staleNoShow}/no-show`)).body.status).toBe('NO_SHOW');
    const res = await request(app).post(`/api/appointments/${ids.staleCancel}/cancel`).send({ reason: 'Test reason 002' });
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Test reason 002' });
  });

  it('HMS-34 REQ-9 error: cancelling a Stale appointment still needs a reason', async () => {
    const res = await request(app).post(`/api/appointments/${ids.open}/cancel`).send({});
    expect(res.status).toBe(400);
    expect((await get(ids.open!)).status).toBe('STALE');
  });

  it('HMS-34 REQ-7 error: a Stale appointment once closed can no longer change', async () => {
    const res = await request(app).post(`/api/appointments/${ids.staleComplete}/reschedule`).send({ startsAt: at(FRIDAY, '10:15') });
    expect(res.status).toBe(409);
  });

  it('HMS-34 REQ-10 error: a Stale appointment cannot be moved into the past', async () => {
    const res = await request(app).post(`/api/appointments/${ids.open}/reschedule`).send({ startsAt: at(MONDAY, '09:00') });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.startsAt).toMatch(/future/);
    expect((await get(ids.open!)).status).toBe('STALE');
  });

  it('HMS-34 REQ-10/REQ-11 (S-4 AC1): rescheduling a Stale appointment makes it Scheduled at the new time', async () => {
    const res = await request(app).post(`/api/appointments/${ids.open}/reschedule`).send({ startsAt: at(FRIDAY, '10:00') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SCHEDULED', startsAt: at(FRIDAY, '10:00') });
    expect(res.body.history.at(-1)).toMatchObject({ event: 'RESCHEDULED', fromStartsAt: at(MONDAY, '10:00'), toStartsAt: at(FRIDAY, '10:00') });
  });

  it('HMS-34 REQ-11 (S-4 AC2): the job a day before the new time leaves it Scheduled', async () => {
    clock = new Date(at(THURSDAY, '10:01'));
    await markStale();
    expect((await get(ids.open!)).status).toBe('SCHEDULED');
    clock = NOW;
  });
});
