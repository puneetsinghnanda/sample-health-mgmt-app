import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';
import { generateSeed, resolveAnchor, seedHash } from '../seed/generate';
import { isEmpty, loadSeed } from '../seed/load';
import { freshDatabase, pgAvailable, type TestDb } from '../testing/test-db';

describe('seed generator (NFR-7)', () => {
  it('is deterministic for the same seed and anchor', () => {
    expect(seedHash(generateSeed())).toBe(seedHash(generateSeed()));
  });

  it('changes when the seed changes', () => {
    expect(seedHash(generateSeed(1))).not.toBe(seedHash(generateSeed(2)));
  });

  it('uses invented identities only', () => {
    const data = generateSeed();
    const people = [...data.doctors, ...data.patients];
    expect(people.every((p) => p.email.endsWith('@example.com'))).toBe(true);
    expect(people.every((p) => p.phone.startsWith('+91 00000 '))).toBe(true);
  });

  it('never overlaps appointments for a doctor or a patient', () => {
    const appts = generateSeed().appointments;
    for (const key of ['doctorId', 'patientId'] as const) {
      const byOwner = new Map<number, Array<[number, number]>>();
      for (const a of appts) {
        const span: [number, number] = [Date.parse(a.startsAt), Date.parse(a.endsAt)];
        const list = byOwner.get(a[key]) ?? [];
        expect(list.some(([s, e]) => span[0] < e && s < span[1])).toBe(false);
        byOwner.set(a[key], [...list, span]);
      }
    }
  });

  it('has past outcomes and future bookings around the anchor', () => {
    const statuses = new Set(generateSeed().appointments.map((a) => a.status));
    expect([...statuses].sort()).toEqual(['CANCELLED', 'COMPLETED', 'NO_SHOW', 'SCHEDULED']);
  });

  it('rejects an invalid anchor', () => {
    expect(() => resolveAnchor('not-a-date')).toThrow(/SEED_ANCHOR/);
    expect(resolveAnchor('now', new Date(5)).getTime()).toBe(5);
  });
});

describe.skipIf(!pgAvailable())('migrations and seed against PostgreSQL', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('migrations are already applied and re-running them is a no-op', async () => {
    expect(await migrate(db.pool)).toEqual([]);
  });

  it('loads the seed into an empty database, and only when asked to reset again', async () => {
    expect(await isEmpty(db.pool)).toBe(true);
    const data = generateSeed();
    await loadSeed(db.pool, data);
    expect(await isEmpty(db.pool)).toBe(false);
    const count = async (t: string) => Number((await db.pool.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
    expect(await count('doctor')).toBe(data.doctors.length);
    expect(await count('appointment')).toBe(data.appointments.length);
    await loadSeed(db.pool, data, true);
    expect(await count('patient')).toBe(data.patients.length);
  });
});
