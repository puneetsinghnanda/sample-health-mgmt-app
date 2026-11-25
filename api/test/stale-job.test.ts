import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_JOB_ACTOR, STALE_JOB_INTERVAL_MS, startStaleJob } from '../src/jobs/staleJob';
import type { AppointmentService } from '../src/services/appointmentService';

/** HMS-34: the in-process timer that runs AppointmentService.markStale. No database needed. */
describe('Stale job timer (HMS-34)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const fakeService = (markStale: (actor: string) => Promise<number>) => ({ markStale }) as unknown as AppointmentService;

  it('HMS-34 REQ-1: runs once at start, then every hour, as actor system', async () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob(fakeService(markStale));
    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenLastCalledWith('system');
    expect(STALE_JOB_ACTOR).toBe('system');
    expect(STALE_JOB_INTERVAL_MS).toBe(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS - 1);
    expect(markStale).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(markStale).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(4);
    stop();
  });

  it('HMS-34 REQ-1 edge: the stop function ends the hourly runs', async () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob(fakeService(markStale));
    stop();
    await vi.advanceTimersByTimeAsync(3 * STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(1);
  });

  it('HMS-34 REQ-1 error: a failed run logs only the error message and the next hour runs again', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const markStale = vi.fn()
      .mockRejectedValueOnce(new Error('Test failure 001'))
      .mockResolvedValue(0);
    const stop = startStaleJob(fakeService(markStale));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith('[stale-job] Test failure 001');
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledTimes(1);
    stop();
  });

  it('HMS-34 REQ-1 error: a thrown non-Error value is logged as text', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = startStaleJob(fakeService(vi.fn().mockRejectedValueOnce('Test failure 002')));
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledWith('[stale-job] Test failure 002');
    stop();
  });
});
