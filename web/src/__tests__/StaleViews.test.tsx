import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentSummary, Dashboard } from '../api/types';
import { AppointmentTable } from '../components/AppointmentTable';
import { DashboardPage } from '../pages/DashboardPage';

const ROUTER = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const row = (id: number, status: AppointmentSummary['status']): AppointmentSummary => ({
  id, code: `A-00000${id}`,
  doctor: { id: 1, code: 'D-0001', fullName: 'Test Doctor 001' },
  patient: { id: 1, code: 'P-0001', fullName: 'Test Patient 001' },
  startsAt: '2026-10-19T03:30:00Z', endsAt: '2026-10-19T03:45:00Z', status,
});

describe('Stale in shared views (HMS-34)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('HMS-34 REQ-12 (S-7 AC1, S-5 AC1): the appointment table shows Stale for a Stale row and Scheduled for the other', () => {
    render(
      <MemoryRouter future={ROUTER}>
        <AppointmentTable items={[row(1, 'STALE'), row(2, 'SCHEDULED')]} hide="patient" />
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Stale').classList.contains('badge-stale')).toBe(true);
    expect(within(rows[1]!).getByText('Scheduled').classList.contains('badge-scheduled')).toBe(true);
  });

  it('HMS-34 REQ-14 (S-5 AC4): the dashboard keeps its seven tiles and has no Stale tile', async () => {
    const data: Dashboard = {
      today: '2026-10-19',
      period: { name: 'today', from: '2026-10-19', to: '2026-10-19' },
      totals: { patients: 2, doctors: 1, appointmentsToday: 1, upcoming: 1, completed: 0, cancelled: 0, noShows: 0 },
      next: [],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    const { container } = render(
      <MemoryRouter future={ROUTER}>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /Total patients/ });
    expect(container.querySelectorAll('.tiles .tile')).toHaveLength(7);
    expect(screen.queryByRole('link', { name: /Stale/ })).toBeNull();
  });
});
