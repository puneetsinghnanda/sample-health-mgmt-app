import type { AppConfig } from '../config';
import type { Database } from '../db';
import { addDays, dayBounds, localDay } from '../lib/time';
import { Fields } from '../lib/validate';
import { SUMMARY_SELECT, toSummary } from '../repositories/appointmentRepo';
import type { AppointmentSummary } from '../types';

export const PERIODS = ['today', '7d', '30d'] as const;
export type Period = (typeof PERIODS)[number];
const PERIOD_DAYS: Record<Period, number> = { today: 1, '7d': 7, '30d': 30 };

export interface Dashboard {
  today: string;
  period: { name: Period; from: string; to: string };
  totals: {
    patients: number;
    doctors: number;
    appointmentsToday: number;
    upcoming: number;
    completed: number;
    cancelled: number;
  };
  next: AppointmentSummary[];
}

/** PRD §4.4. Counts only: no contact details or medical history (DSH-9). */
export class DashboardService {
  constructor(
    private readonly db: Database,
    private readonly config: AppConfig,
    private readonly clock: () => Date,
  ) {}

  async get(query: Record<string, unknown>): Promise<Dashboard> {
    const f = new Fields(query);
    const name: Period = f.oneOf('period', PERIODS) ?? 'today';
    f.done();
    const tz = this.config.timeZone;
    const now = this.clock();
    const today = localDay(now, tz);
    const from = addDays(today, 1 - PERIOD_DAYS[name]);
    const todayBounds = dayBounds(today, tz);
    const periodStart = dayBounds(from, tz).start;
    const { rows } = await this.db.query<Record<string, string>>(
      `SELECT
         (SELECT count(*) FROM patient WHERE status = 'ACTIVE') AS patients,
         (SELECT count(*) FROM doctor WHERE status = 'ACTIVE') AS doctors,
         (SELECT count(*) FROM appointment WHERE starts_at >= $1 AND starts_at < $2 AND status <> 'CANCELLED') AS today,
         (SELECT count(*) FROM appointment WHERE status = 'SCHEDULED' AND starts_at > $3) AS upcoming,
         (SELECT count(*) FROM appointment WHERE status = 'COMPLETED' AND starts_at >= $4 AND starts_at < $2) AS completed,
         (SELECT count(*) FROM appointment WHERE status = 'CANCELLED' AND starts_at >= $4 AND starts_at < $2) AS cancelled`,
      [todayBounds.start, todayBounds.end, now, periodStart],
    );
    const r = rows[0]!;
    const next = (
      await this.db.query<Parameters<typeof toSummary>[0]>(
        `${SUMMARY_SELECT} WHERE a.status = 'SCHEDULED' AND a.starts_at > $1 ORDER BY a.starts_at, a.id LIMIT 10`,
        [now],
      )
    ).rows.map(toSummary);
    return {
      today,
      period: { name, from, to: today },
      totals: {
        patients: Number(r.patients),
        doctors: Number(r.doctors),
        appointmentsToday: Number(r.today),
        upcoming: Number(r.upcoming),
        completed: Number(r.completed),
        cancelled: Number(r.cancelled),
      },
      next,
    };
  }
}
