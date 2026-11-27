import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import type { AppContext } from '../src/services';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';

/** HMS-34: Scheduled appointments still open 24h after their start time become Stale. */
describe.skipIf(!pgAvailable())('stale appointments (HMS-34)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const ids: Record<string, number> = {};
  const markStale = (): Promise<number> =>
    (app.locals.ctx as AppContext).services.appointments.markStale('system');
  const get = async (id: number) => (await request(app).get(`/api/appointments/${id}`)).body;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    // Doctor 1, Monday; each case uses its own slot so the patient never overlaps.
    ids.open = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    ids.completed = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    ids.cancelled = (await book(app, 1, 1, MONDAY, '09:30')).body.id;
    ids.noShow = (await book(app, 1, 2, MONDAY, '09:45')).body.id;
    ids.moved = (await book(app, 1, 1, MONDAY, '10:00')).body.id;
    ids.future = (await book(app, 1, 2, WEDNESDAY, '09:00')).body.id;
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-34 REQ-2 edge (S-1 AC2): one minute before 24h after the start time, nothing becomes Stale', async () => {
    clock = new Date(at(TUESDAY, '08:59'));
    expect(await markStale()).toBe(0);
    expect((await get(ids.open)).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-4/REQ-5/REQ-6/REQ-16 (S-2): closed or moved within the day', async () => {
    clock = new Date(at(TUESDAY, '08:59'));
    expect((await request(app).post(`/api/appointments/${ids.completed}/complete`)).body.status).toBe('COMPLETED');
    expect((await request(app).post(`/api/appointments/${ids.cancelled}/cancel`).send({ reason: 'Test reason 001' })).body.status).toBe('CANCELLED');
    expect((await request(app).post(`/api/appointments/${ids.noShow}/no-show`)).body.status).toBe('NO_SHOW');
    const moved = await request(app).post(`/api/appointments/${ids.moved}/reschedule`).send({ startsAt: at(WEDNESDAY, '10:00') });
    expect(moved.body).toMatchObject({ status: 'SCHEDULED', startsAt: at(WEDNESDAY, '10:00') });
  });

  it('HMS-34 REQ-1/REQ-2/REQ-3 (S-1 AC1, S-2): after 24h only the appointment left open becomes Stale', async () => {
    clock = new Date(at(TUESDAY, '10:01'));
    expect(await markStale()).toBe(1);
    expect((await get(ids.open)).status).toBe('STALE');
    expect((await get(ids.completed)).status).toBe('COMPLETED');
    expect((await get(ids.cancelled)).status).toBe('CANCELLED');
    expect((await get(ids.noShow)).status).toBe('NO_SHOW');
    expect((await get(ids.moved)).status).toBe('SCHEDULED');
    // S-1 AC3: a Scheduled appointment that has not started yet is untouched.
    expect((await get(ids.future)).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-3: the job records a STALE history event with the actor system', async () => {
    const detail = await get(ids.open);
    expect(detail.history.map((e: { event: string }) => e.event)).toEqual(['BOOKED', 'STALE']);
    expect(detail.history.at(-1).actor).toBe('system');
  });

  it('HMS-34 REQ-12 (S-7 AC1): the patient page lists the Stale appointment with status STALE', async () => {
    const patient = (await request(app).get('/api/patients/1')).body;
    const mine = patient.appointments.find((a: { id: number }) => a.id === ids.open);
    expect(mine.status).toBe('STALE');
    expect(patient.appointments.find((a: { id: number }) => a.id === ids.moved).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-12 regression (S-7 AC2): the doctor page upcoming list still leaves the Stale appointment out', async () => {
    const doctor = (await request(app).get('/api/doctors/1')).body;
    const upcoming = doctor.upcoming.map((a: { id: number }) => a.id);
    expect(upcoming).not.toContain(ids.open);
    expect(upcoming).toEqual(expect.arrayContaining([ids.moved, ids.future]));
  });

  it('HMS-34 REQ-14 (S-5 AC4): the dashboard keeps its counts, none for Stale, and its next list leaves Stale out', async () => {
    const dashboard = (await request(app).get('/api/dashboard')).body;
    expect(Object.keys(dashboard.totals).sort()).toEqual(
      ['appointmentsToday', 'cancelled', 'completed', 'doctors', 'noShows', 'patients', 'upcoming'],
    );
    expect(dashboard.next.map((a: { id: number }) => a.id)).not.toContain(ids.open);
  });

  it('HMS-34 REQ-2 edge: running the job again changes nothing', async () => {
    expect(await markStale()).toBe(0);
    expect((await get(ids.open)).history).toHaveLength(2);
  });

  it('HMS-34 REQ-13 (S-5 AC3): the list filters by status STALE', async () => {
    const res = await request(app).get('/api/appointments?status=STALE');
    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: number }) => a.id)).toEqual([ids.open]);
    expect(res.body.items[0].status).toBe('STALE');
    expect((await request(app).get('/api/appointments?status=STALLED')).status).toBe(400);
  });

  it('HMS-34 REQ-7/REQ-8/REQ-9 (S-3): staff can still close a Stale appointment', async () => {
    clock = new Date(at(TUESDAY, '10:01'));
    const b1 = (await book(app, 1, 1, TUESDAY, '10:15')).body.id;
    const b2 = (await book(app, 1, 2, TUESDAY, '10:30')).body.id;
    const b3 = (await book(app, 1, 1, TUESDAY, '10:45')).body.id;
    clock = new Date(at(WEDNESDAY, '10:46'));
    expect(await markStale()).toBe(3);
    expect((await request(app).post(`/api/appointments/${b1}/complete`)).body.status).toBe('COMPLETED');
    expect((await request(app).post(`/api/appointments/${b2}/no-show`)).body.status).toBe('NO_SHOW');
    expect((await request(app).post(`/api/appointments/${b3}/cancel`).send({})).status).toBe(400);
    const cancelled = await request(app).post(`/api/appointments/${b3}/cancel`).send({ reason: 'Test reason 002' });
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Test reason 002' });
    // APT-8 still holds: once closed, it cannot change again.
    expect((await request(app).post(`/api/appointments/${b1}/no-show`)).status).toBe(409);
  });

  it('HMS-34 REQ-10/REQ-11 (S-4): rescheduling a Stale appointment makes it Scheduled at the new time', async () => {
    clock = new Date(at(WEDNESDAY, '10:46'));
    const past = await request(app).post(`/api/appointments/${ids.open}/reschedule`).send({ startsAt: at(MONDAY, '11:00') });
    expect(past.status).toBe(400);
    const res = await request(app).post(`/api/appointments/${ids.open}/reschedule`).send({ startsAt: at(THURSDAY, '10:00') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'SCHEDULED', startsAt: at(THURSDAY, '10:00') });
    expect(res.body.history.map((e: { event: string }) => e.event)).toEqual(['BOOKED', 'STALE', 'RESCHEDULED']);
    // S-4 AC2: before its new start the job leaves it Scheduled.
    expect(await markStale()).toBe(0);
    expect((await get(ids.open)).status).toBe('SCHEDULED');
  });
});
