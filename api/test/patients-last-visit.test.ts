import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { yearBefore } from '../src/services/patientService';
import { at, loadFixture, testApp } from './helpers';

type Item = { id: number; fullName: string; last_visit: { date: string; doctor_name: string } | null };

/** 01:30 on 25 November 2026 in Kolkata, still 24 November in UTC. */
const JUST_AFTER_MIDNIGHT = new Date('2026-11-24T20:00:00Z');

let phone = 30000;

/** Registers an invented patient and returns its id. */
async function patient(app: Express, fullName: string): Promise<number> {
  phone += 1;
  const res = await request(app).post('/api/patients').send({
    fullName, dateOfBirth: '1980-01-01', gender: 'OTHER', phone: `+91 00000 ${phone}`,
  });
  if (res.status !== 201) throw new Error(`patient: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as number;
}

/** Inserts an appointment row directly, so past and off-hours instants are possible. */
async function visit(db: TestDb, patientId: number, startsAt: string, status = 'COMPLETED', doctorId = 1): Promise<void> {
  await db.pool.query(
    `INSERT INTO appointment (doctor_id, patient_id, starts_at, ends_at, status, cancellation_reason, created_by, updated_by)
     VALUES ($1, $2, $3, $3::timestamptz + interval '15 minutes', $4, $5, 'staff', 'staff')`,
    [doctorId, patientId, startsAt, status, status === 'CANCELLED' ? 'Test reason' : null],
  );
}

async function items(app: Express, query: string): Promise<Item[]> {
  const res = await request(app).get(`/api/patients${query}`);
  expect(res.status).toBe(200);
  return res.body.items as Item[];
}

const names = (list: Item[]): string[] => list.map((p) => p.fullName).sort();

describe('HMS-27 yearBefore', () => {
  it('HMS-27 REQ-7: steps back 12 calendar months to the same date', () => {
    expect(yearBefore('2026-11-25')).toBe('2025-11-25');
    expect(yearBefore('2028-03-15')).toBe('2027-03-15');
  });

  it('HMS-27 REQ-7: 29 February clamps to the last day of February a year earlier', () => {
    expect(yearBefore('2028-02-29')).toBe('2027-02-28');
  });
});

/** HMS-27 S-1: each list item carries its latest COMPLETED appointment as a hospital-local date and doctor. */
describe.skipIf(!pgAvailable())('patient list last visit (HMS-27)', () => {
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

  const lastOf = async (id: number) => (await items(app, '')).find((p) => p.id === id)?.last_visit;

  it('HMS-27 REQ-2: a later No-show is not a visit; the last visit is the latest Completed one', async () => {
    const id = await patient(app, 'Test Visit Alpha');
    await visit(db, id, at('2026-03-10', '09:00'));
    await visit(db, id, at('2026-10-01', '09:00'), 'NO_SHOW', 2);
    expect(await lastOf(id)).toEqual({ date: '2026-03-10', doctor_name: 'Dr. Test Doctor One' });
  });

  it('HMS-27 REQ-4: of two Completed appointments the later one gives the date and doctor', async () => {
    const id = await patient(app, 'Test Visit Bravo');
    await visit(db, id, at('2026-01-12', '09:00'), 'COMPLETED', 1);
    await visit(db, id, at('2026-06-15', '09:00'), 'COMPLETED', 2);
    expect(await lastOf(id)).toEqual({ date: '2026-06-15', doctor_name: 'Dr. Test Doctor Two' });
  });

  it('HMS-27 REQ-3: the date is the hospital-local day, not the UTC day', async () => {
    const id = await patient(app, 'Test Visit Charlie');
    // 19:00 UTC on 24 November 2025 is 00:30 on 25 November in Kolkata.
    await visit(db, id, '2025-11-24T19:00:00Z');
    expect((await lastOf(id))?.date).toBe('2025-11-25');
  });

  it('HMS-27 REQ-5: no Completed appointment (only Cancelled and Scheduled) gives null', async () => {
    const id = await patient(app, 'Test Visit Delta');
    await visit(db, id, at('2026-09-01', '09:00'), 'CANCELLED');
    await visit(db, id, at('2026-10-21', '09:00'), 'SCHEDULED');
    expect(await lastOf(id)).toBeNull();
  });
});

/** HMS-27 S-2, S-5: the not_seen filter keeps patients whose latest Completed visit is before the local cutoff. */
describe.skipIf(!pgAvailable())('patient list not-seen filter (HMS-27)', () => {
  let db: TestDb;
  let app: Express;
  let ids: Record<string, number>;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool, () => JUST_AFTER_MIDNIGHT);
    await loadFixture(app);
    ids = {
      p1: await patient(app, 'Test Filter P1'),
      p2: await patient(app, 'Test Filter P2'),
      p3: await patient(app, 'Test Filter P3'),
      p5: await patient(app, 'Test Filter P5'),
      never: await patient(app, 'Test Filter Never'),
    };
    await visit(db, ids.p1!, at('2025-11-24', '10:00'));
    await visit(db, ids.p2!, '2025-11-24T19:00:00Z');
    await visit(db, ids.p3!, at('2025-01-01', '10:00'));
    await visit(db, ids.p3!, at('2026-10-01', '10:00'), 'NO_SHOW');
    await visit(db, ids.p5!, at('2025-01-01', '10:00'));
    await visit(db, ids.p5!, at('2026-10-01', '10:00'));
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-27 REQ-7: today is the local day (25 Nov), so a visit on 24 Nov 2025 local is listed', async () => {
    expect(names(await items(app, '?q=Test Filter&not_seen=true'))).toContain('Test Filter P1');
  });

  it('HMS-27 REQ-7: a visit at 00:30 local on 25 Nov 2025 (24 Nov in UTC) is not listed', async () => {
    expect(names(await items(app, '?q=Test Filter&not_seen=true'))).not.toContain('Test Filter P2');
  });

  it('HMS-27 REQ-7: an old Completed visit followed by a recent one is not listed', async () => {
    expect(names(await items(app, '?q=Test Filter&not_seen=true'))).not.toContain('Test Filter P5');
  });

  it('HMS-27 REQ-7: a recent No-show does not count as a visit, so the patient is listed', async () => {
    expect(names(await items(app, '?q=Test Filter&not_seen=true'))).toContain('Test Filter P3');
  });

  it('HMS-27 REQ-8: a never-visited patient is not listed', async () => {
    expect(names(await items(app, '?q=Test Filter&not_seen=true'))).toEqual(['Test Filter P1', 'Test Filter P3']);
  });

  it('HMS-27 REQ-13: not_seen=false or absent leaves the list unfiltered', async () => {
    const all = names(await items(app, '?q=Test Filter'));
    expect(all).toHaveLength(5);
    expect(names(await items(app, '?q=Test Filter&not_seen=false'))).toEqual(all);
  });

  it('HMS-27 REQ-6: an invalid not_seen value is rejected with a field error', async () => {
    const res = await request(app).get('/api/patients?not_seen=yes');
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['not_seen']);
  });

  it('HMS-27 REQ-7: in a leap year the cutoff is the same calendar date, not 365 days back', async () => {
    const leap = testApp(db.pool, () => new Date(at('2028-03-15', '10:00')));
    const onCutoff = await patient(app, 'Test Leap On Cutoff');
    const dayBefore = await patient(app, 'Test Leap Day Before');
    await visit(db, onCutoff, at('2027-03-15', '10:00'));
    await visit(db, dayBefore, at('2027-03-14', '10:00'));
    expect(names(await items(leap, '?q=Test Leap&not_seen=true'))).toEqual(['Test Leap Day Before']);
  });
});

/** HMS-27 S-3, S-4, S-6: the filter narrows search and status, and the list carries no medical history. */
describe.skipIf(!pgAvailable())('patient list not-seen filter with search and status (HMS-27)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
    const old = at('2025-01-06', '09:00');
    const recent = at('2026-10-01', '09:00');
    await visit(db, await patient(app, 'Test Search Match Old'), old);
    await visit(db, await patient(app, 'Test Other Old'), old);
    await visit(db, await patient(app, 'Test Search Match Recent'), recent);
    await patient(app, 'Test Search Match Never');
    const inactiveOld = await patient(app, 'Test Status Inactive Old');
    const inactiveRecent = await patient(app, 'Test Status Inactive Recent');
    const inactiveNever = await patient(app, 'Test Status Inactive Never');
    await visit(db, inactiveOld, old);
    await visit(db, inactiveRecent, recent);
    for (const id of [inactiveOld, inactiveRecent, inactiveNever]) await request(app).patch(`/api/patients/${id}`).send({ status: 'INACTIVE' });
    await visit(db, 1, old); // fixture patient 1 has allergies and a medical note
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-27 REQ-9: search and the filter narrow the same result', async () => {
    expect(names(await items(app, '?q=Test Search Match&not_seen=true'))).toEqual(['Test Search Match Old']);
  });

  it('HMS-27 REQ-10: the status filter and the not-seen filter narrow the same result', async () => {
    expect(names(await items(app, '?status=INACTIVE&not_seen=true'))).toEqual(['Test Status Inactive Old']);
  });

  it('HMS-27 REQ-13: search without the filter still lists old, recent and never-visited matches', async () => {
    expect(names(await items(app, '?q=Test Search Match'))).toEqual([
      'Test Search Match Never', 'Test Search Match Old', 'Test Search Match Recent',
    ]);
  });

  it('HMS-27 REQ-13: the status filter without the not-seen filter still lists every Inactive patient', async () => {
    expect(names(await items(app, '?status=INACTIVE'))).toEqual([
      'Test Status Inactive Never', 'Test Status Inactive Old', 'Test Status Inactive Recent',
    ]);
  });

  it('HMS-27 REQ-12: the filtered list carries no medical history', async () => {
    const res = await request(app).get('/api/patients?not_seen=true');
    expect(res.body.items.map((p: Item) => p.id)).toContain(1);
    expect(JSON.stringify(res.body)).not.toMatch(/Penicillin|allerg|medical|Invented note/i);
  });
});

/** HMS-27 S-3: the filter applies before paging, and total counts only filtered patients. */
describe.skipIf(!pgAvailable())('patient list not-seen filter paging (HMS-27)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
    for (let i = 1; i <= 21; i += 1) await visit(db, await patient(app, `Test Paging Old ${String(i).padStart(3, '0')}`), at('2025-01-06', '09:00'));
    // Registered after the 21 old ones, so they would fill page 1 if the filter ran after paging.
    for (let i = 1; i <= 5; i += 1) await visit(db, await patient(app, `Test Paging Recent ${String(i).padStart(3, '0')}`), at('2026-10-01', '09:00'));
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-27 REQ-11: page 1 holds 20 not-seen patients and page 2 the 21st', async () => {
    const first = await request(app).get('/api/patients?not_seen=true');
    expect(first.body).toMatchObject({ page: 1, page_size: 20 });
    expect(first.body.items).toHaveLength(20);
    expect((first.body.items as Item[]).every((p) => p.fullName.startsWith('Test Paging Old'))).toBe(true);
    const second = await request(app).get('/api/patients?not_seen=true&page=2');
    expect((second.body.items as Item[]).map((p) => p.fullName)).toEqual(['Test Paging Old 001']);
  });

  it('HMS-27 REQ-14: total counts only the filtered patients', async () => {
    expect((await request(app).get('/api/patients?not_seen=true')).body.total).toBe(21);
    expect((await request(app).get('/api/patients')).body.total).toBe(28);
  });
});
