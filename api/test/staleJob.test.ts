import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_JOB_ACTOR, STALE_JOB_INTERVAL_MS, startStaleJob } from '../src/jobs/staleJob';

/** HMS-34: the in-process job that marks Stale appointments. No database; the service is a stub. */
describe('stale job (HMS-34)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('HMS-34 REQ-1: runs once at start and then every hour with the actor system', async () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob({ markStale });
    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenLastCalledWith('system');
    expect(STALE_JOB_ACTOR).toBe('system');
    expect(STALE_JOB_INTERVAL_MS).toBe(60 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS - 1);
    expect(markStale).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(markStale).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(3);
    stop();
  });

  it('HMS-34 REQ-1 edge: the stop function ends the hourly runs', async () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob({ markStale });
    stop();
    await vi.advanceTimersByTimeAsync(3 * STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(1);
  });

  it('HMS-34 REQ-1 error: a failed run logs only the error message and the next run still happens', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const markStale = vi
      .fn(async () => 0)
      .mockRejectedValueOnce(new Error('Test failure 001'))
      .mockRejectedValueOnce('Test failure 002');
    const stop = startStaleJob({ markStale });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('[stale-job] Test failure 001');
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS);
    expect(log).toHaveBeenLastCalledWith('[stale-job] Test failure 002');
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
    stop();
  });
});
