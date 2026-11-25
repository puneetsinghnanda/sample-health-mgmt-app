import { MINUTE } from '../lib/time';
import type { AppointmentService } from '../services/appointmentService';

/** HMS-34: the job runs every hour and records its changes as the actor 'system'. */
export const STALE_JOB_INTERVAL_MS = 60 * MINUTE;
export const STALE_JOB_ACTOR = 'system';

/** Marks Stale appointments once now and then every hour. Returns a function that stops the job. */
export function startStaleJob(appointments: Pick<AppointmentService, 'markStale'>): () => void {
  const run = (): void => {
    appointments.markStale(STALE_JOB_ACTOR).catch((err: unknown) => {
      console.error(`[stale-job] ${err instanceof Error ? err.message : String(err)}`);
    });
  };
  run();
  const timer = setInterval(run, STALE_JOB_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
