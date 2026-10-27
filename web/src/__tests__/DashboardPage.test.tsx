import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Dashboard } from '../api/types';
import { DashboardPage } from '../pages/DashboardPage';

const DATA: Dashboard = {
  today: '2026-10-19',
  period: { name: 'today', from: '2026-10-19', to: '2026-10-19' },
  totals: { patients: 200, doctors: 12, appointmentsToday: 31, upcoming: 140, completed: 9, cancelled: 2, noShows: 4 },
  next: [],
};

describe('DashboardPage (PRD §4.4)', () => {
  it('DSH-1..6 tiles show the counts and DSH-8 each links to the list it counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const cancelled = await screen.findByRole('link', { name: /Cancelled/ });
    expect(cancelled.textContent).toContain('2');
    expect(cancelled.getAttribute('href')).toBe('/appointments?status=CANCELLED&from=2026-10-19&to=2026-10-19');
    expect(screen.getByRole('link', { name: /Total patients/ }).textContent).toContain('200');
    expect(screen.getByRole('link', { name: /Appointments today/ }).getAttribute('href')).toBe('/appointments?from=2026-10-19&to=2026-10-19');
  });

  it('HMS-3 REQ-1/REQ-6/REQ-7: the No-shows tile shows its count and links to the No-show list for the period', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const tile = await screen.findByRole('link', { name: /No-shows/ });
    expect(tile.textContent).toBe('4No-shows');
    expect(tile.getAttribute('href')).toBe('/appointments?status=NO_SHOW&from=2026-10-19&to=2026-10-19');
  });
});
