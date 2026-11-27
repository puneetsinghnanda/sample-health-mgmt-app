import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import type { AppContext } from '../src/services';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

/** HMS-34: the job's actor, as server.ts passes it. */
const SYSTEM = 'system';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';
const FRIDAY = '2026-10-23';
const SATURDAY = '2026-10-24';

/** An instant `ms` after the ISO time `iso`. */
const after = (iso: string, ms: number): Date => new Date(Date.parse(iso) + ms);

type Event = { event: string; actor: string };

describe.skipIf(!pgAvailable())('Stale appointments (HMS-34)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const ids: Record<string, number> = {};

  /** Runs the background job once at the current clock, as the hourly timer does. */
  const runJob = (): Promise<number> => (app.locals.ctx as AppContext).services.appointments.markStale(SYSTEM);
  const detail = async (id: number) => (await request(app).get(`/api/appointments/${id}`)).body;
  const staleEvents = (history: Event[]): Event[] => history.filter((e) => e.event === 'STALE');

  /** Books at the fixed NOW, so every Monday or later slot is still in the future. */
  async function bookAtNow(name: string, doctorId: number, patientId: number, day: string, hhmm: string): Promise<string> {
    clock = NOW;
    const res = await book(app, doctorId, patientId, day, hhmm);
    expect(res.status).toBe(201);
    ids[name] = res.body.id;
    return res.body.startsAt as string;
  }

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-34 REQ-2 edge (S-1 AC2): one minute before 24h after its start the appointment is still Scheduled', async () => {
    const start = await bookAtNow('a', 1, 1, MONDAY, '09:00');
    clock = after(start, DAY - MINUTE);
    expect(await runJob()).toBe(0);
    const a = await detail(ids.a!);
    expect(a.status).toBe('SCHEDULED');
    expect(staleEvents(a.history)).toEqual([]);
  });

  it('HMS-34 REQ-1/REQ-2/REQ-5/REQ-8 (S-1 AC1, AC4): one minute after 24h the job marks it Stale with a STALE event by system', async () => {
    const start = (await detail(ids.a!)).startsAt as string;
    clock = after(start, DAY + MINUTE);
    expect(await runJob()).toBe(1);
    const a = await detail(ids.a!);
    expect(a.status).toBe('STALE');
    expect(a.history.at(-1)).toMatchObject({ event: 'STALE', actor: SYSTEM });
    expect(Number.isNaN(Date.parse(a.history.at(-1).at))).toBe(false);
  });

  it('HMS-34 REQ-2 edge (S-1 AC3): after the local day of the start has ended but before 24h it is still Scheduled', async () => {
    await bookAtNow('b', 1, 2, MONDAY, '11:45');
    clock = new Date(at(TUESDAY, '00:30'));
    await runJob();
    expect((await detail(ids.b!)).status).toBe('SCHEDULED');
  });

  it('HMS-34 REQ-3/REQ-7 (S-2 AC1): a Completed appointment stays Completed and gets no STALE event', async () => {
    const start = await bookAtNow('c', 2, 1, MONDAY, '09:30');
    clock = new Date(at(MONDAY, '14:00'));
    expect((await request(app).post(`/api/appointments/${ids.c}/complete`)).body.status).toBe('COMPLETED');
    clock = after(start, DAY + MINUTE);
    await runJob();
    const c = await detail(ids.c!);
    expect(c.status).toBe('COMPLETED');
    expect(staleEvents(c.history)).toEqual([]);
  });

  it('HMS-34 REQ-4 (S-2 AC2): an appointment rescheduled in time stays Scheduled at its new time', async () => {
    const start = await bookAtNow('d', 1, 1, MONDAY, '10:00');
    clock = new Date(at(MONDAY, '14:00'));
    const moved = await request(app).post(`/api/appointments/${ids.d}/reschedule`).send({ startsAt: at(THURSDAY, '10:00') });
    expect(moved.status).toBe(200);
    clock = after(start, DAY + MINUTE);
    await runJob();
    const d = await detail(ids.d!);
    expect(d).toMatchObject({ status: 'SCHEDULED', startsAt: at(THURSDAY, '10:00') });
    expect(staleEvents(d.history)).toEqual([]);
  });

  it('HMS-34 REQ-7 (S-2 AC3, AC4): Cancelled and No-show appointments are never marked Stale', async () => {
    await bookAtNow('e', 1, 2, MONDAY, '10:30');
    expect((await request(app).post(`/api/appointments/${ids.e}/cancel`).send({ reason: 'Test reason 001' })).status).toBe(200);
    const start = await bookAtNow('f', 1, 2, MONDAY, '11:00');
    clock = new Date(at(MONDAY, '11:05'));
    expect((await request(app).post(`/api/appointments/${ids.f}/no-show`)).body.status).toBe('NO_SHOW');
    clock = after(start, DAY + MINUTE);
    await runJob();
    const e = await detail(ids.e!);
    const f = await detail(ids.f!);
    expect(e.status).toBe('CANCELLED');
    expect(f.status).toBe('NO_SHOW');
    expect(staleEvents(e.history)).toEqual([]);
    expect(staleEvents(f.history)).toEqual([]);
  });

  it('HMS-34 REQ-6/REQ-10/REQ-11 (S-3 AC1, AC2, AC3): staff complete, mark no-show and cancel Stale appointments', async () => {
    await bookAtNow('g', 1, 1, TUESDAY, '09:00');
    await bookAtNow('h', 1, 1, TUESDAY, '09:15');
    await bookAtNow('i', 1, 1, TUESDAY, '09:30');
    clock = new Date(at(WEDNESDAY, '10:00'));
    await runJob();
    for (const name of ['g', 'h', 'i']) expect((await detail(ids[name]!)).status).toBe('STALE');

    const completed = await request(app).post(`/api/appointments/${ids.g}/complete`);
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.history.at(-1)).toMatchObject({ event: 'COMPLETED', actor: 'staff' });

    const noShow = await request(app).post(`/api/appointments/${ids.h}/no-show`);
    expect(noShow.status).toBe(200);
    expect(noShow.body.status).toBe('NO_SHOW');

    const cancelled = await request(app).post(`/api/appointments/${ids.i}/cancel`).send({ reason: 'Test reason 002' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Test reason 002' });
  });

  it('HMS-34 REQ-11 error: cancelling a Stale appointment still needs a reason', async () => {
    expect((await detail(ids.b!)).status).toBe('STALE');
    const res = await request(app).post(`/api/appointments/${ids.b}/cancel`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.fields.reason).toBeTruthy();
    expect((await detail(ids.b!)).status).toBe('STALE');
  });

  it('HMS-34 REQ-7 error: a Stale appointment closed by staff can no longer change', async () => {
    const res = await request(app).post(`/api/appointments/${ids.g}/reschedule`).send({ startsAt: at(FRIDAY, '11:00') });
    expect(res.status).toBe(409);
    expect((await request(app).post(`/api/appointments/${ids.g}/cancel`).send({ reason: 'x' })).status).toBe(409);
  });

  it('HMS-34 REQ-12 error: a Stale appointment cannot be rescheduled into the past and stays Stale', async () => {
    const res = await request(app).post(`/api/appointments/${ids.a}/reschedule`).send({ startsAt: at(MONDAY, '09:15') });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.startsAt).toMatch(/future/);
    expect((await detail(ids.a!)).status).toBe('STALE');
  });

  it('HMS-34 REQ-12/REQ-13 (S-4 AC1, AC2, AC3): a rescheduled Stale appointment is Scheduled again, and Stale again 24h after its new start', async () => {
    const moved = await request(app).post(`/api/appointments/${ids.a}/reschedule`).send({ startsAt: at(FRIDAY, '10:00') });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ status: 'SCHEDULED', startsAt: at(FRIDAY, '10:00') });
    expect(moved.body.history.at(-1)).toMatchObject({ event: 'RESCHEDULED', actor: 'staff' });

    clock = new Date(at(THURSDAY, '10:00'));
    await runJob();
    expect((await detail(ids.a!)).status).toBe('SCHEDULED');

    clock = after(at(FRIDAY, '10:00'), DAY + MINUTE);
    expect(clock.toISOString()).toBe(at(SATURDAY, '10:01'));
    await runJob();
    const a = await detail(ids.a!);
    expect(a.status).toBe('STALE');
    expect(staleEvents(a.history)).toHaveLength(2);
  });

  it('HMS-34 REQ-5 edge: running the job again marks nothing twice', async () => {
    expect(await runJob()).toBe(0);
    expect(staleEvents((await detail(ids.a!)).history)).toHaveLength(2);
  });

  it('HMS-34 REQ-1: the list filters by status STALE, and an unknown status is still rejected', async () => {
    const res = await request(app).get('/api/appointments?status=STALE');
    expect(res.status).toBe(200);
    const items = res.body.items as Array<{ id: number; status: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === 'STALE')).toBe(true);
    expect(items.map((i) => i.id)).toContain(ids.a);
    expect((await request(app).get('/api/appointments?status=OVERDUE')).status).toBe(400);
  });
});
