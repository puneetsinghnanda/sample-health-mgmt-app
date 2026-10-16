import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, pgAvailable, type TestDb } from '../../db/testing/test-db';
import { allows, MVP_ACTOR } from '../src/auth/identity';
import { loadFixture, testApp } from './helpers';

describe('auth-ready architecture (PRD §4.6)', () => {
  it('AUTH-2: in the MVP every permission is granted', () => {
    expect(allows(MVP_ACTOR, 'appointments:write')).toBe(true);
  });
});

describe.skipIf(!pgAvailable())('identity on every request', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await freshDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it('AUTH-1/AUTH-3: the request actor fills created_by and updated_by', async () => {
    const app = testApp(db.pool);
    await loadFixture(app);
    const { rows } = await db.pool.query('SELECT created_by, updated_by FROM doctor WHERE id = 1');
    expect(rows[0]).toEqual({ created_by: 'staff', updated_by: 'staff' });
  });

  it('serves health, settings and JSON 404s', async () => {
    const app = testApp(db.pool);
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok', db: 'up' });
    expect((await request(app).get('/api/settings')).body).toEqual({ timeZone: 'Asia/Kolkata', currency: 'INR', pageSize: 20 });
    const missing = await request(app).get('/api/nothing-here');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
