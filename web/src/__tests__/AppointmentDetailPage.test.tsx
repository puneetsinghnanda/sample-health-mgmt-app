import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

/** 11:00 on 4 December 2026 in Asia/Kolkata (UTC+05:30), the settings default zone. */
const NOW = new Date('2026-12-04T05:30:00Z');

const STALE: AppointmentDetail = {
  id: 5, code: 'A-000005',
  doctor: { id: 3, code: 'D-0003', fullName: 'Test Doctor 003' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-12-03T04:30:00Z', endsAt: '2026-12-03T04:45:00Z', status: 'STALE',
  reason: 'Check-up', cancellationReason: null,
  history: [
    { event: 'BOOKED', fromStartsAt: null, toStartsAt: '2026-12-03T04:30:00Z', note: null, actor: 'staff', at: '2026-10-19T02:30:00Z' },
    { event: 'STALE', fromStartsAt: null, toStartsAt: null, note: null, actor: 'system', at: '2026-12-04T04:31:00Z' },
  ],
};

type Answer = { status: number; body: unknown };

/** Serves the appointment, an empty day schedule, and `post` for any POST. Returns the fetch mock. */
function renderPage(appointment: AppointmentDetail, post: (url: string) => Answer = () => ({ status: 200, body: appointment })) {
  let current: unknown = appointment;
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') {
      const answer = post(url);
      if (answer.status === 200) current = answer.body;
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }
    if (url.includes('/slots')) {
      return new Response(JSON.stringify({ doctorId: appointment.doctor.id, date: '2026-12-04', slotMinutes: 15, slots: [], appointments: [] }), { status: 200 });
    }
    return new Response(JSON.stringify(current), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={[`/appointments/${appointment.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe('AppointmentDetailPage Stale (HMS-34)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('HMS-34 REQ-11 (S-5 AC2): the appointment page shows the status Stale', async () => {
    renderPage(STALE);
    const badge = await screen.findByText('Stale');
    expect(badge.className).toBe('badge badge-stale');
    expect(badge.closest('h1')?.textContent).toContain('A-000005');
  });

  it('HMS-34 REQ-7..REQ-10: a Stale appointment keeps the reschedule, cancel, complete and no-show actions', async () => {
    renderPage(STALE);
    await screen.findByText('Stale');
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel appointment' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Mark completed' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Mark no-show' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/closed and can no longer be changed/)).toBeNull();
  });

  it('HMS-34 REQ-7 (S-3 AC1): Mark completed on a Stale appointment posts complete and shows it closed', async () => {
    const fetchMock = renderPage(STALE, () => ({ status: 200, body: { ...STALE, status: 'COMPLETED' } }));
    await screen.findByText('Stale');
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    expect(await screen.findByText('Completed')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/appointments/5/complete', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText(/closed and can no longer be changed/)).toBeTruthy();
  });

  it('HMS-34 REQ-7 error: a refused close shows the error and keeps the Stale actions', async () => {
    renderPage(STALE, () => ({ status: 409, body: { error: { code: 'CONFLICT', message: 'Test conflict 001' } } }));
    await screen.findByText('Stale');
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }));
    expect(await screen.findByText('Test conflict 001')).toBeTruthy();
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeTruthy();
  });

  it('HMS-34 REQ-10 edge: rescheduling a Stale appointment starts the picker on today, not its past day', async () => {
    const fetchMock = renderPage(STALE);
    await screen.findByText('Stale');
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    const input = (await screen.findByLabelText(/Date/)) as HTMLInputElement;
    expect(input.value).toBe('2026-12-04');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/doctors/3/slots?date=2026-12-04', expect.anything()));
  });

  it('HMS-34 REQ-10 edge: a future Scheduled appointment still starts the picker on its own day', async () => {
    renderPage({ ...STALE, status: 'SCHEDULED', startsAt: '2026-12-06T04:30:00Z', endsAt: '2026-12-06T04:45:00Z', history: [STALE.history[0]!] });
    await screen.findByText('Scheduled');
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }));
    const input = (await screen.findByLabelText(/Date/)) as HTMLInputElement;
    expect(input.value).toBe('2026-12-06');
  });

  it('HMS-34 REQ-1: the history labels the job’s event "Marked stale" by system', async () => {
    renderPage(STALE);
    const label = await screen.findByText('Marked stale');
    expect(label.closest('li')?.textContent).toMatch(/by system$/);
  });

  it('HMS-34 edge: a Completed appointment is still closed, with no actions', async () => {
    renderPage({ ...STALE, status: 'COMPLETED' });
    expect(await screen.findByText(/closed and can no longer be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });
});
