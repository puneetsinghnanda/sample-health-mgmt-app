import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

describe.skipIf(!pgAvailable())('appointment management (PRD §4.3)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('APT-1: books one of the free slots shown for the day', async () => {
    const day = await request(app).get(`/api/doctors/1/slots?date=${MONDAY}`);
    expect(day.body.slots).toHaveLength(12);
    const slot = day.body.slots[0];
    expect(slot).toMatchObject({ label: '09:00', state: 'FREE' });
    const res = await request(app).post('/api/appointments').send({ doctorId: 1, patientId: 1, startsAt: slot.start });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'A-000001', status: 'SCHEDULED', startsAt: at(MONDAY, '09:00'), endsAt: at(MONDAY, '09:15') });
  });

  it('APT-2: refuses times off the slot grid, outside availability, in the past or already taken', async () => {
    expect((await book(app, 1, 2, MONDAY, '09:05')).body.error.fields.startsAt).toMatch(/slots/);
    expect((await book(app, 1, 2, MONDAY, '13:00')).body.error.fields.startsAt).toMatch(/slots/);
    expect((await book(app, 1, 2, '2026-10-18', '09:00')).body.error.fields.startsAt).toMatch(/future/);
    const taken = await book(app, 1, 2, MONDAY, '09:00');
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toBe('This slot is no longer available');
  });

  it('APT-3: a patient cannot be in two Scheduled appointments at once, with any doctors', async () => {
    const res = await book(app, 2, 1, MONDAY, '09:00');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/patient already has an appointment/);
  });

  it('APT-4: two simultaneous bookings of one slot leave exactly one appointment', async () => {
    const results = await Promise.all([book(app, 1, 1, TUESDAY, '10:00'), book(app, 1, 2, TUESDAY, '10:00')]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const day = await request(app).get(`/api/appointments?doctorId=1&from=${TUESDAY}&to=${TUESDAY}`);
    expect(day.body.total).toBe(1);
  });

  it('APT-5: reschedules to another free slot, keeping the id and the previous time in history', async () => {
    const res = await request(app).post('/api/appointments/1/reschedule').send({ startsAt: at(MONDAY, '11:00') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, startsAt: at(MONDAY, '11:00') });
    expect(res.body.history.at(-1)).toMatchObject({ event: 'RESCHEDULED', fromStartsAt: at(MONDAY, '09:00'), toStartsAt: at(MONDAY, '11:00') });
    const day = (await request(app).get(`/api/doctors/1/slots?date=${MONDAY}`)).body;
    expect(day.slots.find((s: { label: string }) => s.label === '09:00').state).toBe('FREE');
  });

  it('APT-6: cancels with a required reason, and the slot is free again', async () => {
    expect((await request(app).post('/api/appointments/1/cancel').send({})).status).toBe(400);
    const res = await request(app).post('/api/appointments/1/cancel').send({ reason: 'Patient requested' });
    expect(res.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Patient requested' });
    expect((await book(app, 1, 2, MONDAY, '11:00')).status).toBe(201);
  });

  it('APT-7: marks Completed or No-show only after the start time', async () => {
    const appt = (await book(app, 2, 2, MONDAY, '09:30')).body;
    expect((await request(app).post(`/api/appointments/${appt.id}/complete`)).status).toBe(409);
    clock = new Date(at(MONDAY, '09:31'));
    expect((await request(app).post(`/api/appointments/${appt.id}/complete`)).body.status).toBe('COMPLETED');
    const other = (await request(app).get('/api/appointments?doctorId=1&status=SCHEDULED')).body.items[0];
    clock = new Date(other.startsAt);
    expect((await request(app).post(`/api/appointments/${other.id}/no-show`)).body.status).toBe('NO_SHOW');
    clock = NOW;
  });

  it('APT-8: Completed, Cancelled and No-show appointments cannot change', async () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      const appt = (await request(app).get(`/api/appointments?status=${status}`)).body.items[0];
      const res = await request(app).post(`/api/appointments/${appt.id}/reschedule`).send({ startsAt: at(TUESDAY, '11:30') });
      expect(res.status).toBe(409);
      expect((await request(app).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'x' })).status).toBe(409);
    }
  });

  it('APT-9: lists by doctor or patient, with date range and status, ordered by start', async () => {
    const byDoctor = await request(app).get(`/api/appointments?doctorId=1&from=${MONDAY}&to=${TUESDAY}`);
    expect(byDoctor.body.page_size).toBe(20);
    const starts = byDoctor.body.items.map((a: { startsAt: string }) => a.startsAt);
    expect(starts).toEqual([...starts].sort());
    const cancelled = await request(app).get('/api/appointments?patientId=1&status=CANCELLED');
    expect(cancelled.body.items.map((a: { id: number }) => a.id)).toEqual([1]);
    expect((await request(app).get('/api/appointments?from=2026-10-20&to=2026-10-19')).status).toBe(400);
  });

  it('HMS-8 REQ-8: any other status value is a 400 on status', async () => {
    const res = await request(app).get('/api/appointments?status=NOT_A_STATUS');
    expect(res.status).toBe(400);
    expect(res.body.error.fields.status).toMatch(/NOT_CANCELLED/);
  });

  it('APT-10: shows a doctor’s day with booked and free slots', async () => {
    const day = (await request(app).get(`/api/doctors/1/slots?date=${TUESDAY}`)).body;
    const ten = day.slots.find((s: { label: string }) => s.label === '10:00');
    expect(ten.state).toBe('BOOKED');
    expect(ten.appointment.patient.fullName).toMatch(/Test Patient/);
    expect(day.slots.filter((s: { state: string }) => s.state === 'FREE').length).toBe(11);
    expect((await request(app).get('/api/doctors/1/slots?date=tomorrow')).status).toBe(400);
  });

  it('APT-11: records every change with time and actor', async () => {
    const history = (await request(app).get('/api/appointments/1')).body.history;
    expect(history.map((e: { event: string }) => e.event)).toEqual(['BOOKED', 'RESCHEDULED', 'CANCELLED']);
    expect(history.every((e: { actor: string; at: string }) => e.actor === 'staff' && !Number.isNaN(Date.parse(e.at)))).toBe(true);
    expect(history[2].note).toBe('Patient requested');
  });
});

describe.skipIf(!pgAvailable())('HMS-8 Any except Cancelled (status=NOT_CANCELLED)', () => {
  let db: TestDb;
  let app: Express;
  const WEDNESDAY = '2026-10-21';
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  /** Inserts a row directly, so closed statuses and off-grid times can be set up without the booking rules. */
  async function row(doctorId: number, patientId: number, startsAt: string, status: string): Promise<number> {
    const ends = new Date(Date.parse(startsAt) + 15 * 60_000).toISOString();
    const res = await db.pool.query<{ id: number }>(
      `INSERT INTO appointment (doctor_id, patient_id, starts_at, ends_at, status, cancellation_reason, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'staff', 'staff') RETURNING id`,
      [doctorId, patientId, startsAt, ends, status, status === 'CANCELLED' ? 'Test reason' : null],
    );
    return res.rows[0]!.id;
  }

  it('HMS-8 REQ-7, REQ-8: lists Scheduled, Completed and No-show but not Cancelled, even when Cancelled starts last', async () => {
    const scheduled = await row(2, 1, at(WEDNESDAY, '09:00'), 'SCHEDULED');
    const completed = await row(2, 2, at(WEDNESDAY, '09:30'), 'COMPLETED');
    const noShow = await row(2, 1, at(WEDNESDAY, '10:00'), 'NO_SHOW');
    await row(2, 2, at(WEDNESDAY, '11:00'), 'CANCELLED');
    const res = await request(app).get(`/api/appointments?doctorId=2&status=NOT_CANCELLED&from=${WEDNESDAY}&to=${WEDNESDAY}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((a: { id: number }) => a.id)).toEqual([scheduled, completed, noShow]);
    expect(res.body.total).toBe(3);
    const any = await request(app).get(`/api/appointments?doctorId=2&from=${WEDNESDAY}&to=${WEDNESDAY}`);
    expect(any.body.total).toBe(4);
  });

  it("HMS-8 REQ-9, REQ-10: today's NOT_CANCELLED list equals the doctors list's Today count, including 00:30 local", async () => {
    // Asia/Kolkata = UTC+05:30, so 00:30 local on MONDAY is 19:00 UTC on the previous UTC date.
    const early = await row(1, 1, at(MONDAY, '00:30'), 'SCHEDULED');
    expect(new Date(at(MONDAY, '00:30')).toISOString()).toBe('2026-10-18T19:00:00.000Z');
    const nine = await row(1, 2, at(MONDAY, '09:00'), 'SCHEDULED');
    await row(1, 1, at(MONDAY, '09:15'), 'CANCELLED');
    await row(1, 2, at('2026-10-18', '23:45'), 'SCHEDULED'); // the evening before: not today
    const doctors = (await request(app).get('/api/doctors?with_today=true')).body;
    const todayCount = doctors.items.find((d: { id: number }) => d.id === 1).today_count;
    const list = (await request(app).get(`/api/appointments?doctorId=1&status=NOT_CANCELLED&from=${MONDAY}&to=${MONDAY}`)).body;
    expect(todayCount).toBe(2);
    expect(list.total).toBe(todayCount);
    expect(list.items.map((a: { id: number }) => a.id)).toEqual([early, nine]);
  });
});
