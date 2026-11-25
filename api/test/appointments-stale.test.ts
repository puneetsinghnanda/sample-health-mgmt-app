import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import type { AppContext } from '../src/services';
import { at, loadFixture, NOW, testApp } from './helpers';

/** HMS-34 story days. 3 December 2026 is a Thursday, 6 December a Sunday. */
const DEC3 = '2026-12-03';
const DEC4 = '2026-12-04';
const DEC5 = '2026-12-05';
const DEC6 = '2026-12-06';
const DEC7 = '2026-12-07';

interface HistoryEvent {
  event: string;
  fromStartsAt: string | null;
  toStartsAt: string | null;
  actor: string;
}

/**
 * HMS-34: an appointment still Scheduled 24h after its start is marked Stale by the job.
 * Each test gets its own database, because the job touches every overdue appointment.
 */
describe.skipIf(!pgAvailable())('Stale appointments (HMS-34)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  /** Dr. Test Doctor Three: every day 09:00–12:00, 15-minute slots, so the Sunday 6 December has slots. */
  let doctorId = 0;

  const setClock = (day: string, hhmm: string): void => {
    clock = new Date(at(day, hhmm));
  };
  /** Runs the Stale job once, as the hourly timer does, at local `hhmm` on `day`. */
  const runJob = async (day: string, hhmm: string): Promise<number> => {
    setClock(day, hhmm);
    return (app.locals.ctx as AppContext).services.appointments.markStale('system');
  };
  const appointment = async (id: number) => (await request(app).get(`/api/appointments/${id}`)).body;
  /** Books doctor 3 for `patientId` while the clock is still at NOW, then restores the clock. */
  const bookAt = async (day: string, hhmm: string, patientId = 1): Promise<number> => {
    const before = clock;
    clock = NOW;
    try {
      const res = await request(app).post('/api/appointments').send({ doctorId, patientId, startsAt: at(day, hhmm), reason: 'Check-up' });
      expect(res.status).toBe(201);
      return res.body.id as number;
    } finally {
      clock = before;
    }
  };
  /** A Stale appointment that started at 10:00 on 3 December. */
  const staleAppointment = async (): Promise<number> => {
    const id = await bookAt(DEC3, '10:00');
    expect(await runJob(DEC4, '10:01')).toBe(1);
    expect((await appointment(id)).status).toBe('STALE');
    return id;
  };

  beforeEach(async () => {
    clock = NOW;
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
    const res = await request(app).post('/api/doctors').send({
      fullName: 'Dr. Test Doctor Three', specializationId: 1, departmentId: 1, phone: '+91 00000 10003',
      feePaise: 50000, slotMinutes: 15,
      availability: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })),
    });
    expect(res.status).toBe(201);
    doctorId = res.body.id;
  });
  afterEach(async () => {
    await db.drop();
  });

  describe('S-1: the job marks an appointment left open Stale', () => {
    it('HMS-34 REQ-1/REQ-2 (S-1 AC1): one minute past 24h after its start, the job marks it Stale with actor system', async () => {
      const id = await bookAt(DEC3, '10:00');
      expect(await runJob(DEC4, '10:01')).toBe(1);
      const a = await appointment(id);
      expect(a.status).toBe('STALE');
      expect(a.startsAt).toBe(at(DEC3, '10:00'));
      expect(a.history.at(-1)).toMatchObject({ event: 'STALE', actor: 'system', fromStartsAt: null, toStartsAt: null });
    });

    it('HMS-34 REQ-2 edge (S-1 AC2): one minute before 24h after its start it is still Scheduled', async () => {
      const id = await bookAt(DEC3, '10:00');
      expect(await runJob(DEC4, '09:59')).toBe(0);
      const a = await appointment(id);
      expect(a.status).toBe('SCHEDULED');
      expect(a.history.map((e: HistoryEvent) => e.event)).toEqual(['BOOKED']);
    });

    it('HMS-34 REQ-2 edge: exactly 24h after its start it is Stale', async () => {
      const id = await bookAt(DEC3, '10:00');
      expect(await runJob(DEC4, '10:00')).toBe(1);
      expect((await appointment(id)).status).toBe('STALE');
    });

    it('HMS-34 REQ-3 (S-1 AC3): an appointment that has not started yet stays Scheduled', async () => {
      const id = await bookAt(DEC6, '10:00');
      expect(await runJob(DEC4, '10:01')).toBe(0);
      expect((await appointment(id)).status).toBe('SCHEDULED');
    });

    it('HMS-34 REQ-1: marks every overdue appointment, each with one STALE event, and a second run changes nothing', async () => {
      const first = await bookAt(DEC3, '10:00', 1);
      const second = await bookAt(DEC3, '10:15', 2);
      const later = await bookAt(DEC3, '10:30', 1);
      expect(await runJob(DEC4, '10:16')).toBe(2);
      expect(await runJob(DEC4, '10:20')).toBe(0);
      for (const id of [first, second]) {
        const a = await appointment(id);
        expect(a.status).toBe('STALE');
        expect(a.history.filter((e: HistoryEvent) => e.event === 'STALE')).toHaveLength(1);
      }
      expect((await appointment(later)).status).toBe('SCHEDULED');
    });
  });

  describe('S-2: an appointment closed or moved within the day is not marked Stale', () => {
    it('HMS-34 REQ-4 (S-2 AC1): marked Completed at 09:59 on 4 December, it stays Completed', async () => {
      const id = await bookAt(DEC3, '10:00');
      setClock(DEC4, '09:59');
      expect((await request(app).post(`/api/appointments/${id}/complete`)).status).toBe(200);
      expect(await runJob(DEC4, '10:01')).toBe(0);
      expect((await appointment(id)).status).toBe('COMPLETED');
    });

    it('HMS-34 REQ-5 (S-2 AC2): rescheduled at 09:59 on 4 December to 6 December, it stays Scheduled at the new time', async () => {
      const id = await bookAt(DEC3, '10:00');
      setClock(DEC4, '09:59');
      const moved = await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') });
      expect(moved.status).toBe(200);
      expect(await runJob(DEC4, '10:01')).toBe(0);
      expect(await appointment(id)).toMatchObject({ status: 'SCHEDULED', startsAt: at(DEC6, '10:00') });
    });

    it('HMS-34 REQ-6 (S-2 AC3): cancelled at 09:59 on 4 December, it stays Cancelled', async () => {
      const id = await bookAt(DEC3, '10:00');
      setClock(DEC4, '09:59');
      expect((await request(app).post(`/api/appointments/${id}/cancel`).send({ reason: 'Patient requested' })).status).toBe(200);
      expect(await runJob(DEC4, '10:01')).toBe(0);
      expect((await appointment(id)).status).toBe('CANCELLED');
    });

    it('HMS-34 REQ-6 (S-2 AC4): marked No-show at 09:59 on 4 December, it stays No-show', async () => {
      const id = await bookAt(DEC3, '10:00');
      setClock(DEC4, '09:59');
      expect((await request(app).post(`/api/appointments/${id}/no-show`)).status).toBe(200);
      expect(await runJob(DEC4, '10:01')).toBe(0);
      expect((await appointment(id)).status).toBe('NO_SHOW');
    });
  });

  describe('S-3: staff can still close a Stale appointment', () => {
    it('HMS-34 REQ-7 (S-3 AC1): a Stale appointment can be marked Completed', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/complete`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.history.at(-1)).toMatchObject({ event: 'COMPLETED', actor: 'staff' });
    });

    it('HMS-34 REQ-8 (S-3 AC2): a Stale appointment can be marked No-show', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/no-show`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NO_SHOW');
    });

    it('HMS-34 REQ-9 (S-3 AC3): a Stale appointment can be cancelled with a reason, which it shows', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/cancel`).send({ reason: 'Patient requested' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Patient requested' });
    });

    it('HMS-34 REQ-9 error: cancelling a Stale appointment without a reason is rejected and it stays Stale', async () => {
      const id = await staleAppointment();
      const res = await request(app).post(`/api/appointments/${id}/cancel`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.fields.reason).toBeTruthy();
      expect((await appointment(id)).status).toBe('STALE');
    });

    it('HMS-34 REQ-7 error: once a Stale appointment is Completed it can no longer change', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      await request(app).post(`/api/appointments/${id}/complete`);
      expect((await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') })).status).toBe(409);
      expect((await request(app).post(`/api/appointments/${id}/cancel`).send({ reason: 'x' })).status).toBe(409);
      expect(await runJob(DEC5, '11:00')).toBe(0);
      expect((await appointment(id)).status).toBe('COMPLETED');
    });

    it('HMS-34 REQ-7 error: closing an unknown appointment is still 404', async () => {
      setClock(DEC4, '11:00');
      expect((await request(app).post('/api/appointments/9999/complete')).status).toBe(404);
    });
  });

  describe('S-4: staff can reschedule a Stale appointment', () => {
    it('HMS-34 REQ-10 (S-4 AC1): rescheduled to a free slot at 10:00 on 6 December, it is Scheduled there', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'SCHEDULED', startsAt: at(DEC6, '10:00') });
      expect(res.body.history.at(-1)).toMatchObject({ event: 'RESCHEDULED', fromStartsAt: at(DEC3, '10:00'), toStartsAt: at(DEC6, '10:00') });
    });

    it('HMS-34 REQ-15 (S-4 AC2): the rescheduled appointment is still Scheduled when the job runs at 10:01 on 5 December', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') });
      expect(await runJob(DEC5, '10:01')).toBe(0);
      expect(await appointment(id)).toMatchObject({ status: 'SCHEDULED', startsAt: at(DEC6, '10:00') });
    });

    it('HMS-34 REQ-2 edge: a rescheduled appointment left open becomes Stale again 24h after its new start', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') });
      expect(await runJob(DEC7, '09:59')).toBe(0);
      expect(await runJob(DEC7, '10:01')).toBe(1);
      const a = await appointment(id);
      expect(a.status).toBe('STALE');
      expect(a.history.map((e: HistoryEvent) => e.event)).toEqual(['BOOKED', 'STALE', 'RESCHEDULED', 'STALE']);
    });

    it('HMS-34 REQ-10 error: rescheduling a Stale appointment to a past time is rejected and it stays Stale', async () => {
      const id = await staleAppointment();
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC4, '10:00') });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.startsAt).toMatch(/future/);
      expect(await appointment(id)).toMatchObject({ status: 'STALE', startsAt: at(DEC3, '10:00') });
    });

    it('HMS-34 REQ-10 error: rescheduling a Stale appointment into a taken slot is 409 and it stays Stale', async () => {
      const id = await staleAppointment();
      await bookAt(DEC6, '10:00', 2);
      setClock(DEC4, '11:00');
      const res = await request(app).post(`/api/appointments/${id}/reschedule`).send({ startsAt: at(DEC6, '10:00') });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toBe('This slot is no longer available');
      expect(await appointment(id)).toMatchObject({ status: 'STALE', startsAt: at(DEC3, '10:00') });
    });
  });

  describe('S-5: Stale on the appointment list, the appointment and the dashboard', () => {
    it('HMS-34 REQ-11 (S-5 AC1/AC2): the list and the appointment itself carry status STALE', async () => {
      const id = await staleAppointment();
      const list = await request(app).get(`/api/appointments?doctorId=${doctorId}`);
      expect(list.status).toBe(200);
      expect(list.body.items.find((a: { id: number }) => a.id === id).status).toBe('STALE');
      expect((await appointment(id)).status).toBe('STALE');
    });

    it('HMS-34 REQ-12 (S-5 AC3): filtering the list by status STALE lists only the Stale appointment', async () => {
      const stale = await staleAppointment();
      const scheduled = await bookAt(DEC6, '10:00');
      const res = await request(app).get('/api/appointments?status=STALE');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items.map((a: { id: number }) => a.id)).toEqual([stale]);
      const others = await request(app).get('/api/appointments?status=SCHEDULED');
      expect(others.body.items.map((a: { id: number }) => a.id)).toEqual([scheduled]);
    });

    it('HMS-34 REQ-12 error: an unknown status filter is still rejected with a field error', async () => {
      const res = await request(app).get('/api/appointments?status=STALLED');
      expect(res.status).toBe(400);
      expect(res.body.error.fields.status).toBeTruthy();
    });

    it('HMS-34 REQ-13 (S-5 AC4): the dashboard keeps the same tiles and counts when an appointment turns Stale', async () => {
      await bookAt(DEC3, '10:00');
      setClock(DEC4, '10:01');
      const before = (await request(app).get('/api/dashboard?period=7d')).body;
      expect(await runJob(DEC4, '10:01')).toBe(1);
      const after = (await request(app).get('/api/dashboard?period=7d')).body;
      expect(Object.keys(after.totals).sort()).toEqual(
        ['appointmentsToday', 'cancelled', 'completed', 'doctors', 'noShows', 'patients', 'upcoming'],
      );
      expect(after.totals).toEqual(before.totals);
      expect(JSON.stringify(after.totals)).not.toMatch(/stale/i);
    });
  });

  describe('S-7: Stale on the patient page; the doctor page is unchanged', () => {
    it('HMS-34 REQ-11 (S-7 AC1): the patient page lists the Stale one as STALE and the other as SCHEDULED', async () => {
      const stale = await staleAppointment();
      const scheduled = await bookAt(DEC6, '10:00');
      const res = await request(app).get('/api/patients/1');
      expect(res.status).toBe(200);
      const status = (id: number) => res.body.appointments.find((a: { id: number }) => a.id === id)?.status;
      expect(status(stale)).toBe('STALE');
      expect(status(scheduled)).toBe('SCHEDULED');
    });

    it('HMS-34 REQ-11 (S-7 AC2): the doctor page lists the upcoming Scheduled one and not the Stale one', async () => {
      const stale = await staleAppointment();
      const scheduled = await bookAt(DEC6, '10:00', 2);
      const res = await request(app).get(`/api/doctors/${doctorId}`);
      expect(res.status).toBe(200);
      const ids = res.body.upcoming.map((a: { id: number }) => a.id);
      expect(ids).toEqual([scheduled]);
      expect(ids).not.toContain(stale);
    });
  });
});
