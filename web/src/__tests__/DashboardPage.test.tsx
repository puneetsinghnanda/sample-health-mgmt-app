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
  onDuty: [],
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

  it('HMS-23 REQ-1, REQ-3, REQ-8, REQ-9: "On duty today" lists each doctor in API order with a link to the doctor page', async () => {
    const data: Dashboard = {
      ...DATA,
      onDuty: [
        { doctorId: 7, fullName: 'Dr. Test Doctor Seven', department: 'Outpatient', booked: 1, free: 5, nextFreeAt: '2026-10-19T06:00:00.000Z', nextFreeLabel: '11:30' },
        { doctorId: 3, fullName: 'Dr. Test Doctor Three', department: 'Surgery', booked: 4, free: 2, nextFreeAt: '2026-10-19T06:30:00.000Z', nextFreeLabel: '12:00' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const section = (await screen.findByRole('heading', { name: 'On duty today' })).closest('section')!;
    const rows = Array.from(section.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
    expect(rows).toEqual([
      ['Dr. Test Doctor Seven', 'Outpatient', '1', '5', '11:30'],
      ['Dr. Test Doctor Three', 'Surgery', '4', '2', '12:00'],
    ]);
    expect(screen.getByRole('link', { name: 'Dr. Test Doctor Three' }).getAttribute('href')).toBe('/doctors/3');
  });

  it('HMS-23 REQ-14: the section sits between the tiles and Next appointments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: 'On duty today' });
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['On duty today', 'Next appointments']);
  });

  it('HMS-23 REQ-7: a doctor with no free slots shows "Fully booked" instead of a time', async () => {
    const data: Dashboard = {
      ...DATA,
      onDuty: [{ doctorId: 2, fullName: 'Dr. Test Doctor Two', department: 'Surgery', booked: 2, free: 0, nextFreeAt: null, nextFreeLabel: null }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'Dr. Test Doctor Two' });
    const cells = Array.from(link.closest('tr')!.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells).toEqual(['Dr. Test Doctor Two', 'Surgery', '2', '0', 'Fully booked']);
  });

  it('HMS-23 REQ-10: with no doctors on duty the section says so and shows no table', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DATA), { status: 200 })));
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const section = (await screen.findByRole('heading', { name: 'On duty today' })).closest('section')!;
    expect(section.textContent).toContain('No doctors on duty today');
    expect(section.querySelector('table')).toBeNull();
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
