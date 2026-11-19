import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, testApp, TUESDAY } from './helpers';

const WEDNESDAY = '2026-10-21';
const THURSDAY = '2026-10-22';

const summaryOf = async (app: Express, patientId: number) => (await request(app).get(`/api/patients/${patientId}`)).body.visitSummary;

/** HMS-24: GET /api/patients/:id carries visitSummary over all of the patient's appointments. */
describe.skipIf(!pgAvailable())('patient visit summary (HMS-24)', () => {
  let db: TestDb;
  let app: Express;
  /** Tuesday 11:00 in Kolkata: Monday's and Tuesday morning's appointments have started and can be closed. */
  let later: Express;
  const ids: Record<string, number> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    later = testApp(db.pool, () => new Date(at(TUESDAY, '11:00')));
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-24 REQ-12: a patient with no appointments has zero counts and no last visit', async () => {
    expect(await summaryOf(app, 2)).toEqual({ completed: 0, noShow: 0, cancelled: 0, upcoming: 0, lastVisit: null });
  });

  it('HMS-24 REQ-2..REQ-5: counts Completed, No-show, Cancelled and upcoming Scheduled appointments', async () => {
    // Booked in this order on purpose: the most recent Completed one (Tuesday) gets the lower id.
    ids.tueDone = (await book(app, 1, 1, TUESDAY, '09:00')).body.id;
    ids.monDone = (await book(app, 2, 1, MONDAY, '09:30')).body.id;
    ids.tueMissed = (await book(app, 1, 1, TUESDAY, '10:00')).body.id;
    ids.wedCancelled = (await book(app, 1, 1, WEDNESDAY, '09:00')).body.id;
    ids.thuUpcoming = (await book(app, 1, 1, THURSDAY, '09:00')).body.id;
    ids.monOpen = (await book(app, 1, 1, MONDAY, '09:00')).body.id;
    for (const id of Object.values(ids)) expect(id).toBeGreaterThan(0);

    expect((await request(later).post(`/api/appointments/${ids.tueDone}/complete`).send({})).body.status).toBe('COMPLETED');
    expect((await request(later).post(`/api/appointments/${ids.monDone}/complete`).send({})).body.status).toBe('COMPLETED');
    expect((await request(later).post(`/api/appointments/${ids.tueMissed}/no-show`).send({})).body.status).toBe('NO_SHOW');
    const cancel = await request(app).post(`/api/appointments/${ids.wedCancelled}/cancel`).send({ reason: 'Invented reason 001' });
    expect(cancel.body.status).toBe('CANCELLED');

    // At Tuesday 11:00 the Monday 09:00 appointment is past but still Scheduled: not upcoming, not counted (S-1 AC3).
    // The Wednesday appointment lies in the future but is Cancelled: cancelled, not upcoming (S-1 AC5).
    expect(await summaryOf(later, 1)).toMatchObject({ completed: 2, noShow: 1, cancelled: 1, upcoming: 1 });
  });

  it('HMS-24 REQ-5 edge: upcoming follows now, so a Scheduled appointment counts only while its start is after now', async () => {
    // At Monday 08:00 both the Monday 09:00 and the Thursday appointments are still ahead.
    expect((await summaryOf(app, 1)).upcoming).toBe(2);
    // One minute after the Thursday start, nothing is upcoming any more.
    const afterThursday = testApp(db.pool, () => new Date(at(THURSDAY, '09:01')));
    expect((await summaryOf(afterThursday, 1)).upcoming).toBe(0);
  });

  it('HMS-24 REQ-8..REQ-10: lastVisit is the most recent Completed appointment, not the latest booked or the later No-show', async () => {
    expect((await summaryOf(later, 1)).lastVisit).toEqual({
      appointmentId: ids.tueDone, date: TUESDAY, doctorName: 'Dr. Test Doctor One',
    });
  });

  it('HMS-24 REQ-6: counts cover every doctor and date', async () => {
    const all = (await request(later).get('/api/appointments?patientId=1')).body;
    const completed = all.items.filter((a: { status: string }) => a.status === 'COMPLETED');
    expect(new Set(completed.map((a: { doctor: { id: number } }) => a.doctor.id))).toEqual(new Set([1, 2]));
    expect((await summaryOf(later, 1)).completed).toBe(completed.length);
  });

  it('HMS-24 REQ-13: the summary carries only counts and the last visit id, day and doctor name', async () => {
    const summary = await summaryOf(later, 1);
    expect(Object.keys(summary).sort()).toEqual(['cancelled', 'completed', 'lastVisit', 'noShow', 'upcoming']);
    expect(Object.keys(summary.lastVisit).sort()).toEqual(['appointmentId', 'date', 'doctorName']);
    expect(JSON.stringify(summary)).not.toMatch(/Check-up|Invented reason|Penicillin|Invented note/);
  });

  it('HMS-24 REQ-11: a patient whose only closed appointment is a No-show has no last visit', async () => {
    const missed = (await book(app, 2, 2, MONDAY, '09:00')).body.id;
    expect((await request(later).post(`/api/appointments/${missed}/no-show`).send({})).body.status).toBe('NO_SHOW');
    expect(await summaryOf(later, 2)).toMatchObject({ completed: 0, noShow: 1, lastVisit: null });
  });

  it('HMS-24 REQ-8 edge: lastVisit.date is the hospital-local day, not the UTC day', async () => {
    // A doctor seeing patients just after local midnight: Tuesday 00:30 in Kolkata is 19:00 UTC on Monday.
    const doctor = await request(app).post('/api/doctors').send({
      fullName: 'Dr. Test Doctor Three', specializationId: 1, departmentId: 1, phone: '+91 00000 10003',
      feePaise: 50000, slotMinutes: 30, availability: [{ weekday: 2, start: '00:00', end: '02:00' }],
    });
    expect(doctor.status).toBe(201);
    const night = await book(app, doctor.body.id, 2, TUESDAY, '00:30');
    expect(night.body.startsAt).toBe('2026-10-19T19:00:00.000Z');
    expect((await request(later).post(`/api/appointments/${night.body.id}/complete`).send({})).body.status).toBe('COMPLETED');
    expect((await summaryOf(later, 2)).lastVisit).toEqual({
      appointmentId: night.body.id, date: TUESDAY, doctorName: 'Dr. Test Doctor Three',
    });
  });

  it('HMS-24 REQ-14 error: an unknown patient is still 404', async () => {
    expect((await request(app).get('/api/patients/999')).status).toBe(404);
  });
});
