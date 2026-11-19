import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

type OnDuty = {
  doctorId: number;
  fullName: string;
  department: string;
  booked: number;
  free: number;
  nextFreeAt: string | null;
  nextFreeLabel: string | null;
};

const SATURDAY = '2026-10-24';

const onDutyOf = async (app: Express, query = ''): Promise<OnDuty[]> => {
  const res = await request(app).get(`/api/dashboard${query}`);
  expect(res.status).toBe(200);
  return res.body.onDuty as OnDuty[];
};

const clockAt = (db: TestDb, day: string, hhmm: string): Express => testApp(db.pool, () => new Date(at(day, hhmm)));

/**
 * HMS-23: GET /api/dashboard returns onDuty, the Active doctors with availability on today's weekday
 * (hospital zone), counted exactly as the day schedule counts today.
 * Fixture: doctor 1 (15 min, Mon–Fri 09:00–12:00), doctor 2 (30 min, Mon 09:00–10:00), plus an invented
 * doctor 3 "Dr. A Test Doctor Three" (30 min, Mon 09:00–10:00) to tie with doctor 2 on free slots.
 */
describe.skipIf(!pgAvailable())('dashboard on duty today (HMS-23)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
    const res = await request(app).post('/api/doctors').send({
      fullName: 'Dr. A Test Doctor Three', specializationId: 1, departmentId: 1, phone: '+91 00000 10003',
      email: 'doctor03@example.com', feePaise: 40000, slotMinutes: 30, availability: [{ weekday: 1, start: '09:00', end: '10:00' }],
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-23 REQ-2, REQ-3, REQ-13: lists each doctor on duty with name, department, counts and next free slot, and nothing else', async () => {
    const rows = await onDutyOf(app); // Monday 08:00, no appointments
    expect(rows[0]).toEqual({
      doctorId: 1, fullName: 'Dr. Test Doctor One', department: 'Outpatient',
      booked: 0, free: 12, nextFreeAt: at(MONDAY, '09:00'), nextFreeLabel: '09:00',
    });
    expect(rows.find((r) => r.doctorId === 2)).toMatchObject({ department: 'Surgery', booked: 0, free: 2, nextFreeLabel: '09:00' });
    expect(JSON.stringify(rows)).not.toMatch(/phone|email|example\.com|\+91/i);
  });

  it('HMS-23 REQ-9: sorts by free slots, most first; ties by doctor name, not by id', async () => {
    const rows = await onDutyOf(app);
    expect(rows.map((r) => [r.fullName, r.free])).toEqual([
      ['Dr. Test Doctor One', 12],
      ['Dr. A Test Doctor Three', 2],
      ['Dr. Test Doctor Two', 2],
    ]);
  });

  it("HMS-23 REQ-2: today is the hospital-local day, so 00:30 Tuesday in Kolkata (19:00 UTC Monday) lists Tuesday's doctors", async () => {
    const tuesdayEarly = clockAt(db, TUESDAY, '00:30');
    expect(at(TUESDAY, '00:30')).toBe('2026-10-19T19:00:00.000Z');
    const rows = await onDutyOf(tuesdayEarly);
    expect(rows.map((r) => r.doctorId)).toEqual([1]);
    expect(rows[0]).toMatchObject({ free: 12, nextFreeAt: at(TUESDAY, '09:00'), nextFreeLabel: '09:00' });
  });

  it('HMS-23 REQ-10: on a day with no availability onDuty is empty', async () => {
    expect(await onDutyOf(clockAt(db, SATURDAY, '10:00'))).toEqual([]);
  });

  it('HMS-23 REQ-12: the Period selector does not change onDuty', async () => {
    const today = await onDutyOf(app);
    expect(await onDutyOf(app, '?period=7d')).toEqual(today);
    expect(await onDutyOf(app, '?period=30d')).toEqual(today);
  });

  it('HMS-23 REQ-5, REQ-6: a slot that starts exactly now is neither free nor the next free slot', async () => {
    const rows = await onDutyOf(clockAt(db, MONDAY, '09:30'));
    // Doctor 1: 09:00, 09:15 and 09:30 have passed; 09:45..11:45 remain free.
    expect(rows.find((r) => r.doctorId === 1)).toMatchObject({ booked: 0, free: 9, nextFreeAt: at(MONDAY, '09:45'), nextFreeLabel: '09:45' });
  });

  it('HMS-23 REQ-7: a doctor whose slots have all passed is still listed with 0 free and no next slot', async () => {
    const rows = await onDutyOf(clockAt(db, MONDAY, '09:30'));
    expect(rows.find((r) => r.doctorId === 2)).toEqual({
      doctorId: 2, fullName: 'Dr. Test Doctor Two', department: 'Surgery', booked: 0, free: 0, nextFreeAt: null, nextFreeLabel: null,
    });
  });

  it('HMS-23 REQ-9 edge: when every doctor has 0 free slots, all are listed in name order', async () => {
    const rows = await onDutyOf(clockAt(db, MONDAY, '12:00'));
    expect(rows.map((r) => [r.fullName, r.free, r.nextFreeLabel])).toEqual([
      ['Dr. A Test Doctor Three', 0, null],
      ['Dr. Test Doctor One', 0, null],
      ['Dr. Test Doctor Two', 0, null],
    ]);
  });

  it("HMS-23 REQ-4: with Completed, No-show and Cancelled appointments, counts equal the doctor's day schedule", async () => {
    const started = clockAt(db, MONDAY, '09:20');
    const completed = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    const noShow = (await book(app, 1, 2, MONDAY, '09:15')).body.id;
    const cancelled = (await book(app, 1, 1, MONDAY, '09:45')).body.id;
    expect((await request(started).post(`/api/appointments/${completed}/complete`).send({})).body).toMatchObject({ status: 'COMPLETED' });
    expect((await request(started).post(`/api/appointments/${noShow}/no-show`).send({})).body).toMatchObject({ status: 'NO_SHOW' });
    expect((await request(started).post(`/api/appointments/${cancelled}/cancel`).send({ reason: 'Patient requested' })).body)
      .toMatchObject({ status: 'CANCELLED' });

    const row = (await onDutyOf(started)).find((r) => r.doctorId === 1)!;
    const slots = (await request(started).get(`/api/doctors/1/slots?date=${MONDAY}`)).body.slots as Array<{ state: string }>;
    expect(row.booked).toBe(slots.filter((s) => s.state === 'BOOKED').length);
    expect(row.free).toBe(slots.filter((s) => s.state === 'FREE').length);
    // Completed and No-show occupy their slots; the Cancelled 09:45 slot is free again.
    expect(row).toMatchObject({ booked: 2, free: 10, nextFreeLabel: '09:30' });
  });

  it('HMS-23 REQ-6: the next free slot skips a booked slot', async () => {
    const started = clockAt(db, MONDAY, '09:20');
    expect((await book(started, 1, 2, MONDAY, '09:30')).status).toBe(201);
    expect((await onDutyOf(started)).find((r) => r.doctorId === 1)).toMatchObject({
      booked: 3, free: 9, nextFreeAt: at(MONDAY, '09:45'), nextFreeLabel: '09:45',
    });
  });

  it('HMS-23 REQ-11: an Inactive doctor is not listed, even with the most free slots', async () => {
    expect((await request(app).patch('/api/doctors/1').send({ status: 'INACTIVE' })).status).toBe(200);
    expect((await onDutyOf(app)).map((r) => r.doctorId)).not.toContain(1);
  });
});

describe.skipIf(!pgAvailable())('dashboard on duty today, fully booked (HMS-23)', () => {
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

  it('HMS-23 REQ-7: a doctor with every remaining slot booked shows 0 free and no next slot', async () => {
    expect((await book(app, 2, 1, MONDAY, '09:00')).status).toBe(201);
    expect((await book(app, 2, 2, MONDAY, '09:30')).status).toBe(201);
    expect((await onDutyOf(app)).find((r) => r.doctorId === 2)).toMatchObject({ booked: 2, free: 0, nextFreeAt: null, nextFreeLabel: null });
  });
});
