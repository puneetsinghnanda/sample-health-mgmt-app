import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';

const config = loadConfig();
const pool = createPool(config.db);
const app = createApp(pool, config);

const server = app.listen(config.port, config.host, () => {
  console.log(`[api] Hospital Management API listening on http://${config.host}:${config.port} (${config.timeZone})`);
});

function shutdown(): void {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
