import { isValidTimeZone } from './lib/time';

export interface DbConfig {
  /** Connection string (Neon or local). Otherwise libpq PG* variables apply. */
  connectionString?: string;
  /** File holding the database password, when it is not part of the connection string. */
  passwordFile?: string;
}

export interface AppConfig {
  host: string;
  port: number;
  db: DbConfig;
  /** Hospital time zone for "today", availability and slots (PRD NFR-2). */
  timeZone: string;
  currency: 'INR';
  pageSize: number;
  /** Built web app to serve from the same origin (shared environment). Unset in local development. */
  webDistDir?: string;
}

function intEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid value for ${name}: expected a positive integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL && !env.PGHOST) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  const timeZone = env.HOSPITAL_TZ || 'Asia/Kolkata';
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid value for HOSPITAL_TZ: ${timeZone} is not an IANA time zone`);
  return {
    host: env.API_HOST ?? '127.0.0.1',
    port: intEnv(env.PORT ?? env.API_PORT, 3000, 'PORT'),
    db: { connectionString: env.DATABASE_URL, passwordFile: env.PGPASSWORD_FILE },
    timeZone,
    currency: 'INR',
    pageSize: 20,
    webDistDir: env.WEB_DIST_DIR || undefined,
  };
}
