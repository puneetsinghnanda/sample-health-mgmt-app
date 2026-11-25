import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { todayIn } from '../lib/format';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

/** A past appointment (19 Oct 2026, 10:00 Asia/Kolkata) the job has marked Stale. */
const STALE: AppointmentDetail = {
  id: 1, code: 'A-000001',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-0001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-19T04:30:00.000Z', endsAt: '2026-10-19T04:45:00.000Z', status: 'STALE',
  reason: null, cancellationReason: null,
  history: [
    { event: 'BOOKED', fromStartsAt: null, toStartsAt: '2026-10-19T04:30:00.000Z', note: null, actor: 'staff', at: '2026-10-18T04:30:00.000Z' },
    { event: 'STALE', fromStartsAt: null, toStartsAt: null, note: null, actor: 'system', at: '2026-10-20T04:31:00.000Z' },
  ],
};

function renderPage(appointment: AppointmentDetail) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    JSON.stringify(url.includes('/slots')
      ? { doctorId: 1, date: '2026-10-19', slotMinutes: 15, slots: [], appointments: [] }
      : appointment),
    { status: 200 },
  )));
  render(
    <MemoryRouter initialEntries={[`/appointments/${appointment.id}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/appointments/:id" element={<AppointmentDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppointmentDetailPage Stale (HMS-34)', () => {
  it('HMS-34 REQ-12 (S-5 AC2): the page shows the status Stale', async () => {
    renderPage(STALE);
    const heading = await screen.findByRole('heading', { level: 1 });
    const badge = heading.querySelector('.badge');
    expect(badge?.textContent).toBe('Stale');
    expect(badge?.classList.contains('badge-stale')).toBe(true);
  });

  it('HMS-34 REQ-7/REQ-8/REQ-9/REQ-10 (S-3, S-4): a Stale appointment keeps every staff action', async () => {
    renderPage(STALE);
    await screen.findByRole('heading', { level: 1 });
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.queryByText(/closed and can no longer be changed/)).toBeNull();
  });

  it('HMS-34 REQ-3: the history labels the job event "Marked stale" by system', async () => {
    renderPage(STALE);
    const label = await screen.findByText('Marked stale');
    expect(label.closest('li')?.textContent).toMatch(/by system/);
  });

  it('HMS-34 REQ-10 edge: the reschedule picker of a past Stale appointment starts on today, not its own day', async () => {
    renderPage(STALE);
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const today = todayIn('Asia/Kolkata');
    const input = screen.getByLabelText('Date') as HTMLInputElement;
    expect(input.value).toBe(today);
    expect(input.value).not.toBe('2026-10-19');
  });

  it('HMS-34 REQ-7 edge: a Completed appointment is still closed and shows no actions', async () => {
    renderPage({ ...STALE, status: 'COMPLETED' });
    expect(await screen.findByText(/closed and can no longer be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });
});
