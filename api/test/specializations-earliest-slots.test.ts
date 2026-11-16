import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, loadFixture, MONDAY, NOW, testApp, TUESDAY } from './helpers';

type Entry = {
  id: number;
  code: string;
  fullName: string;
  departmentName: string;
  slot: { date: string; start: string; label: string } | null;
};
type Block = { weekday: number; start: string; end: string };

const weekdays = (start: string, end: string): Block[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start, end }));

/** Adds an invented doctor and returns its id. */
async function addDoctor(app: Express, fullName: string, specializationId: number, availability: Block[]): Promise<number> {
  const res = await request(app).post('/api/doctors').send({
    fullName, specializationId, departmentId: 1, phone: '+91 00000 19999', feePaise: 10000, slotMinutes: 15, availability,
  });
  if (res.status !== 201) throw new Error(`doctor ${fullName}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

/**
 * HMS-11: GET /api/specializations/:id/earliest-slots. Fixture: specialization 1 General Medicine has doctor 1
 * (15-minute slots, Mon–Fri 09:00–12:00, Outpatient); specialization 2 Cardiology has doctor 2 (30-minute slots,
 * Mon 09:00–10:00 only, Surgery). NOW is Monday 19 October 2026, 08:00 in Asia/Kolkata.
 */
describe.skipIf(!pgAvailable())('earliest free slot per specialization (HMS-11)', () => {
  let db: TestDb;
  let app: Express;
  let clock = NOW;
  const earliest = (id: number | string) => request(app).get(`/api/specializations/${id}/earliest-slots`);
  const withClock = async (when: string, work: () => Promise<void>): Promise<void> => {
    const before = clock;
    try {
      clock = new Date(when);
      await work();
    } finally {
      clock = before;
    }
  };

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => clock);
    await loadFixture(app);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-11 REQ-1/REQ-3/REQ-4 (S-1 AC1, AC2): lists the Active doctor with its earliest free slot', async () => {
    const res = await earliest(2);
    expect(res.status).toBe(200);
    // Asia/Kolkata is UTC+05:30, so 09:00 local on 19 Oct is 03:30 UTC on 19 Oct.
    expect(res.body.items).toEqual([
      {
        id: 2, code: 'D-0002', fullName: 'Dr. Test Doctor Two', departmentName: 'Surgery',
        slot: { date: MONDAY, start: '2026-10-19T03:30:00.000Z', label: '09:00' },
      },
    ]);
  });

  it('HMS-11 REQ-6 (S-1 AC1): the slot is the first FREE slot the day schedule shows', async () => {
    const entry: Entry = (await earliest(1)).body.items[0];
    const day = (await request(app).get(`/api/doctors/1/slots?date=${MONDAY}`)).body;
    const firstFree = day.slots.find((s: { state: string }) => s.state === 'FREE');
    expect(entry.slot).toEqual({ date: MONDAY, start: firstFree.start, label: firstFree.label });
  });

  it('HMS-11 REQ-10 (S-4 AC1): the answer is { items } with no paging fields', async () => {
    expect(Object.keys((await earliest(1)).body)).toEqual(['items']);
  });

  it('HMS-11 REQ-14/REQ-15 (S-5 AC1): entries carry only id, code, fullName, departmentName and slot', async () => {
    const res = await earliest(2);
    const entry: Entry = res.body.items[0];
    expect(Object.keys(entry).sort()).toEqual(['code', 'departmentName', 'fullName', 'id', 'slot']);
    expect(Object.keys(entry.slot!).sort()).toEqual(['date', 'label', 'start']);
    expect(JSON.stringify(res.body)).not.toContain('+91 00000 10002');
  });

  it('HMS-11 REQ-6 (S-1 AC3, AC4, S-5 AC2): a booked first slot is skipped, a cancelled one is free again, no patient data', async () => {
    const appt = (await book(app, 2, 1, MONDAY, '09:00')).body;
    expect(appt.id).toBeTruthy();
    const res = await earliest(2);
    expect(res.body.items[0].slot).toEqual({ date: MONDAY, start: at(MONDAY, '09:30'), label: '09:30' });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Test Patient One');
    expect(text).not.toContain('Penicillin');
    expect(text).not.toContain('Invented note');
    await request(app).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'Test cancellation' });
    expect((await earliest(2)).body.items[0].slot.label).toBe('09:00');
  });

  it('HMS-11 REQ-7 (S-2 AC3): a slot that has already started is never returned', async () => {
    await withClock(at(MONDAY, '09:05'), async () => {
      expect((await earliest(2)).body.items[0].slot).toEqual({ date: MONDAY, start: at(MONDAY, '09:30'), label: '09:30' });
    });
  });

  it('HMS-11 REQ-2 (S-2 AC1): a slot on today+6 is inside the window', async () => {
    // From Tuesday 20 Oct, today+6 is Monday 26 Oct, the next day doctor 2 works.
    await withClock(at(TUESDAY, '08:00'), async () => {
      expect((await earliest(2)).body.items[0].slot).toEqual({ date: '2026-10-26', start: at('2026-10-26', '09:00'), label: '09:00' });
    });
  });

  it('HMS-11 REQ-2/REQ-5 (S-2 AC2): a slot on today+7 is outside the window, so slot is null', async () => {
    // At 10:00 on Monday 19 Oct both Monday slots have started; the next ones are on 26 Oct, the 7th day after today.
    await withClock(at(MONDAY, '10:00'), async () => {
      expect((await earliest(2)).body.items[0].slot).toBeNull();
    });
  });

  it('HMS-11 REQ-2 (S-2 AC4): days follow the hospital zone across UTC midnight', async () => {
    // 2026-10-19T19:00Z is 00:30 on Tuesday 20 Oct in Asia/Kolkata; the UTC date is still 19 Oct.
    await withClock('2026-10-19T19:00:00Z', async () => {
      expect((await earliest(2)).body.items[0].slot?.date).toBe('2026-10-26');
    });
  });

  it('HMS-11 REQ-12 (S-4 AC3) error: an unknown specialization is 404', async () => {
    const res = await earliest(9999);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('HMS-11 REQ-12 edge: a malformed id is 400', async () => {
    const res = await earliest('abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  // S-6 AC1-AC3: the day schedule (APT-10) answers exactly as before for each partition, read through /slots.
  // Doctor 1 has 15-minute slots 09:00-12:00 on weekdays, so a day has twelve slots, 09:00 to 11:45; NOW is before all of them.
  type DaySlot = { label: string; state: string; appointment?: unknown };
  const daySchedule = async (date: string): Promise<{ slots: DaySlot[]; appointments: unknown[] }> =>
    (await request(app).get(`/api/doctors/1/slots?date=${date}`)).body;

  it('HMS-11 REQ-16 (S-6 AC2): the day schedule for a date with no appointment is all FREE', async () => {
    const day = await daySchedule('2026-10-21');
    expect(day.slots[0]!.label).toBe('09:00');
    expect(day.slots[day.slots.length - 1]!.label).toBe('11:45');
    expect(day.slots).toHaveLength(12);
    expect(day.slots.every((s) => s.state === 'FREE' && s.appointment === undefined)).toBe(true);
    expect(day.appointments).toEqual([]);
  });

  it('HMS-11 REQ-16 (S-6 AC3): the day schedule for a date with only a Cancelled appointment is all FREE', async () => {
    const appt = (await book(app, 1, 1, '2026-10-22', '09:00')).body;
    expect((await request(app).post(`/api/appointments/${appt.id}/cancel`).send({ reason: 'Test cancellation' })).status).toBe(200);
    const day = await daySchedule('2026-10-22');
    expect(day.slots).toHaveLength(12);
    expect(day.slots.every((s) => s.state === 'FREE' && s.appointment === undefined)).toBe(true);
    expect(day.appointments).toEqual([]);
  });

  it('HMS-11 REQ-16 (S-6 AC1): the day schedule for a date with a booked appointment marks only that slot BOOKED', async () => {
    expect((await book(app, 1, 2, '2026-10-23', '10:00')).status).toBe(201);
    const day = await daySchedule('2026-10-23');
    expect(day.slots.filter((s) => s.state === 'BOOKED').map((s) => s.label)).toEqual(['10:00']);
    expect(day.slots.filter((s) => s.state === 'FREE')).toHaveLength(11);
    expect(day.appointments).toHaveLength(1);
  });

  it('HMS-11 REQ-16 (S-6 AC4): a returned FREE slot books through the existing booking endpoint', async () => {
    const slot = (await earliest(2)).body.items[0].slot;
    const res = await request(app)
      .post('/api/appointments')
      .send({ doctorId: 2, patientId: 2, startsAt: slot.start, reason: 'Check-up' });
    expect(res.status).toBe(201);
    // The booked slot is no longer offered; the next one is.
    expect((await earliest(2)).body.items[0].slot.label).toBe('09:30');
  });

  it('HMS-11 REQ-16 (S-6): the specializations list on the same router still answers as before', async () => {
    const res = await request(app).get('/api/specializations');
    expect(res.status).toBe(200);
    expect(res.body.items.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['General Medicine', 'Cardiology']));
  });

  it('HMS-11 REQ-1/REQ-11 (S-4 AC2): Inactive doctors are left out, leaving { items: [] }', async () => {
    expect((await request(app).patch('/api/doctors/2').send({ status: 'INACTIVE' })).status).toBe(200);
    expect((await earliest(2)).body).toEqual({ items: [] });
  });

  it('HMS-11 REQ-13 (S-4 AC4) error: an Inactive specialization is 400 "specialization is Inactive"', async () => {
    expect((await request(app).patch('/api/specializations/1').send({ status: 'INACTIVE' })).status).toBe(200);
    const res = await earliest(1);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('specialization is Inactive');
  });
});

/** HMS-11 ordering: its own database, with extra invented General Medicine doctors. */
describe.skipIf(!pgAvailable())('earliest free slot ordering (HMS-11)', () => {
  let db: TestDb;
  let app: Express;
  const sameIds: number[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => NOW);
    await loadFixture(app);
    // Doctor 1 (Dr. Test Doctor One) starts at 09:00 on Monday, like "dr. alpha", "Dr. Beta" and both "Dr. Same".
    await addDoctor(app, 'Dr. Beta', 1, weekdays('09:00', '12:00'));
    await addDoctor(app, 'dr. alpha', 1, weekdays('09:00', '12:00'));
    sameIds.push(await addDoctor(app, 'Dr. Same', 1, weekdays('09:00', '12:00')));
    sameIds.push(await addDoctor(app, 'Dr. Same', 1, weekdays('09:00', '12:00')));
    await addDoctor(app, 'Dr. Zed', 1, [{ weekday: 1, start: '08:30', end: '09:00' }]);
    await addDoctor(app, 'Dr. Bob', 1, []);
    await addDoctor(app, 'dr. amy', 1, []);
    await addDoctor(app, 'dr. kim', 1, []);
    await addDoctor(app, 'Dr. Kim', 1, []);
    // S-1 AC5: an Inactive doctor whose 08:15 slot is earlier than every Active doctor's.
    const early = await addDoctor(app, 'Dr. Early Inactive', 1, [{ weekday: 1, start: '08:15', end: '08:30' }]);
    expect((await request(app).patch(`/api/doctors/${early}`).send({ status: 'INACTIVE' })).status).toBe(200);
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-11 REQ-8/REQ-9/REQ-17 (S-3 AC1-AC5, S-1 AC5): earliest slot first, then name ignoring case, then id; no-slot entries last', async () => {
    const items: Entry[] = (await request(app).get('/api/specializations/1/earliest-slots')).body.items;
    expect(items.map((e) => e.fullName)).toEqual([
      'Dr. Zed', 'dr. alpha', 'Dr. Beta', 'Dr. Same', 'Dr. Same', 'Dr. Test Doctor One', 'dr. amy', 'Dr. Bob', 'dr. kim', 'Dr. Kim',
    ]);
    expect(items[0]!.slot!.label).toBe('08:30');
    expect(items.slice(6).every((e) => e.slot === null)).toBe(true);
    // S-3 AC3: same name and same slot start, lower id first.
    expect(items.filter((e) => e.fullName === 'Dr. Same').map((e) => e.id)).toEqual(sameIds);
    expect(sameIds[0]!).toBeLessThan(sameIds[1]!);
    // S-1 AC5: the Inactive doctor with the earliest slot is not listed.
    expect(items.some((e) => e.fullName === 'Dr. Early Inactive')).toBe(false);
  });
});

/** HMS-11 S-4 AC1: one more Active doctor than the 20 per page list convention, all returned unpaged. */
describe.skipIf(!pgAvailable())('earliest free slot is unpaged (HMS-11)', () => {
  let db: TestDb;
  let app: Express;
  let specializationId = 0;

  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => NOW);
    await loadFixture(app);
    const spec = await request(app).post('/api/specializations').send({ name: 'Dermatology' });
    specializationId = spec.body.id;
    for (let i = 1; i <= 21; i++) {
      await addDoctor(app, `Dr. Test Unpaged ${String(i).padStart(2, '0')}`, specializationId, weekdays('09:00', '10:00'));
    }
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-11 REQ-10 (S-4 AC1): the 21st Active doctor is returned, with no page, page_size or total', async () => {
    const body = (await request(app).get(`/api/specializations/${specializationId}/earliest-slots`)).body;
    expect(Object.keys(body)).toEqual(['items']);
    expect(body.items).toHaveLength(21);
    expect(body.items[20].fullName).toBe('Dr. Test Unpaged 21');
  });
});
