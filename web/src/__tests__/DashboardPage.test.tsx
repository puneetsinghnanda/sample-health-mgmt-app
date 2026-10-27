import { fireEvent, render, screen } from '@testing-library/react';
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

  it('HMS-3 REQ-5/REQ-7: changing the period reloads the No-shows count and moves its link to that period', async () => {
    const week: Dashboard = { ...DATA, period: { name: '7d', from: '2026-10-13', to: '2026-10-19' }, totals: { ...DATA.totals, noShows: 11 } };
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(String(url).includes('period=7d') ? week : DATA), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole('link', { name: /4\s*No-shows/ });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7d' } });
    const tile = await screen.findByRole('link', { name: /11\s*No-shows/ });
    expect(tile.getAttribute('href')).toBe('/appointments?status=NO_SHOW&from=2026-10-13&to=2026-10-19');
  });

  it('HMS-3 REQ-2 edge: a period with no No-shows shows 0', async () => {
    const none: Dashboard = { ...DATA, totals: { ...DATA.totals, noShows: 0 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(none), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('link', { name: /No-shows/ })).textContent).toBe('0No-shows');
  });
});
