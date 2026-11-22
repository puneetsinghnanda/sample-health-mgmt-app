import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { loadFixture, testApp } from './helpers';

type Row = { id: number; fullName: string; weekdays?: number[] };

const list = async (app: Express, query = '') => {
  const res = await request(app).get(`/api/doctors?with_today=true${query}`);
  expect(res.status).toBe(200);
  return res.body as { items: Row[]; page: number; page_size: number; total: number };
};
const weekdaysOf = async (app: Express, query = '') =>
  Object.fromEntries((await list(app, query)).items.map((d) => [d.id, d.weekdays]));
const idsOf = async (app: Express, query = '') => (await list(app, query)).items.map((d) => d.id).sort((a, b) => a - b);

/**
 * HMS-28: GET /api/doctors takes weekday=1..7 (1 = Monday .. 7 = Sunday) and, with with_today=true,
 * returns each doctor's distinct weekdays.
 * Fixture: doctor 1 Mon-Fri, doctor 2 Mon (both from loadFixture); doctor 3 Sun and Sat (two Saturday
 * blocks, entered Sunday first); doctor 4 no availability; doctor 5 Inactive, Sunday only.
 */
describe.skipIf(!pgAvailable())('doctors list Works on (HMS-28)', () => {
  let db: TestDb;
  let app: Express;
  beforeAll(async () => {
    db = await freshDatabase();
    app = testApp(db.pool);
    await loadFixture(app);
    const create = async (body: object) => {
      const res = await request(app).post('/api/doctors').send({ feePaise: 50000, slotMinutes: 15, ...body });
      if (res.status !== 201) throw new Error(`create doctor: ${res.status} ${JSON.stringify(res.body)}`);
    };
    await create({
      fullName: 'Dr. Test Doctor Three', specializationId: 1, departmentId: 1, phone: '+91 00000 10003',
      availability: [
        { weekday: 7, start: '09:00', end: '10:00' },
        { weekday: 6, start: '09:00', end: '10:00' },
        { weekday: 6, start: '14:00', end: '15:00' },
      ],
    });
    await create({
      fullName: 'Dr. Test Doctor Four', specializationId: 1, departmentId: 1, phone: '+91 00000 10004', availability: [],
    });
    await create({
      fullName: 'Dr. Test Doctor Five', specializationId: 2, departmentId: 2, phone: '+91 00000 10005', status: 'INACTIVE',
      availability: [{ weekday: 7, start: '09:00', end: '10:00' }],
    });
  });
  afterAll(async () => {
    await db.drop();
  });

  it('HMS-28 REQ-1, REQ-2: weekdays are distinct and ascending, with Sunday (7) last', async () => {
    const w = await weekdaysOf(app);
    expect(w[1]).toEqual([1, 2, 3, 4, 5]);
    expect(w[2]).toEqual([1]);
    expect(w[3]).toEqual([6, 7]);
  });

  it('HMS-28 REQ-3: a doctor with no availability blocks has an empty weekdays list', async () => {
    expect((await weekdaysOf(app))[4]).toEqual([]);
  });

  it('HMS-28 REQ-11: an Inactive doctor still has weekdays', async () => {
    expect((await weekdaysOf(app))[5]).toEqual([7]);
  });

  it('HMS-28 REQ-5: without weekday (or with it empty) every doctor is listed', async () => {
    expect(await idsOf(app)).toEqual([1, 2, 3, 4, 5]);
    expect(await idsOf(app, '&weekday=')).toEqual([1, 2, 3, 4, 5]);
  });

  it('HMS-28 REQ-6: weekday=7 (Sunday) lists only doctors with a Sunday block', async () => {
    expect(await idsOf(app, '&weekday=7')).toEqual([3, 5]);
  });

  it('HMS-28 REQ-6: weekday=1 (Monday) excludes doctors without a Monday block', async () => {
    expect(await idsOf(app, '&weekday=1')).toEqual([1, 2]);
  });

  it('HMS-28 REQ-9: a doctor with two blocks on the weekday is listed and counted once', async () => {
    const res = await list(app, '&weekday=6');
    expect(res.items.map((d) => d.id)).toEqual([3]);
    expect(res.total).toBe(1);
  });

  it('HMS-28 REQ-7: combines with department, specialization, status and search', async () => {
    expect(await idsOf(app, '&weekday=1&departmentId=2')).toEqual([2]);
    expect(await idsOf(app, '&weekday=7&specializationId=2')).toEqual([5]);
    expect(await idsOf(app, '&weekday=7&status=ACTIVE')).toEqual([3]);
    expect(await idsOf(app, '&weekday=7&q=doctor three')).toEqual([3]);
  });

  it('HMS-28 REQ-12: with Any day the status filter works as before', async () => {
    expect(await idsOf(app, '&status=INACTIVE')).toEqual([5]);
    expect(await idsOf(app, '&status=ACTIVE')).toEqual([1, 2, 3, 4]);
    expect(await idsOf(app, '&weekday=&status=INACTIVE')).toEqual([5]);
  });

  it('HMS-28 REQ-4: weekday outside 1..7 or not a whole day number is a field error', async () => {
    for (const bad of ['0', '8', 'sat', '1.5', '-1']) {
      const res = await request(app).get(`/api/doctors?with_today=true&weekday=${bad}`);
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.error.fields)).toEqual(['weekday']);
    }
  });

  it('HMS-28 REQ-15: without with_today the list and the detail carry no weekdays', async () => {
    const items = (await request(app).get('/api/doctors')).body.items as Row[];
    expect(items.every((d) => !('weekdays' in d))).toBe(true);
    expect('weekdays' in (await request(app).get('/api/doctors/1')).body).toBe(false);
  });

  it('HMS-28 REQ-6: the weekday filter also works without with_today', async () => {
    const res = await request(app).get('/api/doctors?weekday=7');
    expect(res.status).toBe(200);
    expect((res.body.items as Row[]).map((d) => d.id).sort((a, b) => a - b)).toEqual([3, 5]);
  });

  it('HMS-28 REQ-8, REQ-9: the 21st doctor with a Thursday block is on page 2, sorted by name', async () => {
    for (let i = 1; i <= 20; i++) {
      const n = String(i).padStart(2, '0');
      const res = await request(app).post('/api/doctors').send({
        fullName: `Dr. Test Doctor Extra ${n}`, specializationId: 1, departmentId: 1, phone: `+91 00000 110${n}`,
        feePaise: 50000, slotMinutes: 15, availability: [{ weekday: 4, start: '09:00', end: '10:00' }],
      });
      expect(res.status).toBe(201);
    }
    const page1 = await list(app, '&weekday=4');
    expect(page1).toMatchObject({ page: 1, page_size: 20, total: 21 });
    expect(page1.items).toHaveLength(20);
    expect(page1.items[0]!.fullName).toBe('Dr. Test Doctor Extra 01');
    const page2 = await list(app, '&weekday=4&page=2');
    expect(page2.items.map((d) => d.fullName)).toEqual(['Dr. Test Doctor One']);
  });
});
