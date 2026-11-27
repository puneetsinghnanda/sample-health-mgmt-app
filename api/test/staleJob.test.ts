import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_JOB_ACTOR, STALE_JOB_INTERVAL_MS, startStaleJob } from '../src/jobs/staleJob';

/** HMS-34: the Stale job, without a database (the service is a stub). */
describe('stale job (HMS-34)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('HMS-34 REQ-3: runs once at start with the actor system', () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob({ markStale });
    expect(markStale).toHaveBeenCalledTimes(1);
    expect(markStale).toHaveBeenCalledWith('system');
    expect(STALE_JOB_ACTOR).toBe('system');
    stop();
  });

  it('HMS-34 REQ-3: runs again every hour, and not before', () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob({ markStale });
    expect(STALE_JOB_INTERVAL_MS).toBe(60 * 60 * 1000);
    vi.advanceTimersByTime(STALE_JOB_INTERVAL_MS - 1);
    expect(markStale).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(markStale).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(STALE_JOB_INTERVAL_MS * 2);
    expect(markStale).toHaveBeenCalledTimes(4);
    stop();
  });

  it('HMS-34 REQ-3 edge: the stop function ends the hourly runs', () => {
    const markStale = vi.fn(async () => 0);
    const stop = startStaleJob({ markStale });
    stop();
    vi.advanceTimersByTime(STALE_JOB_INTERVAL_MS * 3);
    expect(markStale).toHaveBeenCalledTimes(1);
  });

  it('HMS-34 REQ-3 error: a failed run logs only the error message and the job keeps running', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const markStale = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue(0);
    const stop = startStaleJob({ markStale });
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[stale-job] connection refused');
    await vi.advanceTimersByTimeAsync(STALE_JOB_INTERVAL_MS);
    expect(markStale).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    stop();
  });

  it('HMS-34 REQ-3 error: a non-Error rejection is logged as text', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = startStaleJob({ markStale: vi.fn().mockRejectedValue('timeout') });
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith('[stale-job] timeout');
    stop();
  });
});
