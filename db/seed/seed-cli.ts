import { poolFromEnv } from '../scripts/pool';
import { DEFAULT_SEED, DEFAULT_TZ, generateSeed, resolveAnchor, seedHash } from './generate';
import { isEmpty, loadSeed } from './load';

/**
 * npm run db:seed            seeds only an empty database (safe for the shared environment)
 * npm run db:seed -- --reset deletes ALL data first, then seeds (your own Neon branch only)
 */
async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const seed = process.env.SEED ? Number(process.env.SEED) : DEFAULT_SEED;
  const data = generateSeed(seed, resolveAnchor(process.env.SEED_ANCHOR), process.env.HOSPITAL_TZ ?? DEFAULT_TZ);
  const pool = poolFromEnv();
  try {
    if (!reset && !(await isEmpty(pool))) {
      console.log('database already has data: seed skipped (use --reset on your own branch to start over)');
      return;
    }
    await loadSeed(pool, data, reset);
  } finally {
    await pool.end();
  }
  console.log(
    `seeded ${data.doctors.length} doctors, ${data.patients.length} patients, ` +
      `${data.appointments.length} appointments (sha256 ${seedHash(data).slice(0, 12)})`,
  );
}

main().catch((err: unknown) => {
  console.error('seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
