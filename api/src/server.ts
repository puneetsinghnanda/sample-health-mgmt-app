import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { MINUTE } from './lib/time';
import type { AppContext } from './services';

/** HMS-34: how often open appointments past their 24h window are marked Stale. */
const STALE_JOB_INTERVAL_MS = 60 * MINUTE;
/** HMS-34: the actor recorded on the history of changes the job makes. */
const STALE_JOB_ACTOR = 'system';

const config = loadConfig();
const pool = createPool(config.db);
const app = createApp(pool, config);
const ctx = app.locals.ctx as AppContext;

function markStale(): void {
  ctx.services.appointments.markStale(STALE_JOB_ACTOR).catch((err: unknown) => {
    console.error(`[api] stale job failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

let staleTimer: NodeJS.Timeout | undefined;

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] Hospital Management API listening on http://${config.host}:${config.port} (${config.timeZone})`);
  markStale();
  staleTimer = setInterval(markStale, STALE_JOB_INTERVAL_MS);
});

function shutdown(): void {
  if (staleTimer) clearInterval(staleTimer);
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
