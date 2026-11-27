import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDetail } from '../api/types';
import { AppointmentDetailPage } from '../pages/AppointmentDetailPage';

const STALE: AppointmentDetail = {
  id: 7, code: 'A-000007',
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-000001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-19T03:30:00.000Z', endsAt: '2026-10-19T03:45:00.000Z',
  status: 'STALE', reason: 'Check-up', cancellationReason: null,
  history: [
    { event: 'BOOKED', fromStartsAt: null, toStartsAt: '2026-10-19T03:30:00.000Z', note: null, actor: 'staff', at: '2026-10-18T03:30:00.000Z' },
    { event: 'STALE', fromStartsAt: null, toStartsAt: null, note: null, actor: 'system', at: '2026-10-20T03:31:00.000Z' },
  ],
};

function renderPage(appointment: AppointmentDetail) {
  const fetchMock = vi.fn(async (...call: [url: string, init?: RequestInit]) => call && new Response(JSON.stringify(appointment), { status: 200 }));
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
  it('HMS-34 REQ-1: a Stale appointment shows the Stale badge', async () => {
    renderPage(STALE);
    const badge = await screen.findByText('Stale');
    expect(badge.classList.contains('badge-stale')).toBe(true);
  });

  it('HMS-34 REQ-8: the history shows the STALE event as "Marked stale" by system', async () => {
    renderPage(STALE);
    const item = (await screen.findByText('Marked stale')).closest('li')!;
    expect(item.textContent).toContain('by system');
  });

  it('HMS-34 REQ-6/REQ-10/REQ-11/REQ-12: a Stale appointment keeps every staff action', async () => {
    renderPage(STALE);
    await screen.findByText('Stale');
    for (const name of ['Reschedule', 'Cancel appointment', 'Mark completed', 'Mark no-show']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    expect(screen.queryByText(/closed and can no longer be changed/)).toBeNull();
  });

  it('HMS-34 REQ-10: Mark completed on a Stale appointment posts to complete', async () => {
    const fetchMock = renderPage(STALE);
    await screen.findByText('Stale');
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([url, init]) => url === '/api/appointments/7/complete' && init?.method === 'POST');
      expect(post).toBeTruthy();
    });
  });

  it('HMS-34 REQ-7 edge: a Completed appointment still shows no actions', async () => {
    renderPage({ ...STALE, status: 'COMPLETED' });
    await screen.findByText('Completed');
    expect(screen.getByText(/closed and can no longer be changed/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  });
});
