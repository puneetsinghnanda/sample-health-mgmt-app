import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { todayIn } from '../lib/format';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

const STALE: AppointmentDetail = {
  id: 7, code: 'A-000007',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-0001', fullName: 'Test Patient 001' },
  startsAt: '2020-01-06T03:30:00Z', endsAt: '2020-01-06T03:45:00Z', status: 'STALE',
  reason: null, cancellationReason: null,
  history: [
    { event: 'BOOKED', fromStartsAt: null, toStartsAt: '2020-01-06T03:30:00Z', note: null, actor: 'staff', at: '2020-01-01T04:00:00Z' },
    { event: 'STALE', fromStartsAt: null, toStartsAt: null, note: null, actor: 'system', at: '2020-01-07T04:00:00Z' },
  ],
};

function renderPage(appointment: AppointmentDetail) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    JSON.stringify(url.includes('/slots') ? { doctorId: 1, date: '2020-01-06', slotMinutes: 15, slots: [], appointments: [] } : appointment),
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HMS-34 REQ-12 (S-5 AC2): shows the status Stale', async () => {
    renderPage(STALE);
    const badge = await screen.findByText('Stale');
    expect(badge.classList.contains('badge-stale')).toBe(true);
  });

  it('HMS-34 REQ-7/REQ-8/REQ-9/REQ-10 (S-3, S-4): a Stale appointment still offers every action', async () => {
    renderPage(STALE);
    await screen.findByText('Stale');
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      const button = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    }
    expect(screen.queryByText(/can no longer be changed/)).toBeNull();
  });

  it('HMS-34 REQ-3: the history labels the job event "Marked stale" by system', async () => {
    renderPage(STALE);
    const label = await screen.findByText('Marked stale');
    expect(label.closest('li')?.textContent).toMatch(/by system/);
  });

  it('HMS-34 REQ-10 edge: rescheduling a Stale appointment starts the date picker on today, not its past day', async () => {
    renderPage(STALE);
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const input = (await screen.findByLabelText('Date')) as HTMLInputElement;
    expect(input.value).toBe(todayIn('Asia/Kolkata'));
  });

  it('HMS-34 regression: a future Scheduled appointment starts the picker on its own day', async () => {
    renderPage({ ...STALE, status: 'SCHEDULED', startsAt: '2099-03-02T03:30:00Z', endsAt: '2099-03-02T03:45:00Z', history: STALE.history.slice(0, 1) });
    fireEvent.click(await screen.findByRole('button', { name: 'Reschedule' }));
    const input = (await screen.findByLabelText('Date')) as HTMLInputElement;
    expect(input.value).toBe('2099-03-02');
  });

  it('HMS-34 regression: a closed appointment still offers no actions', async () => {
    renderPage({ ...STALE, status: 'COMPLETED' });
    expect(await screen.findByText(/can no longer be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });
});
