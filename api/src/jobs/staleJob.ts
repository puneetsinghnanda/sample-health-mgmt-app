import { MINUTE } from '../lib/time';
import type { AppointmentService } from '../services/appointmentService';

/** HMS-34: how often the Stale job runs. */
export const STALE_JOB_INTERVAL_MS = 60 * MINUTE;
/** The job's actor in updated_by and the appointment history. */
export const STALE_JOB_ACTOR = 'system';

/**
 * HMS-34: marks Scheduled appointments Stale once at startup, then every hour.
 * The startup run catches up after the process was down or asleep. Returns a function that stops the job.
 */
export function startStaleJob(appointments: AppointmentService): () => void {
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
