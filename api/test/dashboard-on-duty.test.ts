import type { Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { at, book, MONDAY, NOW, testApp, TUESDAY } from './helpers';

type Row = {
  doctorId: number;
  fullName: string;
  department: { name: string; status: string };
  booked: number;
  free: number;
  nextFree: { start: string; label: string } | null;
};
type Block = { weekday: number; start: string; end: string };
type Slot = { start: string; label: string; state: 'FREE' | 'BOOKED' | 'PAST' };

const MON = 1;
const TUE = 2;
const FRI = 5;
const SAT = 6;
const SATURDAY = '2026-11-28';
/** 04:00 local on Saturday 28 November 2026 in Asia/Kolkata is 22:30 UTC on Friday 27 November. */
const SATURDAY_0400 = new Date('2026-11-27T22:30:00Z');

interface Scenario {
  db: TestDb;
  app: Express;
  setClock(at: string | Date): void;
  doctor(fullName: string, availability: Block[], opts?: { slotMinutes?: number; departmentId?: number }): Promise<number>;
  booked(doctorId: number, patientId: number, day: string, hhmm: string): Promise<number>;
  onDuty(query?: string): Promise<Row[]>;
}

/** A fresh database per test with invented reference data and three patients, but no doctors. */
async function scenario(now: string | Date): Promise<Scenario> {
  const db = await freshDatabase();
  let clock = new Date(now);
  const app = testApp(db.pool, () => clock);
  const created = async (url: string, body: object): Promise<number> => {
    const res = await request(app).post(url).send(body);
    if (res.status !== 201) throw new Error(`${url}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.id as number;
  };
  await created('/api/departments', { name: 'Outpatient' });
  await created('/api/departments', { name: 'Surgery' });
  await created('/api/specializations', { name: 'General Medicine' });
  for (const n of [1, 2, 3]) {
    await created('/api/patients', {
      fullName: `Test Patient 00${n}`, dateOfBirth: '1990-05-01', gender: 'FEMALE', phone: `+91 00000 2000${n}`,
    });
  }
  let doctors = 0;
  return {
    db,
    app,
    setClock: (t) => {
      clock = new Date(t);
    },
    doctor: (fullName, availability, opts = {}) => {
      doctors += 1;
      return created('/api/doctors', {
        fullName, specializationId: 1, departmentId: opts.departmentId ?? 1,
        phone: `+91 00000 1${String(doctors).padStart(4, '0')}`, email: `doctor${doctors}@example.com`,
        feePaise: 50000, slotMinutes: opts.slotMinutes ?? 30, availability,
      });
    },
    booked: async (doctorId, patientId, day, hhmm) => {
      const res = await book(app, doctorId, patientId, day, hhmm);
      if (res.status !== 201) throw new Error(`book ${day} ${hhmm}: ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.id as number;
    },
    onDuty: async (query = '') => {
      const res = await request(app).get(`/api/dashboard${query}`);
      expect(res.status).toBe(200);
      return res.body.onDuty as Row[];
    },
  };
}

async function withScenario(now: string | Date, test: (s: Scenario) => Promise<void>): Promise<void> {
  const s = await scenario(now);
  try {
    await test(s);
  } finally {
    await s.db.drop();
  }
}

const block = (weekday: number, start: string, end: string): Block => ({ weekday, start, end });
const names = (rows: Row[]) => rows.map((r) => r.fullName);

/** HMS-23: the dashboard's "On duty today" rows (GET /api/dashboard onDuty). Each test has its own database and clock. */
describe.skipIf(!pgAvailable())('dashboard on duty today (HMS-23)', () => {
  it('HMS-23 REQ-2 (S-1 AC1): lists an Active doctor with a block today and not one without', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      await s.doctor('Test Doctor B', [block(TUE, '09:00', '10:00')]);
      expect(names(await s.onDuty())).toEqual(['Test Doctor A']);
    });
  });

  it('HMS-23 REQ-3 (S-1 AC2): at 04:00 local on Saturday (still Friday in UTC) the Saturday doctor is listed, the Friday one is not', async () => {
    await withScenario(SATURDAY_0400, async (s) => {
      await s.doctor('Test Doctor A', [block(SAT, '04:30', '05:30')]);
      await s.doctor('Test Doctor B', [block(FRI, '09:00', '10:00')]);
      const res = await request(s.app).get('/api/dashboard');
      expect(res.body.today).toBe(SATURDAY);
      expect(names(res.body.onDuty)).toEqual(['Test Doctor A']);
    });
  });

  it('HMS-23 REQ-15 (S-1 AC3): an Inactive doctor with the most free slots is not listed', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      const c = await s.doctor('Test Doctor C', [block(MON, '09:00', '12:00')]);
      expect((await request(s.app).patch(`/api/doctors/${c}`).send({ status: 'INACTIVE' })).status).toBe(200);
      const rows = await s.onDuty();
      expect(names(rows)).toEqual(['Test Doctor A']);
      expect(rows.map((r) => r.doctorId)).not.toContain(c);
    });
  });

  it('HMS-23 REQ-14/REQ-15 (S-1 AC4): with only an Inactive doctor available today the list is empty', async () => {
    await withScenario(NOW, async (s) => {
      const c = await s.doctor('Test Doctor C', [block(MON, '09:00', '12:00')]);
      await s.doctor('Test Doctor D', [block(TUE, '09:00', '12:00')]);
      await request(s.app).patch(`/api/doctors/${c}`).send({ status: 'INACTIVE' });
      expect(await s.onDuty()).toEqual([]);
    });
  });

  it('HMS-23 REQ-2/REQ-7/REQ-8 (S-1 AC5): two blocks today give one row counted from both', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00'), block(MON, '14:00', '15:00')]);
      await s.booked(a, 1, MONDAY, '09:00');
      const rows = await s.onDuty();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ doctorId: a, booked: 1, free: 3, nextFree: { start: at(MONDAY, '09:30'), label: '09:30' } });
    });
  });

  it('HMS-23 REQ-4/REQ-5 (S-2 AC1): a row carries the doctor name and an Active department', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      const [row] = await s.onDuty();
      expect(row!.fullName).toBe('Test Doctor A');
      expect(row!.department).toEqual({ name: 'Outpatient', status: 'ACTIVE' });
    });
  });

  it('HMS-23 REQ-6 (S-2 AC2): an Inactive department is sent with its status so the page can mark it', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')], { departmentId: 2 });
      expect((await request(s.app).patch('/api/departments/2').send({ status: 'INACTIVE' })).status).toBe(200);
      const [row] = await s.onDuty();
      expect(row!.department).toEqual({ name: 'Surgery', status: 'INACTIVE' });
    });
  });

  it('HMS-23 REQ-17 (S-2 AC3): a row carries no phone or email of a doctor who has both', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      const doctor = (await request(s.app).get(`/api/doctors/${a}`)).body;
      expect(doctor.phone).toBeTruthy();
      expect(doctor.email).toBeTruthy();
      const rows = await s.onDuty();
      expect(Object.keys(rows[0]!).sort()).toEqual(['booked', 'department', 'doctorId', 'free', 'fullName', 'nextFree']);
      const text = JSON.stringify(rows);
      expect(text).not.toContain(doctor.phone);
      expect(text).not.toContain(doctor.email);
      expect(text).not.toMatch(/phone|email/i);
    });
  });

  it('HMS-23 REQ-7/REQ-8 (S-3 AC1): Completed, No-show and Scheduled count as booked; Cancelled-only and empty future slots are free', async () => {
    await withScenario(NOW, async (s) => {
      // 30-minute slots at 09:00, 09:30, 10:00, 10:30 and 11:00.
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '11:30')]);
      const seen = await s.booked(a, 1, MONDAY, '09:00');
      const missed = await s.booked(a, 2, MONDAY, '09:30');
      await s.booked(a, 1, MONDAY, '10:30');
      const dropped = await s.booked(a, 2, MONDAY, '11:00');
      expect((await request(s.app).post(`/api/appointments/${dropped}/cancel`).send({ reason: 'Test cancellation' })).status).toBe(200);
      s.setClock(at(MONDAY, '09:45'));
      expect((await request(s.app).post(`/api/appointments/${seen}/complete`)).status).toBe(200);
      expect((await request(s.app).post(`/api/appointments/${missed}/no-show`)).status).toBe(200);
      expect((await s.onDuty())[0]).toMatchObject({ booked: 3, free: 2, nextFree: { label: '10:00' } });
    });
  });

  it('HMS-23 REQ-8 (S-3 AC2): an unbooked slot that has started is neither booked nor free', async () => {
    await withScenario(at(MONDAY, '09:45'), async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '11:00')], { slotMinutes: 60 });
      expect((await s.onDuty())[0]).toMatchObject({ booked: 0, free: 1, nextFree: { label: '10:00' } });
    });
  });

  it('HMS-23 REQ-7/REQ-8 (S-3 AC3): each row equals the BOOKED and FREE slots of the doctor’s day schedule for today', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '12:00')], { slotMinutes: 15 });
      const b = await s.doctor('Test Doctor B', [block(MON, '09:00', '10:00'), block(MON, '14:00', '15:00')]);
      const seen = await s.booked(a, 1, MONDAY, '09:00');
      await s.booked(a, 2, MONDAY, '10:15');
      const dropped = await s.booked(b, 3, MONDAY, '09:30');
      await s.booked(b, 1, MONDAY, '14:30');
      await request(s.app).post(`/api/appointments/${dropped}/cancel`).send({ reason: 'Test cancellation' });
      s.setClock(at(MONDAY, '09:40'));
      await request(s.app).post(`/api/appointments/${seen}/complete`);
      const rows = await s.onDuty();
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const slots: Slot[] = (await request(s.app).get(`/api/doctors/${row.doctorId}/slots?date=${MONDAY}`)).body.slots;
        const free = slots.filter((x) => x.state === 'FREE');
        expect(row.booked).toBe(slots.filter((x) => x.state === 'BOOKED').length);
        expect(row.free).toBe(free.length);
        expect(row.nextFree).toEqual({ start: free[0]!.start, label: free[0]!.label });
      }
    });
  });

  it('HMS-23 REQ-3/REQ-7/REQ-8 (S-3 AC4): at 04:00 local on Saturday the counts come from Saturday’s slots, not Friday’s', async () => {
    await withScenario(SATURDAY_0400, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(FRI, '09:00', '10:30'), block(SAT, '04:30', '05:30')]);
      await s.booked(a, 1, SATURDAY, '05:00');
      expect((await s.onDuty())[0]).toMatchObject({ doctorId: a, booked: 1, free: 1 });
    });
  });

  it('HMS-23 REQ-9 (S-4 AC1): a slot starting exactly now is not next; the label matches the day schedule', async () => {
    await withScenario(at(MONDAY, '09:30'), async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '10:30')]);
      const row = (await s.onDuty())[0]!;
      expect(row.nextFree).toEqual({ start: at(MONDAY, '10:00'), label: '10:00' });
      expect(row.free).toBe(1);
      const slots: Slot[] = (await request(s.app).get(`/api/doctors/${a}/slots?date=${MONDAY}`)).body.slots;
      expect(slots.find((x) => x.start === row.nextFree!.start)!.label).toBe(row.nextFree!.label);
    });
  });

  it('HMS-23 REQ-9 (S-4 AC2): the next free slot is the earliest free one, before a booked and a later free slot', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '12:00')], { slotMinutes: 60 });
      await s.booked(a, 1, MONDAY, '10:00');
      expect((await s.onDuty())[0]).toMatchObject({ booked: 1, free: 2, nextFree: { start: at(MONDAY, '09:00'), label: '09:00' } });
    });
  });

  it('HMS-23 REQ-12 (S-4 AC3): every slot after now booked gives free 0 and nextFree null (Fully booked)', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      await s.booked(a, 1, MONDAY, '09:00');
      await s.booked(a, 2, MONDAY, '09:30');
      expect((await s.onDuty())[0]).toMatchObject({ doctorId: a, booked: 2, free: 0, nextFree: null });
    });
  });

  it('HMS-23 REQ-19/REQ-12 (S-4 AC4): a doctor whose slots have all passed unbooked stays listed with free 0 (A-01)', async () => {
    await withScenario(at(MONDAY, '17:00'), async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '16:00', '17:00')]);
      const rows = await s.onDuty();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ doctorId: a, booked: 0, free: 0, nextFree: null });
    });
  });

  it('HMS-23 REQ-3/REQ-9 (S-4 AC5): at 04:00 local on Saturday the next free slot is Saturday 04:30, not a Friday time', async () => {
    await withScenario(SATURDAY_0400, async (s) => {
      await s.doctor('Test Doctor A', [block(FRI, '09:00', '10:00'), block(SAT, '04:30', '05:30')]);
      expect((await s.onDuty())[0]!.nextFree).toEqual({ start: at(SATURDAY, '04:30'), label: '04:30' });
    });
  });

  it('HMS-23 REQ-10 (S-5 AC1): rows are ordered by free slots, most first, not by name', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '09:30')]);
      await s.doctor('Test Doctor B', [block(MON, '09:00', '11:00')]);
      await s.doctor('Test Doctor C', [block(MON, '09:00', '10:00')]);
      const rows = await s.onDuty();
      expect(names(rows)).toEqual(['Test Doctor B', 'Test Doctor C', 'Test Doctor A']);
      expect(rows.map((r) => r.free)).toEqual([4, 2, 1]);
    });
  });

  it('HMS-23 REQ-11 (S-5 AC2): equal free slots are ordered by name, not by when the doctor was added', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Beta', [block(MON, '09:00', '10:30')]);
      await s.doctor('Test Alpha', [block(MON, '09:00', '10:30')]);
      const rows = await s.onDuty();
      expect(names(rows)).toEqual(['Test Alpha', 'Test Beta']);
      expect(rows.map((r) => r.free)).toEqual([3, 3]);
    });
  });

  it('HMS-23 REQ-10/REQ-12 (S-5 AC3): a Fully booked doctor comes after one with 1 free slot', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '09:30')]);
      await s.doctor('Test Doctor B', [block(MON, '09:00', '09:30')]);
      await s.booked(a, 1, MONDAY, '09:00');
      const rows = await s.onDuty();
      expect(names(rows)).toEqual(['Test Doctor B', 'Test Doctor A']);
      expect(rows[1]!.nextFree).toBeNull();
    });
  });

  it('HMS-23 REQ-13/REQ-3 (S-6 AC1, S-6 AC2): the link date is the local day, whose schedule holds the Saturday slots', async () => {
    await withScenario(SATURDAY_0400, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(FRI, '09:00', '10:00'), block(SAT, '04:30', '05:30')]);
      const res = await request(s.app).get('/api/dashboard');
      expect(res.body.today).toBe(SATURDAY);
      expect(res.body.onDuty[0].doctorId).toBe(a);
      const day = (await request(s.app).get(`/api/doctors/${a}/slots?date=${res.body.today}`)).body;
      expect(day.slots.map((x: Slot) => x.label)).toEqual(['04:30', '05:00']);
    });
  });

  it('HMS-23 REQ-16 (S-7 AC1): the rows are the same for every period', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '11:00')]);
      await s.doctor('Test Doctor B', [block(MON, '09:00', '10:00')]);
      await s.booked(a, 1, MONDAY, '09:30');
      const today = await s.onDuty('?period=today');
      expect(today).toHaveLength(2);
      expect(await s.onDuty()).toEqual(today);
      expect(await s.onDuty('?period=7d')).toEqual(today);
      expect(await s.onDuty('?period=30d')).toEqual(today);
    });
  });

  it('HMS-23 REQ-16 error: an unknown period is still rejected with a field error', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      const res = await request(s.app).get('/api/dashboard?period=year');
      expect(res.status).toBe(400);
      expect(res.body.error.fields).toHaveProperty('period');
    });
  });

  it('HMS-23 REQ-18 (S-7 AC2): with upcoming appointments the totals and next list keep their definitions', async () => {
    await withScenario(NOW, async (s) => {
      const a = await s.doctor('Test Doctor A', [block(MON, '09:00', '11:00'), block(TUE, '09:00', '11:00')]);
      await s.booked(a, 1, MONDAY, '09:00');
      await s.booked(a, 2, TUESDAY, '10:00');
      const res = await request(s.app).get('/api/dashboard');
      expect(res.body.totals).toEqual({
        patients: 3, doctors: 1, appointmentsToday: 1, upcoming: 2, completed: 0, cancelled: 0, noShows: 0,
      });
      expect(res.body.next.map((x: { startsAt: string }) => x.startsAt)).toEqual([at(MONDAY, '09:00'), at(TUESDAY, '10:00')]);
      expect(Object.keys(res.body).sort()).toEqual(['next', 'onDuty', 'period', 'today', 'totals']);
    });
  });

  it('HMS-23 REQ-18 (S-7 AC3): with no upcoming appointments the totals are 0 and the next list is empty', async () => {
    await withScenario(NOW, async (s) => {
      await s.doctor('Test Doctor A', [block(MON, '09:00', '10:00')]);
      const res = await request(s.app).get('/api/dashboard');
      expect(res.body.totals).toEqual({
        patients: 3, doctors: 1, appointmentsToday: 0, upcoming: 0, completed: 0, cancelled: 0, noShows: 0,
      });
      expect(res.body.next).toEqual([]);
      expect(res.body.onDuty).toHaveLength(1);
    });
  });
});
